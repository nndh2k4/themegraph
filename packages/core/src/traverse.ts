import type { GraphHandle } from "./open.js";
import type { EdgeType, NodeKind } from "./types.js";

/**
 * Chiều duyệt đồ thị.
 *
 * - forward:  đi theo chiều mũi tên, "node này dẫn tới những gì"
 * - backward: đi ngược chiều mũi tên, "những gì dẫn tới node này"
 */
export type Direction = "forward" | "backward";

/** Một node tới được từ node xuất phát. */
export interface Reached {
  id: string;
  kind: NodeKind;
  // Số cạnh ít nhất phải đi qua để tới node này từ node xuất phát.
  depth: number;
  // true khi có ít nhất một đường đi mà MỌI cạnh trên đó đều không điều kiện,
  // tức quan hệ này luôn xảy ra. false nghĩa là mọi đường đi đều vướng một
  // {% if %}, một vòng lặp, một template thay thế... nên chỉ CÓ THỂ xảy ra.
  certain: boolean;
}

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
 *   nhau, nên truy vấn chạy mãi. Vì vậy phải chặn độ sâu. Mức chặn là số node
 *   trong reach: đường đi ngắn nhất tới một node không bao giờ đi qua một node
 *   hai lần, nên không thể dài hơn số node tới được.
 *
 * sure(id): tập node tới được khi chỉ đi qua cạnh không điều kiện.
 *
 * Câu SELECT cuối lấy độ sâu NHỎ NHẤT của mỗi node (một node có thể được tới
 * bằng nhiều đường dài ngắn khác nhau).
 *
 * `edgeTypes` giới hạn phép duyệt vào một số loại cạnh; null là mọi loại.
 * Tên loại cạnh được ghép thẳng vào câu SQL, điều chỉ an toàn vì chúng là
 * hằng số của chương trình (kiểu EdgeType), không bao giờ là chữ người dùng gõ.
 */
function traverseSql(from: "src" | "dst", to: "src" | "dst", edgeTypes: readonly EdgeType[] | null): string {
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
    WHERE ${typeFilter} AND w.depth + 1 < (SELECT count(*) FROM reach)
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
       w.id IN (SELECT id FROM sure) AS certain
FROM walk w JOIN nodes n ON n.id = w.id
GROUP BY w.id
ORDER BY depth, w.id`;
}

export interface TraverseOptions {
  /** Chỉ đi qua các loại cạnh này. Không có thì đi qua mọi loại cạnh. */
  edgeTypes?: readonly EdgeType[];
}

/**
 * Duyệt đồ thị từ một node theo một chiều, bằng truy vấn đệ quy của SQLite.
 *
 * Trả về mọi node tới được, KỂ CẢ node xuất phát (độ sâu 0), xếp theo độ sâu
 * rồi theo id. Mặc định đi qua mọi loại cạnh.
 *
 * `startId` phải là id của một node có thật; dùng findNode() để đổi tên người
 * dùng gõ thành id.
 */
export function traverse(
  graph: GraphHandle,
  startId: string,
  direction: Direction,
  options: TraverseOptions = {},
): Reached[] {
  const edgeTypes = options.edgeTypes ?? null;
  const sql = direction === "forward" ? traverseSql("src", "dst", edgeTypes) : traverseSql("dst", "src", edgeTypes);

  return graph.db
    .prepare(sql)
    .all(startId)
    .map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as NodeKind,
      depth: Number(row.depth),
      certain: row.certain === 1, // SQLite trả 1 / 0 cho biểu thức đúng / sai
    }));
}
