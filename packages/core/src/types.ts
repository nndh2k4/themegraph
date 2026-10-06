export type FileKind =
  | "layout"
  | "template"
  | "section"
  | "section_group"
  | "block"
  | "snippet"
  | "asset"
  | "locale"
  | "locale_schema"
  | "config";

export interface ThemeFile {
  path: string; // Đường dẫn tương đối của file trong theme (ví dụ: sections/header.liquid, assets/style.css...)
  kind: FileKind; 
  ext: string; // Phần mở rộng của file (ví dụ: .liquid, .json, .js, .css...)
}

export interface ScanResult {
  files: ThemeFile[];
  skipped: string[]; // Chứa đường dẫn những file cố ý không quét (ví dụ: readme.md, translation.yml...)
}

/**
 * Dạng quan hệ mà một tham chiếu thô biểu diễn.
 *
 * - render / include: gọi một snippet bằng {% render %} hoặc {% include %}
 * - section: gọi một section, từ {% section %} hoặc từ "type" trong JSON template
 * - section_group: gọi một section group bằng {% sections %}
 * - block: gọi một theme block, từ {% content_for 'block' %}, từ JSON template
 *   hoặc từ {% schema %}
 * - asset: tham chiếu một file trong assets/ qua filter asset_url
 * - layout: template chỉ định layout bao ngoài, qua khoá "layout" trong JSON
 *   hoặc tag {% layout 'ten' %} trong template Liquid
 * - no_layout: template khai rõ là KHÔNG dùng layout ("layout": false hoặc
 *   {% layout none %}). Ref loại này có `to` rỗng; nó tồn tại để tầng dựng đồ
 *   thị biết không được gán layout mặc định theme.liquid cho template đó.
 * - translation: dùng một khoá dịch qua filter t, ví dụ {{ 'cart.title' | t }}.
 *   `to` là khoá ('cart.title'), không phải tên file.
 * - setting: đọc một setting. `to` là cách mã viết: 'settings.x' (toàn cục),
 *   'section.settings.x' hoặc 'block.settings.x'. Setting đó thuộc file nào
 *   thì tầng dựng đồ thị mới xác định được, vì còn tuỳ ai render file này.
 * - section_load: JavaScript (hoặc một URL trong Liquid) xin Shopify render
 *   riêng một section qua Section Rendering API, ví dụ ?section_id=cart-drawer.
 *   `to` là tên section. Xem extract-section-loads.ts.
 */
export type RefKind =
  | "render"
  | "include"
  | "section"
  | "section_group"
  | "block"
  | "asset"
  | "layout"
  | "no_layout"
  | "translation"
  | "setting"
  | "section_load";

/**
 * Nơi quan hệ được khai báo.
 *
 * - liquid: một tag hoặc filter trong mã Liquid
 * - json: file JSON (template, section group)
 * - schema: khối {% schema %} của section hoặc block
 * - js: mã JavaScript trong assets/ (chỉ ref section_load mới có nguồn này)
 */
export type RefSource = "liquid" | "json" | "schema" | "js";

/**
 * Một tham chiếu THÔ từ file này tới một thứ khác trong theme.
 *
 * "Thô" nghĩa là `to` vẫn là cái tên viết trong mã nguồn (ví dụ 'card-product'),
 * chưa được đổi thành đường dẫn thật (snippets/card-product.liquid). Việc đổi đó
 * là của resolver, không phải của tầng parse.
 */
export interface RawRef {
  from: string; // path của file chứa lời gọi, cùng định dạng với ThemeFile.path
  to: string; // tên thô, chưa phân giải (ví dụ: card-product, header-group, base.css)
  kind: RefKind;
  source: RefSource;
  conditional: boolean; // true nếu lời gọi nằm trong if / unless / case / for
  line: number; // dòng mở tag, đếm từ 1; ref lấy từ file JSON thì là 0
  // Chỉ có ở ref render / include, và chỉ khi lời gọi truyền một tham số tên
  // "settings": {% render 'size-style', settings: block.settings %}. Bên trong
  // snippet đó, chữ settings là tham số này chứ không còn là setting toàn cục
  // của theme, nên các lần đọc settings.x ở đó không được nối vào đâu cả.
  passesSettings?: true;
}

/**
 * Những dữ kiện đọc từ khối {% schema %} của một section hoặc block mà đồ thị
 * cần giữ lại. Chúng không phải quan hệ giữa hai file, nên không thành cạnh.
 */
export interface SchemaInfo {
  // Số mục trong "presets". Section có preset thì merchant thêm được vào bất
  // kỳ template JSON nào từ theme editor, dù hiện chưa template nào dùng nó.
  presets: number;
  // true khi "blocks" có mục { "type": "@theme" }: file này nhận MỌI theme
  // block công khai (file trong blocks/ có tên không bắt đầu bằng "_").
  acceptsThemeBlocks: boolean;
}

/**
 * Vai trò của một file với một custom element:
 * - define: file gọi customElements.define("ten", ...)
 * - use:    file viết thẻ <ten>, thuộc tính is="ten", hoặc createElement("ten")
 */
export type ElementRole = "define" | "use";

/** Một custom element được nhắc tới trong một file (xem extractElements). */
export interface ElementMention {
  name: string; // tên thẻ, ví dụ 'cart-drawer'
  role: ElementRole;
  line: number; // dòng đầu tiên nó xuất hiện với vai trò này, đếm từ 1
}

/** Một ElementMention kèm file chứa nó, dạng lưu trong đồ thị. */
export interface FileElement extends ElementMention {
  file: string; // cùng định dạng với ThemeFile.path
}

/** Mọi thứ tầng parse rút ra được từ một file. */
export interface Extraction {
  refs: RawRef[];
  schema: SchemaInfo | null; // null khi file không có khối {% schema %}
  // Các khoá dịch file này ĐỊNH NGHĨA. Chỉ file locale mặc định mới có; mọi
  // file khác trả mảng rỗng.
  translationKeys: string[];
  // Id node của các setting file này ĐỊNH NGHĨA: trong {% schema %} của nó,
  // hoặc trong config/settings_schema.json với setting toàn cục.
  settings: string[];
  // Các custom element file này định nghĩa và dùng. Chỉ file .liquid và .js
  // mới có; mọi file khác trả mảng rỗng.
  elements: ElementMention[];
}

/** Dữ kiện schema của một file cụ thể, dạng lưu trong đồ thị. */
export interface FileSchema extends SchemaInfo {
  file: string; // cùng định dạng với ThemeFile.path
}

/** Hash nội dung của một file tại thời điểm phân tích (xem hashContent). */
export interface FileHash {
  file: string; // cùng định dạng với ThemeFile.path
  hash: string;
}

/**
 * Những thứ tầng parse rút ra được mà không phải là tham chiếu: chúng mô tả
 * theme CÓ gì, còn tham chiếu mô tả ai DÙNG gì. buildGraph nhận cả hai.
 */
export interface GraphFacts {
  schemas?: readonly FileSchema[];
  // Mọi khoá dịch của locale mặc định, dạng 'general.cart.title'.
  translationKeys?: readonly string[];
  // Id node của mọi setting theme định nghĩa (xem settingNodeId).
  settings?: readonly string[];
  // Hash nội dung của các file đã đọc, để status biết file nào đã đổi.
  fileHashes?: readonly FileHash[];
  // Custom element từng file định nghĩa và dùng (xem extractElements).
  elements?: readonly FileElement[];
}

/**
 * Kết quả của việc đổi một tham chiếu thô thành node đích trong đồ thị.
 *
 * - resolved: tìm thấy đích; `path` là id của node đích, tức ThemeFile.path
 *   với file, hoặc 't:<khoá>' với khoá dịch
 * - local_block: ref tới một block không có file trong blocks/, đến từ JSON
 *   template. Được coi là block cục bộ khai trong {% schema %} của section;
 *   không phải lỗi, nhưng cũng không thành cạnh trong đồ thị.
 * - missing: tham chiếu HỎNG. `expected` là đường dẫn lẽ ra phải có.
 * - none: ref không trỏ tới đâu (no_layout).
 * - unresolved: không xác định được đích khi chỉ đọc mã. Chỉ gặp ở ref đọc
 *   setting: một snippet đọc section.settings.x mà không section nào gọi nó
 *   khai x. Không phải lỗi, chỉ là giới hạn của phân tích tĩnh.
 */
export type Resolution =
  | { status: "resolved"; path: string }
  | { status: "local_block" }
  | { status: "missing"; expected: string }
  | { status: "none" }
  | { status: "unresolved" };

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
 * - USES_ASSET:    file này tham chiếu một file trong assets/
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

/**
 * Một tham chiếu thô kèm kết quả phân giải. Giữ lại từng lời gọi riêng lẻ
 * (có số dòng), kể cả lời gọi hỏng, thứ mà cạnh đã gộp không còn giữ.
 */
export interface ResolvedRef extends RawRef {
  status: Resolution["status"];
  // resolved: id của node đích; missing: id lẽ ra phải có;
  // local_block, none và unresolved: null.
  target: string | null;
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
}
