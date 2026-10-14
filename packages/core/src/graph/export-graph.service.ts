import type { GraphEdge, GraphNode, NodeKind } from "../models/index.js";
import type { GraphRepository } from "./graph.repository.js";

/**
 * Nhóm node KHÔNG thuộc luồng render, chỉ được xuất khi người gọi xin.
 *
 * Một theme có số khoá dịch và setting gấp nhiều lần số file (Purity: 3272 so
 * với 539), nên mặc định chỉ xuất file và loại trang: đủ để vẽ đồ thị render,
 * và nhỏ hơn khoảng năm lần.
 */
export type ExportGroup = "translations" | "settings";

/** Loại node ứng với mỗi nhóm. */
const KIND_OF_GROUP: Record<ExportGroup, NodeKind> = {
  translations: "translation_key",
  settings: "setting",
};

export const EXPORT_GROUPS: readonly ExportGroup[] = ["translations", "settings"];

export interface ExportGraphOptions {
  /** Các nhóm node xuất thêm ngoài file và loại trang. Mặc định: không nhóm nào. */
  include?: readonly ExportGroup[];
}

/** Kết quả của exportGraph(): đồ thị ở dạng hai danh sách phẳng. */
export interface ExportedGraph {
  nodes: GraphNode[]; // xếp theo id
  edges: GraphEdge[]; // xếp theo (from, to, type); cả hai đầu đều có trong `nodes`
}

/**
 * Xuất các node và cạnh của đồ thị, cho giao diện vẽ.
 *
 * Mọi cạnh trong kết quả đều có đủ hai đầu trong danh sách node: cạnh tới một
 * khoá dịch hay setting bị bỏ khi nhóm tương ứng không được xin.
 */
export function exportGraph(graph: GraphRepository, options: ExportGraphOptions = {}): ExportedGraph {
  const included = new Set((options.include ?? []).map((group) => KIND_OF_GROUP[group]));

  // Loại node bị bỏ: những nhóm tuỳ chọn không được xin.
  const excluded = EXPORT_GROUPS.map((group) => KIND_OF_GROUP[group]).filter((kind) => !included.has(kind));

  const nodes: GraphNode[] = graph.allNodes().filter((node) => !excluded.includes(node.kind));

  const ids = new Set(nodes.map((node) => node.id));

  const edges: GraphEdge[] = graph.allEdges().filter((edge) => ids.has(edge.from) && ids.has(edge.to));

  return { nodes, edges };
}
