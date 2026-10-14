import type { GraphEdge, GraphNode } from "../../models/index.js";

/**
 * Nhóm node KHÔNG thuộc luồng render, chỉ được xuất khi người gọi xin.
 *
 * Một theme có số khoá dịch và setting gấp nhiều lần số file (Purity: 3272 so
 * với 539), nên mặc định chỉ xuất file và loại trang: đủ để vẽ đồ thị render,
 * và nhỏ hơn khoảng năm lần.
 */
export type ExportGroup = "translations" | "settings";

export interface ExportGraphOptions {
  /** Các nhóm node xuất thêm ngoài file và loại trang. Mặc định: không nhóm nào. */
  include?: readonly ExportGroup[];
}

/** Kết quả của exportGraph(): đồ thị ở dạng hai danh sách phẳng. */
export interface ExportedGraph {
  nodes: GraphNode[]; // xếp theo id
  edges: GraphEdge[]; // xếp theo (from, to, type); cả hai đầu đều có trong `nodes`
}
