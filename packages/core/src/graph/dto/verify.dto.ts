import type { Direction } from "../graph.repository.js";

/** Một cạnh ở dạng tối thiểu mà phép duyệt cần. */
export interface PlainEdge {
  src: string;
  dst: string;
  conditional: boolean;
}

/** Độ sâu và mức chắc chắn của một node, theo một trong hai cách tính. */
export interface Reach {
  depth: number;
  certain: boolean;
}

/** Một chỗ hai cách tính cho kết quả khác nhau. */
export interface VerifyMismatch {
  start: string; // node xuất phát của phép duyệt
  direction: Direction;
  node: string; // node có kết quả khác nhau
  sql: Reach | null; // null: truy vấn SQL không tới được node này
  bfs: Reach | null; // null: phép duyệt bằng JavaScript không tới được node này
}

/** Kết quả của verify(). */
export interface VerifyResult {
  ok: boolean; // true khi không có sai khác và database nguyên vẹn
  nodes: number;
  edges: number;
  traversals: number; // số phép duyệt đã đối chiếu: mỗi node hai chiều
  comparisons: number; // tổng số cặp (phép duyệt, node tới được) đã so
  maxDepth: number; // độ sâu lớn nhất gặp phải trong mọi phép duyệt
  nodesOnCycles: number; // số node tự đi về được chính nó
  mismatches: VerifyMismatch[];
  integrity: string[]; // lỗi do SQLite tự kiểm tra báo ra; rỗng là tốt
  durationMs: number;
}
