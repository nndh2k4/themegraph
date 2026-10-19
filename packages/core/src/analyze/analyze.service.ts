import path from "node:path";

import { hashContent } from "../common/hash.js";
import type { GraphStore } from "../graph/graph.store.js";
import type {
  Extraction,
  FileElement,
  FileHash,
  FileImportMapEntry,
  FileSchema,
  RawRef,
  ResourceSetting,
  ThemeFile,
} from "../models/index.js";
import { READ_EXTENSIONS } from "../theme/theme-layout.js";
import type { ThemeFileRepository } from "../theme/theme-file.repository.js";
import type { ThemeRegistryRepository } from "../theme/theme-registry.repository.js";
import type { ThemeScanner } from "../theme/theme-scanner.js";
import { buildCallContexts, contextKey } from "./call-context.js";
import type { AnalyzeError, AnalyzeResult } from "./dto/analyze-result.dto.js";
import type { GraphBuilder } from "./graph-builder.js";
import type { ThemeFileParser } from "./parsers/theme-file.parser.js";

/** So sánh hai chuỗi theo mã ký tự, giống cách scanner sắp xếp. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Đếm số phần tử theo một khoá, trả về object có khoá xếp theo bảng chữ cái. */
function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => compareText(a, b)));
}

/**
 * Số lượt phân tích lại snippet tối đa (xem propagateCallContexts). Mỗi lượt
 * đưa ngữ cảnh xuống thêm một tầng snippet lồng nhau; theme thật hiếm khi
 * lồng quá vài tầng.
 */
const MAX_CONTEXT_PASSES = 8;

/** Một file đã đọc và phân tích. Nội dung chỉ được giữ với snippet, để phân tích lại. */
interface ParsedFile {
  file: ThemeFile;
  content: string | null;
  extraction: Extraction;
}

/**
 * Phân tích một Shopify theme và ghi đồ thị của nó.
 *
 * Đây là đường ghi DUY NHẤT của chương trình, một dây chuyền (Pipes and Filters):
 *   quét thư mục -> đọc từng file -> trích quan hệ thô -> phân tích lại snippet
 *   theo những gì nơi gọi truyền vào -> dựng đồ thị -> ghi -> ghi theme vào
 *   sổ đăng ký toàn cục
 *
 * Mỗi bước là một provider nhận qua constructor; service chỉ nối chúng lại.
 */
export class AnalyzeService {
  constructor(
    private readonly scanner: ThemeScanner,
    private readonly files: ThemeFileRepository,
    private readonly parser: ThemeFileParser,
    private readonly builder: GraphBuilder,
    private readonly store: GraphStore,
    private readonly registry: ThemeRegistryRepository,
  ) {}

  /**
   * Ném lỗi nếu thư mục không phải theme. Một file riêng lẻ bị hỏng thì không
   * ném lỗi: nó được ghi vào `errors` và các file còn lại vẫn được phân tích.
   */
  async analyze(themeRoot: string): Promise<AnalyzeResult> {
    const startedAt = performance.now();

    // Đổi về đường dẫn tuyệt đối đúng một lần, ngay ở cửa vào. Đường dẫn tương
    // đối (ví dụ ".") được hiểu theo thư mục đang đứng của người gọi; từ đây trở
    // xuống không chỗ nào còn phụ thuộc vào thư mục đang đứng nữa.
    const root = path.resolve(themeRoot);

    // Bước 1: quét. Ném lỗi ở đây nếu thư mục không phải theme, trước khi tạo
    // bất cứ thứ gì trên đĩa.
    const { files, skipped } = await this.scanner.scan(root);

    // Bước 2 và 3: đọc nội dung và trích quan hệ thô.
    const parsed: ParsedFile[] = [];
    const fileHashes: FileHash[] = [];
    const errors: AnalyzeError[] = [];

    for (const file of files) {
      // Chỉ file Liquid, JSON, JavaScript và CSS (url()) mới có quan hệ để
      // trích; ảnh, font thì không cần đọc nội dung.
      if (!READ_EXTENSIONS.has(file.ext)) continue;

      try {
        const content = await this.files.readFile(root, file.path);

        // Ghi hash NGAY sau khi đọc, trước khi phân tích: một file hỏng cú pháp
        // vẫn cần hash để status biết nó có được sửa lại hay chưa.
        fileHashes.push({ file: file.path, hash: hashContent(content) });
        const extraction = this.parser.parse(file, content);
        parsed.push({ file, content: file.kind === "snippet" ? content : null, extraction });
      } catch (error) {
        // File hỏng vẫn là một node của đồ thị (nó tồn tại và có thể được file
        // khác gọi); chỉ là không biết nó gọi những gì.
        errors.push({
          path: file.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.propagateCallContexts(parsed);

    const rawRefs: RawRef[] = [];
    const schemas: FileSchema[] = [];
    const translationKeys: string[] = [];
    const settings: string[] = [];
    const elements: FileElement[] = [];
    const importMap: FileImportMapEntry[] = [];
    const resourceSettings: ResourceSetting[] = [];

    for (const { file, extraction } of parsed) {
      // Lỗi một phần: lấy từ kết quả CUỐI của file (sau khi phân tích lại snippet
      // theo ngữ cảnh) để mỗi cảnh báo chỉ được ghi một lần.
      for (const message of extraction.warnings) errors.push({ path: file.path, message });
      resourceSettings.push(...extraction.resourceSettings);
      rawRefs.push(...extraction.refs);
      translationKeys.push(...extraction.translationKeys);
      settings.push(...extraction.settings);
      for (const mention of extraction.elements) elements.push({ file: file.path, ...mention });
      for (const entry of extraction.importMap) importMap.push({ file: file.path, ...entry });
      if (extraction.schema !== null) {
        schemas.push({ file: file.path, ...extraction.schema });
      }
    }

    // Lỗi cứng được ghi lúc đọc, cảnh báo ghi ở vòng trên; xếp lại theo file
    // rồi câu báo để đầu ra không phụ thuộc vào lúc mỗi loại được ghi.
    errors.sort((a, b) => compareText(a.path, b.path) || compareText(a.message, b.message));

    // Bước 4: dựng đồ thị (phân giải tên thô thành file, gộp cạnh, thêm loại trang).
    const graph = this.builder.build(files, rawRefs, {
      schemas,
      translationKeys,
      settings,
      fileHashes,
      elements,
      importMap,
      resourceSettings,
      // Cả file hỏng hẳn lẫn cảnh báo: dead-code và context cần biết file nào
      // có thể đã thiếu quan hệ.
      fileErrors: errors.map((error) => ({ file: error.path, message: error.message })),
    });

    // Bước 5: ghi xuống đĩa. Cùng một thời điểm được ghi vào đồ thị và vào sổ
    // đăng ký, để hai nơi không bao giờ lệch nhau.
    const analyzedAt = new Date();
    this.store.save(root, graph, analyzedAt);

    // Bước 6: ghi theme vào sổ đăng ký toàn cục, để lệnh list và MCP server
    // biết theme này tồn tại. Sổ đăng ký chỉ là chỉ mục; không ghi được nó thì
    // lần phân tích vẫn thành công.
    let registered = true;
    try {
      this.registry.register({
        path: root,
        name: path.basename(root),
        analyzedAt: analyzedAt.toISOString(),
        nodes: graph.nodes.length,
        edges: graph.edges.length,
      });
    } catch {
      registered = false;
    }

    return {
      themeRoot: root,
      dbPath: this.store.dbPath(root),
      stats: {
        files: files.length,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        refs: graph.refs.length,
        nodesByKind: countBy(graph.nodes, (node) => node.kind),
        edgesByType: countBy(graph.edges, (edge) => edge.type),
        refsByStatus: countBy(graph.refs, (ref) => ref.status),
      },
      missing: graph.refs.filter((ref) => ref.status === "missing"),
      skipped,
      errors,
      registered,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  /**
   * Phân tích lại các snippet với những gì nơi gọi truyền vào (xem
   * call-context.ts), thay kết quả cũ của chúng trong `parsed`.
   *
   * Lặp vì ngữ cảnh đi xuống từng tầng: section truyền section.settings vào
   * snippet A, A chuyển tiếp nó cho snippet B; B chỉ nhận được ngữ cảnh ở lượt
   * sau lượt A được phân tích lại. Dừng khi không snippet nào có ngữ cảnh mới,
   * hoặc sau MAX_CONTEXT_PASSES lượt.
   */
  private propagateCallContexts(parsed: ParsedFile[]): void {
    const applied = new Map<string, string>();

    for (let pass = 0; pass < MAX_CONTEXT_PASSES; pass++) {
      const contexts = buildCallContexts(parsed.map((entry) => entry.extraction.calls));
      let changed = false;

      for (const entry of parsed) {
        if (entry.content === null) continue;

        const context = contexts.get(entry.file.path);
        const key = contextKey(context);
        if ((applied.get(entry.file.path) ?? "") === key) continue;

        applied.set(entry.file.path, key);
        changed = true;
        // Lần đầu file đã phân tích được, nên lần này cũng vậy: chỉ khác ngữ cảnh.
        entry.extraction = this.parser.parse(entry.file, entry.content, context);
      }

      if (!changed) return;
    }
  }
}
