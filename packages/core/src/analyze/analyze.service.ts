import path from "node:path";

import { hashContent } from "../common/hash.js";
import type { GraphStore } from "../graph/graph.store.js";
import type { FileElement, FileHash, FileSchema, RawRef } from "../models/index.js";
import { READ_EXTENSIONS } from "../theme/theme-layout.js";
import type { ThemeFileRepository } from "../theme/theme-file.repository.js";
import type { ThemeRegistryRepository } from "../theme/theme-registry.repository.js";
import type { ThemeScanner } from "../theme/theme-scanner.js";
import type { AnalyzeError, AnalyzeResult } from "./dto/analyze-result.dto.js";
import type { GraphBuilder } from "./graph-builder.js";
import type { ThemeFileParser } from "./parsers/theme-file.parser.js";

/** Đếm số phần tử theo một khoá, trả về object có khoá xếp theo bảng chữ cái. */
function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Phân tích một Shopify theme và ghi đồ thị của nó.
 *
 * Đây là đường ghi DUY NHẤT của chương trình, một dây chuyền (Pipes and Filters):
 *   quét thư mục -> đọc từng file -> trích quan hệ thô -> dựng đồ thị -> ghi
 *   -> ghi theme vào sổ đăng ký toàn cục
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
    const rawRefs: RawRef[] = [];
    const schemas: FileSchema[] = [];
    const translationKeys: string[] = [];
    const settings: string[] = [];
    const fileHashes: FileHash[] = [];
    const elements: FileElement[] = [];
    const errors: AnalyzeError[] = [];

    for (const file of files) {
      // Chỉ file Liquid, JSON và JavaScript mới có quan hệ để trích; ảnh và css
      // thì không cần đọc nội dung.
      if (!READ_EXTENSIONS.has(file.ext)) continue;

      try {
        const content = await this.files.readFile(root, file.path);

        // Ghi hash NGAY sau khi đọc, trước khi phân tích: một file hỏng cú pháp
        // vẫn cần hash để status biết nó có được sửa lại hay chưa.
        fileHashes.push({ file: file.path, hash: hashContent(content) });
        const extraction = this.parser.parse(file, content);

        rawRefs.push(...extraction.refs);
        translationKeys.push(...extraction.translationKeys);
        settings.push(...extraction.settings);
        for (const mention of extraction.elements) elements.push({ file: file.path, ...mention });
        if (extraction.schema !== null) {
          schemas.push({ file: file.path, ...extraction.schema });
        }
      } catch (error) {
        // File hỏng vẫn là một node của đồ thị (nó tồn tại và có thể được file
        // khác gọi); chỉ là không biết nó gọi những gì.
        errors.push({
          path: file.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Bước 4: dựng đồ thị (phân giải tên thô thành file, gộp cạnh, thêm loại trang).
    const graph = this.builder.build(files, rawRefs, { schemas, translationKeys, settings, fileHashes, elements });

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
}
