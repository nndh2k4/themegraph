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
 * mức chặn ?2 đã đủ lớn chưa: xem traverse().
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

export interface TraverseOptions {
  /** Chỉ đi qua các loại cạnh này. Không có thì đi qua mọi loại cạnh. */
  edgeTypes?: readonly EdgeType[];
}

/** Kiểu của một câu lệnh đã chuẩn bị, lấy từ chính hàm tạo ra nó. */
type Statement = ReturnType<GraphHandle["db"]["prepare"]>;

/**
 * Câu lệnh đã chuẩn bị của từng đồ thị đang mở, theo chuỗi SQL. verify() gọi
 * traverse() hàng nghìn lần; chuẩn bị lại câu lệnh ở mỗi lần là phí.
 *
 * WeakMap: khi không còn ai giữ GraphHandle thì các câu lệnh của nó cũng
 * được dọn theo, không cần tự xoá.
 */
const statements = new WeakMap<GraphHandle, Map<string, Statement>>();

function prepare(graph: GraphHandle, sql: string): Statement {
  let ofGraph = statements.get(graph);
  if (ofGraph === undefined) {
    ofGraph = new Map();
    statements.set(graph, ofGraph);
  }

  let statement = ofGraph.get(sql);
  if (statement === undefined) {
    statement = graph.db.prepare(sql);
    ofGraph.set(sql, statement);
  }
  return statement;
}

/**
 * Duyệt đồ thị từ một node theo một chiều, bằng truy vấn đệ quy của SQLite.
 *
 * Trả về mọi node tới được, KỂ CẢ node xuất phát (độ sâu 0), xếp theo độ sâu
 * rồi theo id. Mặc định đi qua mọi loại cạnh.
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
  const statement = prepare(graph, sql);

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
