import type { StatementSync } from "node:sqlite";

import type { Direction, Reached } from "../../graph/graph.repository.js";
import type { EdgeType, NodeKind } from "../../models/index.js";

/**
 * Mức chặn độ sâu của lần chạy đầu. Đủ cho mọi theme thật (theme sâu nhất
 * từng đo là 7 tầng), nên vòng lặp nhân đôi bên dưới hầu như không phải chạy.
 */
const INITIAL_DEPTH_LIMIT = 16;

/**
 * Câu truy vấn duyệt đồ thị, viết cho chiều "đi từ cột `from` sang cột `to`".
 *
 * Gồm ba bảng tạm đệ quy, đều xuất phát từ node ?1:
 *
 * reach(id): TẬP node tới được. Dùng UNION (không phải UNION ALL) nên một
 *   node đã có thì không được thêm lần nữa: truy vấn tự dừng cả khi đồ thị có
 *   vòng.
 *
 * walk(id, depth): node kèm độ sâu. Ở đây UNION không còn cứu được: đi một
 *   vòng quanh a -> b -> a cho ra (a, 0), (a, 2), (a, 4)... là các dòng KHÁC
 *   nhau, nên truy vấn chạy mãi. Vì vậy độ sâu bị chặn ở tham số ?2.
 *
 * sure(id): tập node tới được khi chỉ đi qua cạnh không điều kiện.
 *
 * Câu SELECT cuối lấy độ sâu NHỎ NHẤT của mỗi node (một node có thể được tới
 * bằng nhiều đường dài ngắn khác nhau). Hai cột reachable và walked cho biết
 * mức chặn ?2 đã đủ lớn chưa: xem runTraverse().
 *
 * `edgeTypes` giới hạn phép duyệt vào một số loại cạnh; null là mọi loại.
 * Tên loại cạnh được ghép thẳng vào câu SQL, điều chỉ an toàn vì chúng là
 * hằng số của chương trình (kiểu EdgeType), không bao giờ là chữ người dùng gõ.
 */
export function traverseSql(direction: Direction, edgeTypes: readonly EdgeType[] | null): string {
  const [from, to] = direction === "forward" ? (["src", "dst"] as const) : (["dst", "src"] as const);
  const typeFilter = edgeTypes === null ? "1" : `e.type IN (${edgeTypes.map((type) => `'${type}'`).join(", ")})`;

  return `
WITH RECURSIVE
  reach(id) AS (
    SELECT ?1
    UNION
    SELECT e.${to} FROM edges e JOIN reach r ON e.${from} = r.id
    WHERE ${typeFilter}
  ),
  walk(id, depth) AS (
    SELECT ?1, 0
    UNION
    SELECT e.${to}, w.depth + 1 FROM edges e JOIN walk w ON e.${from} = w.id
    WHERE ${typeFilter} AND w.depth + 1 < ?2
  ),
  sure(id) AS (
    SELECT ?1
    UNION
    SELECT e.${to} FROM edges e JOIN sure s ON e.${from} = s.id
    WHERE ${typeFilter} AND e.conditional = 0
  )
SELECT w.id AS id,
       n.kind AS kind,
       min(w.depth) AS depth,
       w.id IN (SELECT id FROM sure) AS certain,
       (SELECT count(*) FROM reach) AS reachable,
       (SELECT count(DISTINCT id) FROM walk) AS walked
FROM walk w JOIN nodes n ON n.id = w.id
GROUP BY w.id
ORDER BY depth, w.id`;
}

/**
 * Tập node tới được khi đi xuôi qua mọi cạnh từ một danh sách điểm xuất phát.
 * Danh sách được truyền vào dạng mảng JSON ở ?1, nên câu lệnh chuẩn bị một lần
 * dùng được cho mọi danh sách.
 */
export const REACHABLE_FROM_SQL = `
WITH RECURSIVE
  reach(id) AS (
    SELECT value FROM json_each(?1)
    UNION
    SELECT e.dst FROM edges e JOIN reach r ON e.src = r.id
  )
SELECT id FROM reach`;

/**
 * Chạy câu duyệt của traverseSql() cho một node xuất phát.
 *
 * Về mức chặn độ sâu: truy vấn chạy với một mức chặn nhỏ trước. Nếu mọi node
 * tới được đều đã có độ sâu (walked = reachable) thì kết quả là đúng, vì đi
 * sâu hơn chỉ sinh thêm những đường dài hơn tới các node đã có. Nếu còn node
 * chưa được gán độ sâu, tức có node nằm xa hơn mức chặn, thì nhân đôi mức chặn
 * và chạy lại.
 *
 * Chặn thấp là có chủ ý: trên đồ thị có vòng, mỗi tầng được phép đi thêm lại
 * sinh thêm một dòng cho mọi node nằm sau vòng. Chặn ở "số node tới được" cho
 * kết quả đúng nhưng chậm gấp hàng chục lần trên theme lớn.
 */
export function runTraverse(statement: StatementSync, startId: string): Reached[] {
  for (let limit = INITIAL_DEPTH_LIMIT; ; limit *= 2) {
    const rows = statement.all(startId, limit);

    // Mọi dòng mang cùng hai con số này; không có dòng nào nghĩa là node xuất
    // phát không tồn tại, và khi đó cũng không còn gì để chạy lại.
    const first = rows[0];
    if (first !== undefined && Number(first.walked) < Number(first.reachable)) continue;

    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as NodeKind,
      depth: Number(row.depth),
      certain: row.certain === 1, // SQLite trả 1 / 0 cho biểu thức đúng / sai
    }));
  }
}
