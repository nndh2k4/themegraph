import { findNode } from "./find-node.js";
import type { FindNodeOptions } from "./find-node.js";
import type { GraphHandle } from "./open.js";
import { traverse } from "./traverse.js";
import type { Reached } from "./traverse.js";
import type { EdgeType, GraphNode, NodeKind } from "./types.js";

/** Một node trong cây render. */
export interface FlowNode {
  id: string;
  kind: NodeKind;
  depth: number; // tầng của node trong cây, gốc là 0
  // Cạnh dẫn từ node cha tới node này. Gốc không có cha nên edge là null,
  // conditional là false và count là 0.
  edge: EdgeType | null;
  conditional: boolean; // cạnh đó có điều kiện hay không
  count: number; // số lời gọi trong mã đã gộp vào cạnh đó
  // true: node này đã được liệt kê đầy đủ (cùng các con của nó) ở một chỗ
  // khác trong cây, nên ở đây không mở ra nữa và `children` rỗng.
  repeated: boolean;
  children: FlowNode[];
}

/** Kết quả của renderFlow(): một trang (hoặc một file) kéo theo những gì. */
export interface RenderFlowResult {
  root: GraphNode; // node đang hỏi
  // Mọi node tới được từ root, không kể chính root, mỗi node một dòng. Xếp
  // theo độ sâu rồi theo id.
  files: Reached[];
  // Cùng các node đó, xếp thành cây theo quan hệ "cha gọi con".
  tree: FlowNode;
}

/**
 * Trả lời câu hỏi: "trang này render những file nào, theo thứ tự lồng nhau ra sao?"
 *
 * Đi XUÔI chiều mũi tên từ node đang hỏi, qua mọi loại cạnh: loại trang ->
 * template -> layout và section -> snippet, block, asset.
 *
 * Kết quả có hai dạng của cùng một tập node:
 *   - `files`: danh sách phẳng, mỗi node một lần, kèm độ sâu nhỏ nhất
 *   - `tree`:  cây lồng nhau để in ra cho người đọc
 *
 * Một file thường được gọi từ nhiều nơi (một snippet dùng trong mười section).
 * Nếu mở nó ra ở mọi nơi nó xuất hiện thì cây phình to rất nhanh, và với đồ
 * thị có vòng thì không bao giờ xong. Vì vậy mỗi node chỉ được MỞ MỘT LẦN, ở
 * vị trí ứng với độ sâu nhỏ nhất của nó; ở các chỗ khác nó hiện ra với
 * `repeated: true` và không có con.
 *
 * `name` được hiểu theo findNode(). Ném NodeNotFoundError nếu không có node.
 */
export function renderFlow(graph: GraphHandle, name: string, options: FindNodeOptions = {}): RenderFlowResult {
  const root = findNode(graph, name, options);

  const reached = traverse(graph, root.id, "forward");

  // Tra nhanh độ sâu nhỏ nhất của từng node khi dựng cây.
  const depthOf = new Map(reached.map((node) => [node.id, node.depth]));

  // Thứ tự các con: cạnh không điều kiện trước (đó là luồng render chính),
  // rồi theo tên để kết quả ổn định.
  const outgoing = graph.db.prepare(
    `SELECT e.dst, n.kind, e.type, e.conditional, e.count
     FROM edges e JOIN nodes n ON n.id = e.dst
     WHERE e.src = ?
     ORDER BY e.conditional, e.dst, e.type`,
  );

  // Các node đã được mở. Không cần ghi gốc vào đây: gốc có độ sâu 0, không
  // bao giờ khớp điều kiện về tầng bên dưới, nên vòng quay về gốc tự bị chặn.
  const expanded = new Set<string>();

  /** Dựng danh sách con của một node đang được mở ở tầng `depth`. */
  const childrenOf = (id: string, depth: number): FlowNode[] =>
    outgoing.all(id).map((row) => {
      const childId = String(row.dst);

      const child: FlowNode = {
        id: childId,
        kind: String(row.kind) as NodeKind,
        depth: depth + 1,
        edge: String(row.type) as EdgeType,
        conditional: row.conditional === 1,
        count: Number(row.count),
        repeated: true,
        children: [],
      };

      // Chỉ mở node ở đúng tầng bằng độ sâu nhỏ nhất của nó, và chỉ một lần.
      // Mọi node tới được đều có ít nhất một cha nằm ngay trên tầng đó, nên
      // không node nào bị bỏ sót.
      if (depthOf.get(childId) === depth + 1 && !expanded.has(childId)) {
        expanded.add(childId);
        child.repeated = false;
        child.children = childrenOf(childId, depth + 1);
      }

      return child;
    });

  return {
    root,
    files: reached.filter((node) => node.id !== root.id),
    tree: {
      id: root.id,
      kind: root.kind,
      depth: 0,
      edge: null,
      conditional: false,
      count: 0,
      repeated: false,
      children: childrenOf(root.id, 0),
    },
  };
}
