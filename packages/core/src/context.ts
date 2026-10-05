import { findNode } from "./find-node.js";
import type { FindNodeOptions } from "./find-node.js";
import { impact } from "./impact.js";
import type { GraphHandle } from "./open.js";
import type { Reached } from "./traverse.js";
import type { EdgeType, GraphNode, NodeKind, RefKind } from "./types.js";

/** Hai loại cạnh không nối tới file, tách khỏi danh sách "file này gọi file nào". */
const TRANSLATION_EDGE: EdgeType = "USES_TRANSLATION";
const SETTING_EDGE: EdgeType = "READS_SETTING";

/** Một quan hệ trực tiếp giữa node đang hỏi và một node khác. */
export interface ContextLink {
  id: string; // node ở đầu bên kia của cạnh
  kind: NodeKind;
  type: EdgeType;
  conditional: boolean;
  count: number; // số lời gọi trong mã đã gộp vào cạnh
  sources: string; // 'liquid', 'json', 'schema', 'convention', nối bằng dấu phẩy
  // Các dòng có lời gọi, tính trong file GỌI (đầu nguồn của cạnh). Rỗng với
  // quan hệ lấy từ file JSON hoặc suy từ quy ước, vì chúng không có số dòng.
  lines: number[];
}

/** Một tham chiếu hỏng: file gọi tới một thứ không có trong theme. */
export interface BrokenRef {
  name: string; // tên viết trong mã, ví dụ 'card-product'
  kind: RefKind;
  line: number; // dòng có lời gọi; 0 nếu lấy từ file JSON
  conditional: boolean;
  expected: string; // đường dẫn lẽ ra phải có, ví dụ snippets/card-product.liquid
}

/** Kết quả của context(): mọi thứ ở ngay quanh một file. */
export interface ContextResult {
  node: GraphNode;
  usedBy: ContextLink[]; // ai dùng trực tiếp node này
  uses: ContextLink[]; // node này dùng trực tiếp những FILE nào
  translations: ContextLink[]; // các khoá dịch node này dùng
  // Các setting node này đọc. Id của mỗi setting cho biết nó thuộc file nào,
  // tức trả lời được "section.settings.x trong snippet này là của section nào".
  settings: ContextLink[];
  broken: BrokenRef[]; // tham chiếu hỏng nằm trong file này
  pages: Reached[]; // các loại trang đi tới được node này, qua bao nhiêu tầng cũng tính
  totalPages: number;
}

/**
 * Trả lời câu hỏi: "file này là gì, ai gọi nó, nó gọi ai?"
 *
 * Khác impact() và renderFlow() ở chỗ chỉ nhìn MỘT bước về mỗi phía, nhưng
 * cho chi tiết hơn: số dòng của từng lời gọi và các tham chiếu hỏng. Đây là
 * thứ một người (hoặc agent) cần đọc trước khi sửa một file.
 *
 * `name` được hiểu theo findNode(). Ném NodeNotFoundError nếu không có node.
 */
export function context(graph: GraphHandle, name: string, options: FindNodeOptions = {}): ContextResult {
  const node = findNode(graph, name, options);

  // Hai câu dưới chỉ khác nhau ở chỗ lọc theo đầu nào của cạnh và lấy đầu nào
  // ra làm "node bên kia".
  const linksSql = (self: "src" | "dst", other: "src" | "dst"): string => `
    SELECT e.src AS src, e.dst AS dst, n.kind AS kind,
           e.type AS type, e.conditional AS conditional, e.count AS count, e.sources AS sources
    FROM edges e JOIN nodes n ON n.id = e.${other}
    WHERE e.${self} = ?
    ORDER BY e.${other}, e.type`;

  // Bảng edges đã gộp các lời gọi trùng nên không còn số dòng. Số dòng nằm ở
  // bảng refs, nơi giữ từng lời gọi riêng lẻ. line = 0 là ref lấy từ JSON.
  // Không cần lọc status: target ở đây là một node có thật, mà ref hỏng thì
  // target của nó là đường dẫn của một file không tồn tại.
  const linesOf = graph.db.prepare(
    `SELECT DISTINCT line FROM refs
     WHERE src = ? AND target = ? AND line > 0
     ORDER BY line`,
  );

  const links = (self: "src" | "dst", other: "src" | "dst"): ContextLink[] =>
    graph.db
      .prepare(linksSql(self, other))
      .all(node.id)
      .map((row) => ({
        id: String(row[other]),
        kind: String(row.kind) as NodeKind,
        type: String(row.type) as EdgeType,
        conditional: row.conditional === 1,
        count: Number(row.count),
        sources: String(row.sources),
        lines: linesOf.all(String(row.src), String(row.dst)).map((line) => Number(line.line)),
      }));

  const broken = graph.db
    .prepare(
      `SELECT name, kind, line, conditional, target FROM refs
       WHERE src = ? AND status = 'missing'
       ORDER BY line, name`,
    )
    .all(node.id)
    .map((row) => ({
      name: String(row.name),
      kind: String(row.kind) as RefKind,
      line: Number(row.line),
      conditional: row.conditional === 1,
      expected: String(row.target),
    }));

  // "File này thuộc trang nào" chính là phần trang của truy vấn impact.
  const { pages, totalPages } = impact(graph, node.id);

  // Một section dùng vài chục khoá dịch và setting là chuyện thường. Để lẫn
  // chúng vào danh sách file được gọi thì danh sách đó hết đọc nổi, nên tách riêng.
  const outgoing = links("src", "dst");

  return {
    node,
    usedBy: links("dst", "src"),
    uses: outgoing.filter((link) => link.type !== TRANSLATION_EDGE && link.type !== SETTING_EDGE),
    translations: outgoing.filter((link) => link.type === TRANSLATION_EDGE),
    settings: outgoing.filter((link) => link.type === SETTING_EDGE),
    broken,
    pages,
    totalPages,
  };
}
