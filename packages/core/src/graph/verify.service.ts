import type { PlainEdge, VerifyMismatch, VerifyResult } from "./dto/verify.dto.js";
import { bfsTraverse, diffTraversals } from "./graph-algorithms.js";
import type { GraphRepository } from "./graph.repository.js";

/**
 * Kiểm chứng đồ thị của một theme: với MỌI node, theo CẢ HAI chiều, so kết
 * quả của phép duyệt của repository (truy vấn đệ quy SQL) với phép duyệt theo
 * chiều rộng bằng JavaScript. Hai bên phải ra cùng tập node, cùng độ sâu, cùng
 * mức chắc chắn.
 *
 * Kèm theo là phép tự kiểm tra của nơi lưu trữ: file dữ liệu có nguyên vẹn
 * không, và có dòng nào trỏ tới một node không tồn tại không.
 */
export class VerifyService {
  constructor(private readonly graph: GraphRepository) {}

  verify(): VerifyResult {
    const startedAt = performance.now();

    const nodes = this.graph.allNodes().map((node) => node.id);

    const edges: PlainEdge[] = this.graph
      .allEdges()
      .map((edge) => ({ src: edge.from, dst: edge.to, conditional: edge.conditional }));

    const mismatches: VerifyMismatch[] = [];
    let comparisons = 0;
    let maxDepth = 0;
    let nodesOnCycles = 0;

    for (const start of nodes) {
      for (const direction of ["forward", "backward"] as const) {
        const sqlRows = this.graph.reach(start, direction);
        const bfs = bfsTraverse(edges, start, direction);

        mismatches.push(...diffTraversals(start, direction, sqlRows, bfs));
        comparisons += Math.max(sqlRows.length, bfs.size);

        for (const reach of bfs.values()) maxDepth = Math.max(maxDepth, reach.depth);

        // Node nằm trên một vòng khi đi xuôi từ nó tới được một node có cạnh
        // trỏ ngược về chính nó.
        if (direction === "forward" && edges.some((edge) => edge.dst === start && bfs.has(edge.src))) {
          nodesOnCycles += 1;
        }
      }
    }

    const { problems, brokenLinks } = this.graph.checkIntegrity();
    const integrity = [
      ...problems,
      ...brokenLinks.map((link) => `Bảng ${link.table} có dòng trỏ tới một dòng không tồn tại của bảng ${link.parent}.`),
    ];

    return {
      ok: mismatches.length === 0 && integrity.length === 0,
      nodes: nodes.length,
      edges: edges.length,
      traversals: nodes.length * 2,
      comparisons,
      maxDepth,
      nodesOnCycles,
      mismatches,
      integrity,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}
