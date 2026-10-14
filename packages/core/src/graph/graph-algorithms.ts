import type { PlainEdge, Reach, VerifyMismatch } from "./dto/verify.dto.js";
import type { Direction, Reached } from "./graph.repository.js";

/**
 * Hàm thuần trên đồ thị trong bộ nhớ, không đụng tới nơi lưu trữ nào. Dùng
 * làm cách tính THỨ HAI để đối chiếu với GraphRepository (xem VerifyService).
 */

/**
 * Duyệt đồ thị theo chiều rộng bằng JavaScript thuần, không dùng SQL.
 *
 * Đây là cách tính THỨ HAI, độc lập với GraphRepository.reach(): cùng một câu
 * hỏi nhưng khác hẳn cách làm (hàng đợi và tập "đã ghé qua" trong bộ nhớ, thay
 * vì bảng tạm đệ quy của SQLite). Hai cách cho cùng kết quả trên mọi node thì
 * mới tin được cả hai.
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
