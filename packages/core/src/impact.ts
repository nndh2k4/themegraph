import { findNode } from "./find-node.js";
import type { FindNodeOptions } from "./find-node.js";
import type { GraphHandle } from "./open.js";
import { traverse } from "./traverse.js";
import type { Reached } from "./traverse.js";
import type { GraphNode } from "./types.js";

/** Kết quả của impact(): sửa một file thì những gì bị ảnh hưởng. */
export interface ImpactResult {
  target: GraphNode; // node đang hỏi
  // Mọi node dùng tới target, trực tiếp hoặc qua trung gian, không kể chính
  // target. Xếp theo độ sâu (gần target trước) rồi theo id.
  affected: Reached[];
  pages: Reached[]; // các loại trang trong `affected`
  totalPages: number; // số loại trang của cả theme, để nói "4 trên 12 trang"
}

/**
 * Trả lời câu hỏi: "sửa file này thì những file nào và trang nào bị ảnh hưởng?"
 *
 * Đi NGƯỢC chiều mũi tên từ node đang hỏi: ai gọi nó, ai gọi những file đó,
 * cứ thế lên tới loại trang. Đi qua mọi loại cạnh, nên sửa một asset hay một
 * layout cũng ra đúng các trang dùng nó.
 *
 * `certain` của mỗi node cho biết node đó LUÔN dùng tới target (true) hay chỉ
 * dùng trong một điều kiện nào đó (false).
 *
 * `name` được hiểu theo findNode(). Ném NodeNotFoundError nếu không có node.
 */
export function impact(graph: GraphHandle, name: string, options: FindNodeOptions = {}): ImpactResult {
  const target = findNode(graph, name, options);

  // Bỏ chính target: nó có độ sâu 0, và trong đồ thị có vòng nó còn tự "ảnh
  // hưởng" tới mình, điều không có ích gì cho người hỏi.
  const affected = traverse(graph, target.id, "backward").filter((node) => node.id !== target.id);

  const totalPages = graph.db.prepare("SELECT count(*) AS n FROM nodes WHERE kind = 'page_type'").get();

  return {
    target,
    affected,
    pages: affected.filter((node) => node.kind === "page_type"),
    totalPages: Number(totalPages?.n ?? 0),
  };
}
