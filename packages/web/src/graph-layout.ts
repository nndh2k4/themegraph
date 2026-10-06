import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

import type { DrawGraph, DrawNode } from "./graph-model.js";

/**
 * Tính vị trí của từng node trên mặt phẳng.
 *
 * Dùng ForceAtlas2: các node đẩy nhau ra, cạnh kéo hai đầu lại gần, nên
 * những file hay gọi nhau tự tụ thành cụm. Thuật toán chạy một số vòng cố
 * định ngay trong lần gọi, không chạy nền: với vài trăm node nó xong trong
 * vài chục mili giây, và kết quả không nhảy múa trước mắt người xem.
 *
 * Kết quả ổn định: cùng một đồ thị luôn ra cùng một hình. ForceAtlas2 không
 * dùng số ngẫu nhiên; thứ duy nhất có thể làm hình khác đi là vị trí ban đầu,
 * nên vị trí ban đầu được tính từ thứ tự của node chứ không gieo ngẫu nhiên.
 */

/** Số vòng lặp của ForceAtlas2. Đo trên Dawn và Purity: hình hết đổi đáng kể sau khoảng 300 vòng. */
export const LAYOUT_ITERATIONS = 300;

/** Thuộc tính của một node trong đồ thị đem đi vẽ. */
export interface NodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  kind: string;
}

/** Thuộc tính của một cạnh trong đồ thị đem đi vẽ. */
export interface EdgeAttributes {
  conditional: boolean;
  types: string;
}

export type LaidOutGraph = Graph<NodeAttributes, EdgeAttributes>;

/**
 * Vị trí ban đầu: xếp các node lên một vòng tròn theo thứ tự trong danh sách.
 * Danh sách đã xếp theo id, mà id bắt đầu bằng tên thư mục, nên các file cùng
 * loại khởi đầu cạnh nhau.
 */
function initialPosition(index: number, total: number): { x: number; y: number } {
  const angle = (2 * Math.PI * index) / Math.max(total, 1);
  // Bán kính lớn dần theo số node để lúc đầu chúng không chồng lên nhau.
  const radius = 10 * Math.sqrt(Math.max(total, 1));

  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/** Dựng đồ thị graphology từ phần sẽ vẽ, và tính vị trí cho mọi node. */
export function layoutGraph(draw: DrawGraph, iterations: number = LAYOUT_ITERATIONS): LaidOutGraph {
  const graph: LaidOutGraph = new Graph({ type: "directed", multi: false, allowSelfLoops: false });

  draw.nodes.forEach((node: DrawNode, index) => {
    graph.addNode(node.id, {
      ...initialPosition(index, draw.nodes.length),
      size: node.size,
      color: node.color,
      label: node.label,
      kind: node.kind,
    });
  });

  for (const edge of draw.edges) {
    graph.addDirectedEdgeWithKey(edge.key, edge.from, edge.to, {
      conditional: edge.conditional,
      types: edge.types.join(","),
    });
  }

  // ForceAtlas2 cần ít nhất một cạnh để có lực kéo; không có thì giữ vòng tròn.
  if (graph.order > 1 && graph.size > 0 && iterations > 0) {
    forceAtlas2.assign(graph, {
      iterations,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        // Lực kéo tính theo logarit của khoảng cách: các cụm tách nhau rõ hơn,
        // thay vì mọi thứ co về một khối tròn.
        linLogMode: true,
        // Node được nhiều nơi gọi (layout, snippet dùng chung) bị kéo yếu đi,
        // nên nó không lôi cả đồ thị về phía mình.
        outboundAttractionDistribution: true,
        scalingRatio: 4,
        // Kéo nhẹ về tâm, để một file không ai gọi không trôi ra xa.
        gravity: 0.3,
      },
    });
  }

  return graph;
}
