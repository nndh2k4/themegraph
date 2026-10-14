import type { GraphHandle } from "./open.js";
import { traverse } from "./traverse.js";
import type { Direction, Reached } from "./traverse.js";

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

/**
 * Duyệt đồ thị theo chiều rộng bằng JavaScript thuần, không dùng SQL.
 *
 * Đây là cách tính THỨ HAI, độc lập với traverse(): cùng một câu hỏi nhưng
 * khác hẳn cách làm (hàng đợi và tập "đã ghé qua" trong bộ nhớ, thay vì bảng
 * tạm đệ quy của SQLite). Hai cách cho cùng kết quả trên mọi node thì mới tin
 * được cả hai.
 *
 * Trả về mọi node tới được từ `start`, kể cả `start` (độ sâu 0).
 */
export function bfsTraverse(edges: readonly PlainEdge[], start: string, direction: Direction): Map<string, Reach> {
  // Danh sách kề: từ một node biết ngay các node kế tiếp theo chiều đang đi.
  const next = new Map<string, PlainEdge[]>();
  for (const edge of edges) {
    const from = direction === "forward" ? edge.src : edge.dst;
    const list = next.get(from) ?? [];
    list.push(edge);
    next.set(from, list);
  }

  /**
   * Một lượt duyệt theo chiều rộng. Hàng đợi vào trước ra trước bảo đảm node
   * gần hơn được ghé trước, nên lần đầu gặp một node cũng là đường ngắn nhất
   * tới nó. Node đã có trong `depthOf` thì bỏ qua: đó là thứ làm phép duyệt
   * dừng được khi đồ thị có vòng.
   */
  const walk = (onlyUnconditional: boolean): Map<string, number> => {
    const depthOf = new Map([[start, 0]]);
    const queue = [start];

    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const depth = depthOf.get(id) ?? 0;

      for (const edge of next.get(id) ?? []) {
        if (onlyUnconditional && edge.conditional) continue;

        const to = direction === "forward" ? edge.dst : edge.src;
        if (depthOf.has(to)) continue;

        depthOf.set(to, depth + 1);
        queue.push(to);
      }
    }

    return depthOf;
  };

  // Lượt một đi qua mọi cạnh để lấy độ sâu. Lượt hai chỉ đi qua cạnh không
  // điều kiện: node nào lượt hai tới được thì node đó là "chắc chắn".
  const all = walk(false);
  const sure = walk(true);

  return new Map([...all].map(([id, depth]) => [id, { depth, certain: sure.has(id) }]));
}

/**
 * So kết quả của hai cách tính cho cùng một phép duyệt. Trả về mọi node mà
 * một bên có còn bên kia không, hoặc hai bên khác độ sâu hay mức chắc chắn.
 */
export function diffTraversals(
  start: string,
  direction: Direction,
  sqlRows: readonly Reached[],
  bfs: ReadonlyMap<string, Reach>,
): VerifyMismatch[] {
  const mismatches: VerifyMismatch[] = [];
  const sql = new Map(sqlRows.map((row) => [row.id, { depth: row.depth, certain: row.certain }]));

  // Gộp tên node của cả hai bên để không sót node chỉ một bên có.
  for (const node of [...new Set([...sql.keys(), ...bfs.keys()])].sort()) {
    const a = sql.get(node) ?? null;
    const b = bfs.get(node) ?? null;

    if (a === null || b === null || a.depth !== b.depth || a.certain !== b.certain) {
      mismatches.push({ start, direction, node, sql: a, bfs: b });
    }
  }

  return mismatches;
}

/**
 * Kiểm chứng đồ thị của một theme: với MỌI node, theo CẢ HAI chiều, so kết
 * quả của truy vấn đệ quy SQL với phép duyệt theo chiều rộng bằng JavaScript.
 * Hai bên phải ra cùng tập node, cùng độ sâu, cùng mức chắc chắn.
 *
 * Kèm theo là hai phép tự kiểm tra của SQLite: file database có nguyên vẹn
 * không, và có dòng nào trỏ tới một node không tồn tại không.
 */
export function verify(graph: GraphHandle): VerifyResult {
  const startedAt = performance.now();

  const nodes = graph.db
    .prepare("SELECT id FROM nodes ORDER BY id")
    .all()
    .map((row) => String(row.id));

  const edges: PlainEdge[] = graph.db
    .prepare("SELECT src, dst, conditional FROM edges")
    .all()
    .map((row) => ({ src: String(row.src), dst: String(row.dst), conditional: row.conditional === 1 }));

  const mismatches: VerifyMismatch[] = [];
  let comparisons = 0;
  let maxDepth = 0;
  let nodesOnCycles = 0;

  for (const start of nodes) {
    for (const direction of ["forward", "backward"] as const) {
      const sqlRows = traverse(graph, start, direction);
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

  const integrity = [
    // integrity_check trả đúng một dòng "ok" khi file không hỏng.
    ...graph.db
      .prepare("PRAGMA integrity_check")
      .all()
      .map((row) => String(row.integrity_check))
      .filter((line) => line !== "ok"),
    // foreign_key_check trả một dòng cho mỗi dòng vi phạm khoá ngoại.
    ...graph.db
      .prepare("PRAGMA foreign_key_check")
      .all()
      .map((row) => `Bảng ${String(row.table)} có dòng trỏ tới một dòng không tồn tại của bảng ${String(row.parent)}.`),
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
