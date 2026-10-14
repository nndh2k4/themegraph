import type { EdgeType, GraphNode, NodeKind, RefKind } from "../models/index.js";
import type { GraphRepository, NeighborEdge, Reached } from "./graph.repository.js";
import { impact } from "./impact.service.js";
import { findNode } from "./node-finder.service.js";
import type { FindNodeOptions } from "./node-finder.service.js";

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
  sources: string; // 'liquid', 'json', 'schema', 'js', 'convention', nối bằng dấu phẩy
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
export function context(graph: GraphRepository, name: string, options: FindNodeOptions = {}): ContextResult {
  const node = findNode(graph, name, options);

  /** Đổi một cạnh kề thành một quan hệ, kèm các dòng có lời gọi trong file GỌI. */
  const toLink = (edge: NeighborEdge, other: string): ContextLink => ({
    id: other,
    kind: edge.neighborKind,
    type: edge.type,
    conditional: edge.conditional,
    count: edge.count,
    sources: edge.sources,
    lines: graph.refLines(edge.from, edge.to),
  });

  // Không cần lọc trạng thái khi tìm số dòng: đích ở đây là một node có thật,
  // mà ref hỏng thì đích của nó là đường dẫn của một file không tồn tại.
  const broken = graph.missingRefsFrom(node.id).map((ref) => ({
    name: ref.to,
    kind: ref.kind,
    line: ref.line,
    conditional: ref.conditional,
    expected: String(ref.target),
  }));

  // "File này thuộc trang nào" chính là phần trang của truy vấn impact.
  const { pages, totalPages } = impact(graph, node.id);

  // Một section dùng vài chục khoá dịch và setting là chuyện thường. Để lẫn
  // chúng vào danh sách file được gọi thì danh sách đó hết đọc nổi, nên tách riêng.
  const outgoing = graph.edgesFrom(node.id).map((edge) => toLink(edge, edge.to));

  return {
    node,
    usedBy: graph.edgesTo(node.id).map((edge) => toLink(edge, edge.from)),
    uses: outgoing.filter((link) => link.type !== TRANSLATION_EDGE && link.type !== SETTING_EDGE),
    translations: outgoing.filter((link) => link.type === TRANSLATION_EDGE),
    settings: outgoing.filter((link) => link.type === SETTING_EDGE),
    broken,
    pages,
    totalPages,
  };
}
