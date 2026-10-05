import { readFile } from "node:fs/promises";
import path from "node:path";

import { extractRefs } from "./extract.js";
import { buildGraph } from "./graph.js";
import { scanThemeDir } from "./scanner.js";
import { graphDbPath, saveGraph } from "./store.js";
import type { RawRef, ResolvedRef } from "./types.js";

/** Một file không phân tích được, kèm lý do. */
export interface AnalyzeError {
  path: string; // cùng định dạng với ThemeFile.path
  message: string;
}

/** Các con số tóm tắt của một lần phân tích. */
export interface AnalyzeStats {
  files: number;
  nodes: number;
  edges: number;
  refs: number;
  nodesByKind: Record<string, number>;
  edgesByType: Record<string, number>;
  refsByStatus: Record<string, number>;
}

/** Kết quả của analyze(): đủ để lớp gọi (CLI, MCP, server) in ra hoặc trả về. */
export interface AnalyzeResult {
  themeRoot: string; // đường dẫn tuyệt đối của theme đã phân tích
  dbPath: string; // đường dẫn tuyệt đối của graph.db vừa ghi
  stats: AnalyzeStats;
  missing: ResolvedRef[]; // các tham chiếu hỏng, kèm file và dòng
  skipped: string[]; // file nằm trong theme nhưng ngoài quy ước thư mục
  errors: AnalyzeError[]; // file không đọc hoặc không phân tích được
  durationMs: number;
}

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
 * Phân tích một Shopify theme và ghi đồ thị của nó vào
 * <themeRoot>/.themegraph/graph.db.
 *
 * Đây là điểm nối của toàn bộ lõi:
 *   quét thư mục -> đọc từng file -> trích quan hệ thô -> dựng đồ thị -> ghi SQLite
 *
 * Mọi lớp vỏ (CLI, MCP, server) chỉ gọi hàm này; không lớp nào tự đọc Liquid.
 *
 * Ném lỗi nếu thư mục không phải theme. Một file riêng lẻ bị hỏng thì không
 * ném lỗi: nó được ghi vào `errors` và các file còn lại vẫn được phân tích.
 */
export async function analyze(themeRoot: string): Promise<AnalyzeResult> {
  const startedAt = performance.now();

  // Đổi về đường dẫn tuyệt đối đúng một lần, ngay ở cửa vào. Đường dẫn tương
  // đối (ví dụ ".") được hiểu theo thư mục đang đứng của người gọi; từ đây trở
  // xuống không chỗ nào còn phụ thuộc vào thư mục đang đứng nữa.
  const root = path.resolve(themeRoot);

  // Bước 1: quét. Ném lỗi ở đây nếu thư mục không phải theme, trước khi tạo
  // bất cứ thứ gì trên đĩa.
  const { files, skipped } = await scanThemeDir(root);

  // Bước 2 và 3: đọc nội dung và trích quan hệ thô.
  const rawRefs: RawRef[] = [];
  const errors: AnalyzeError[] = [];

  for (const file of files) {
    // Chỉ file Liquid và JSON mới có quan hệ để trích; ảnh, css, js thì không
    // cần đọc nội dung.
    if (file.ext !== "liquid" && file.ext !== "json") continue;

    try {
      const content = await readFile(path.join(root, file.path), "utf8");
      rawRefs.push(...extractRefs(file, content));
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
  const graph = buildGraph(files, rawRefs);

  // Bước 5: ghi xuống đĩa.
  saveGraph(root, graph);

  return {
    themeRoot: root,
    dbPath: graphDbPath(root),
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
    durationMs: Math.round(performance.now() - startedAt),
  };
}
