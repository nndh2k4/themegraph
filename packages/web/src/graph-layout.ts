import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

import type { DrawGraph, DrawNode } from "./graph-model.js";
import type { GraphLayout } from "./route.js";

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

/**
 * Tầng của từng loại node trong bố cục theo tầng, từ trên xuống: đúng thứ tự
 * Shopify dựng một trang. Layout và nhóm section cùng tầng vì cả hai đều nằm
 * ngay dưới template.
 */
export const KIND_LAYERS: Record<string, number> = {
  page_type: 0,
  template: 1,
  layout: 2,
  section_group: 2,
  section: 3,
  block: 4,
  snippet: 5,
  asset: 6,
};

/** Số node nhiều nhất trên một hàng; tầng đông hơn thì xuống hàng. */
export const MAX_PER_ROW = 32;

/**
 * Trong bố cục theo tầng các node đứng sát nhau thành hàng, nên được vẽ nhỏ
 * lại theo tỉ lệ này để node to nhất không đè lên hàng xóm.
 */
export const TREE_SIZE_SCALE = 0.6;

/** Khoảng cách giữa hai node cạnh nhau, giữa hai hàng của một tầng, và giữa hai tầng. */
const GAP_X = 34;
const GAP_ROW = 46;
const GAP_LAYER = 130;

/**
 * Vị trí của từng node trong bố cục theo tầng.
 *
 * Mỗi loại node nằm trên một tầng (xem KIND_LAYERS), tầng trên gọi tầng dưới.
 * Trong một tầng, node được xếp theo vị trí trung bình của những node GỌI NÓ
 * ở các tầng trên, để một section nằm gần template dùng nó và cạnh bớt cắt
 * nhau. Node không ai ở tầng trên gọi thì đứng cuối tầng, theo id.
 *
 * Tầng có nhiều node hơn MAX_PER_ROW thì chia thành nhiều hàng; không chia
 * thì 141 block của một theme lớn thành một hàng ngang dài gấp bốn màn hình.
 */
export function layeredPositions(draw: DrawGraph): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const callersOf = new Map<string, string[]>();
  for (const edge of draw.edges) callersOf.set(edge.to, [...(callersOf.get(edge.to) ?? []), edge.from]);

  const layers = new Map<number, DrawNode[]>();
  for (const node of draw.nodes) {
    const layer = KIND_LAYERS[node.kind] ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  }

  let y = 0;

  for (const layer of [...layers.keys()].sort((a, b) => a - b)) {
    const nodes = layers.get(layer) ?? [];

    // Vị trí trung bình của các node gọi nó đã được đặt (tức ở tầng trên).
    const anchor = (node: DrawNode): number => {
      const placed = (callersOf.get(node.id) ?? []).map((id) => positions.get(id)?.x).filter((x) => x !== undefined);
      return placed.length === 0 ? Infinity : placed.reduce((total, x) => total + x, 0) / placed.length;
    };
    const anchors = new Map(nodes.map((node) => [node.id, anchor(node)]));
    const ordered = [...nodes].sort((a, b) => {
      const byAnchor = (anchors.get(a.id) ?? Infinity) - (anchors.get(b.id) ?? Infinity);
      // Infinity - Infinity là NaN: hai node cùng không có ai gọi thì so theo id.
      return (Number.isNaN(byAnchor) ? 0 : byAnchor) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });

    const rows = Math.ceil(ordered.length / MAX_PER_ROW);
    // Chia đều cho các hàng, để hàng cuối không chỉ có vài node lẻ.
    const perRow = Math.ceil(ordered.length / rows);

    ordered.forEach((node, index) => {
      const row = Math.floor(index / perRow);
      const inRow = Math.min(perRow, ordered.length - row * perRow);
      const column = index - row * perRow;

      // Mỗi hàng được canh giữa quanh x = 0.
      positions.set(node.id, { x: (column - (inRow - 1) / 2) * GAP_X, y: y + row * GAP_ROW });
    });

    y += (rows - 1) * GAP_ROW + GAP_LAYER;
  }

  return positions;
}

/**
 * Dựng đồ thị graphology từ phần sẽ vẽ, và tính vị trí cho mọi node theo cách
 * xếp được chọn: "force" là ForceAtlas2, "tree" là bố cục theo tầng.
 */
export function layoutGraph(
  draw: DrawGraph,
  layout: GraphLayout = "force",
  iterations: number = LAYOUT_ITERATIONS,
): LaidOutGraph {
  const graph: LaidOutGraph = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
  const layered = layout === "tree" ? layeredPositions(draw) : null;

  draw.nodes.forEach((node: DrawNode, index) => {
    const tiered = layered?.get(node.id);

    graph.addNode(node.id, {
      // Sigma vẽ trục y hướng lên, nên tầng trên cùng phải có y lớn nhất.
      ...(tiered === undefined ? initialPosition(index, draw.nodes.length) : { x: tiered.x, y: -tiered.y }),
      size: layered === null ? node.size : node.size * TREE_SIZE_SCALE,
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
  if (layered === null && graph.order > 1 && graph.size > 0 && iterations > 0) {
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
