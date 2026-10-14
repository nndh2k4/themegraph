import type { EdgeType, GraphNode, NodeKind, RefKind } from "../../models/index.js";
import type { Reached } from "../graph.repository.js";

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
