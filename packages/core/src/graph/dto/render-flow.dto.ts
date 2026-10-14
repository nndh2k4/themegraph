import type { EdgeType, GraphNode, NodeKind } from "../../models/index.js";
import type { Reached } from "../graph.repository.js";
import type { FindNodeOptions } from "./find-node.dto.js";

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
  // Số file con trực tiếp của node này KHÔNG được đưa vào cây vì cây bị cắt ở
  // maxDepth. Bằng 0 khi không giới hạn độ sâu, và với mọi node chưa chạm
  // tầng bị cắt.
  hidden: number;
  children: FlowNode[];
}

export interface RenderFlowOptions extends FindNodeOptions {
  /**
   * Tầng sâu nhất của cây (gốc là tầng 0). Node ở đúng tầng này vẫn hiện,
   * nhưng không được mở ra; số con bị giấu ghi ở `hidden`. Không nêu thì cây
   * đi tới hết. Chỉ ảnh hưởng `tree`: danh sách `files` luôn đầy đủ.
   */
  maxDepth?: number;
}

/** Kết quả của renderFlow(): một trang (hoặc một file) kéo theo những gì. */
export interface RenderFlowResult {
  root: GraphNode; // node đang hỏi
  // Mọi node tới được từ root, không kể chính root, mỗi node một dòng. Xếp
  // theo độ sâu rồi theo id.
  files: Reached[];
  // Cùng các node đó, xếp thành cây theo quan hệ "cha gọi con".
  tree: FlowNode;
  // Giới hạn độ sâu đã áp lên `tree`; null khi cây không bị giới hạn.
  maxDepth: number | null;
}
