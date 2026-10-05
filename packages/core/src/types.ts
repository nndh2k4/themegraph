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
 */
export type RefKind =
  | "render"
  | "include"
  | "section"
  | "section_group"
  | "block"
  | "asset"
  | "layout"
  | "no_layout";

/**
 * Nơi quan hệ được khai báo.
 *
 * - liquid: một tag hoặc filter trong mã Liquid
 * - json: file JSON (template, section group)
 * - schema: khối {% schema %} của section hoặc block
 */
export type RefSource = "liquid" | "json" | "schema";

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

/** Mọi thứ tầng parse rút ra được từ một file. */
export interface Extraction {
  refs: RawRef[];
  schema: SchemaInfo | null; // null khi file không có khối {% schema %}
}

/** Dữ kiện schema của một file cụ thể, dạng lưu trong đồ thị. */
export interface FileSchema extends SchemaInfo {
  file: string; // cùng định dạng với ThemeFile.path
}

/**
 * Kết quả của việc đổi một tham chiếu thô thành file thật trong theme.
 *
 * - resolved: tìm thấy file đích, `path` cùng định dạng với ThemeFile.path
 * - local_block: ref tới một block không có file trong blocks/, đến từ JSON
 *   template. Được coi là block cục bộ khai trong {% schema %} của section;
 *   không phải lỗi, nhưng cũng không thành cạnh trong đồ thị.
 * - missing: tham chiếu HỎNG. `expected` là đường dẫn lẽ ra phải có.
 * - none: ref không trỏ tới đâu (no_layout).
 */
export type Resolution =
  | { status: "resolved"; path: string }
  | { status: "local_block" }
  | { status: "missing"; expected: string }
  | { status: "none" };

/** Loại node trong đồ thị: mọi loại file, cộng thêm loại trang. */
export type NodeKind = FileKind | "page_type";

/**
 * Một node của đồ thị.
 *
 * - Node file: `id` chính là ThemeFile.path (ví dụ 'snippets/card.liquid')
 * - Node loại trang: `id` có tiền tố 'page:' (ví dụ 'page:product'), để không
 *   bao giờ trùng với đường dẫn của một file.
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
 */
export type EdgeType = "USES_TEMPLATE" | "USES_LAYOUT" | "RENDERS" | "USES_ASSET";

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
  // resolved: đường dẫn file đích; missing: đường dẫn lẽ ra phải có;
  // local_block và none: null.
  target: string | null;
}

/** Toàn bộ đồ thị của một theme, đã sắp xếp ổn định. */
export interface ThemeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  refs: ResolvedRef[];
  schemas: FileSchema[];
}
