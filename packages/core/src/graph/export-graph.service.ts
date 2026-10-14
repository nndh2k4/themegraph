import type { GraphEdge, GraphNode, NodeKind } from "../models/index.js";
import type { ExportedGraph, ExportGraphOptions, ExportGroup } from "./dto/export-graph.dto.js";
import type { GraphRepository } from "./graph.repository.js";

/** Loại node ứng với mỗi nhóm. */
const KIND_OF_GROUP: Record<ExportGroup, NodeKind> = {
  translations: "translation_key",
  settings: "setting",
};

export const EXPORT_GROUPS: readonly ExportGroup[] = ["translations", "settings"];

/**
 * Xuất các node và cạnh của đồ thị, cho giao diện vẽ.
 *
 * Mọi cạnh trong kết quả đều có đủ hai đầu trong danh sách node: cạnh tới một
 * khoá dịch hay setting bị bỏ khi nhóm tương ứng không được xin.
 */
export class ExportGraphService {
  constructor(private readonly graph: GraphRepository) {}

  export(options: ExportGraphOptions = {}): ExportedGraph {
    const included = new Set((options.include ?? []).map((group) => KIND_OF_GROUP[group]));

    // Loại node bị bỏ: những nhóm tuỳ chọn không được xin.
    const excluded = EXPORT_GROUPS.map((group) => KIND_OF_GROUP[group]).filter((kind) => !included.has(kind));

    const nodes: GraphNode[] = this.graph.allNodes().filter((node) => !excluded.includes(node.kind));

    const ids = new Set(nodes.map((node) => node.id));

    const edges: GraphEdge[] = this.graph.allEdges().filter((edge) => ids.has(edge.from) && ids.has(edge.to));

    return { nodes, edges };
  }
}
