import type { FileElement, FileHash, FileSchema } from "./extraction.model.js";
import type { ResolvedRef } from "./ref.model.js";
import type { FileKind } from "./theme-file.model.js";

/** Một file không phân tích được, hoặc chỉ phân tích được một phần. */
export interface FileError {
  file: string; // cùng định dạng với ThemeFile.path
  message: string;
}

/**
 * Loại node trong đồ thị: mọi loại file, cộng thêm các thứ không phải file:
 * loại trang, khoá dịch và setting.
 */
export type NodeKind = FileKind | "page_type" | "translation_key" | "setting";

/**
 * Mọi loại node, ở dạng danh sách dùng được lúc chạy: để kiểm tra giá trị
 * người dùng gõ vào (cờ --kind của CLI, tham số kind của MCP).
 *
 * `satisfies` bắt lỗi khi danh sách có tên không phải NodeKind; chiều ngược
 * lại (thêm NodeKind mới mà quên ở đây) do test của types giữ.
 */
export const NODE_KINDS = [
  "page_type",
  "layout",
  "template",
  "section",
  "section_group",
  "block",
  "snippet",
  "asset",
  "locale",
  "locale_schema",
  "config",
  "translation_key",
  "setting",
] as const satisfies readonly NodeKind[];

/**
 * Một node của đồ thị.
 *
 * - Node file: `id` chính là ThemeFile.path (ví dụ 'snippets/card.liquid')
 * - Node loại trang: `id` có tiền tố 'page:' (ví dụ 'page:product'), để không
 *   bao giờ trùng với đường dẫn của một file.
 * - Node khoá dịch: `id` có tiền tố 't:' (ví dụ 't:general.cart.title').
 * - Node setting: `id` có tiền tố 'setting:' (xem settingNodeId).
 */
export interface GraphNode {
  id: string;
  kind: NodeKind;
}

/**
 * Loại cạnh.
 *
 * - USES_TEMPLATE: loại trang -> template phục vụ trang đó
 * - USES_LAYOUT:   template -> layout bao ngoài nó
 * - RENDERS:       file này chèn nội dung của file kia (snippet, section,
 *                  section group, block)
 * - USES_ASSET:    file này tham chiếu một file trong assets/: qua asset_url,
 *                  bằng import của JavaScript (nguồn 'js'), hoặc bằng url() trong CSS (nguồn 'css').
 *                  URL đưa cho JavaScript luôn có điều kiện; mục import map không thành cạnh
 * - USES_TRANSLATION: file này dùng một khoá dịch qua filter t
 * - READS_SETTING: file này đọc giá trị của một setting
 * - LOADS_SECTION: file này (thường là một file JavaScript) tải riêng một
 *                  section lúc chạy, qua Section Rendering API. Luôn có điều
 *                  kiện: section chỉ lên trang khi mã đó chạy.
 */
export type EdgeType =
  | "USES_TEMPLATE"
  | "USES_LAYOUT"
  | "RENDERS"
  | "USES_ASSET"
  | "USES_TRANSLATION"
  | "READS_SETTING"
  | "LOADS_SECTION";

/**
 * Các loại cạnh nối FILE với FILE (và loại trang với template). Đi theo đúng
 * các cạnh này là đi theo luồng render của theme; cạnh tới khoá dịch và tới
 * setting không thuộc luồng đó.
 */
export const FILE_EDGE_TYPES: readonly EdgeType[] = [
  "USES_TEMPLATE",
  "USES_LAYOUT",
  "RENDERS",
  "USES_ASSET",
  "LOADS_SECTION",
];

/**
 * Một cạnh của đồ thị. Mỗi bộ (from, to, type) chỉ có một cạnh: nhiều lời gọi
 * giống nhau trong mã được gộp lại.
 */
export interface GraphEdge {
  from: string; // id của node nguồn
  to: string; // id của node đích
  type: EdgeType;
  // true khi MỌI lời gọi gộp vào cạnh này đều có điều kiện. Chỉ cần một lời
  // gọi không điều kiện là file đích chắc chắn được dùng.
  conditional: boolean;
  // Các nguồn của cạnh, xếp theo bảng chữ cái, nối bằng dấu phẩy:
  // 'liquid', 'json', 'schema', hoặc 'convention' cho cạnh suy từ quy ước
  // (loại trang -> template, template -> layout mặc định).
  sources: string;
  count: number; // số lời gọi trong mã đã gộp vào cạnh này
}

/** Toàn bộ đồ thị của một theme, đã sắp xếp ổn định. */
export interface ThemeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  refs: ResolvedRef[];
  schemas: FileSchema[];
  fileHashes: FileHash[];
  // Mọi định nghĩa custom element, và những lần dùng một thẻ mà theme có
  // định nghĩa. Lần dùng thẻ không ai định nghĩa thì không được giữ.
  elements: FileElement[];
  // File không phân tích được, hoặc chỉ phân tích được một phần; xếp theo file rồi message.
  fileErrors: FileError[];
}
