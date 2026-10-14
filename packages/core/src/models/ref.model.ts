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
 *   `to` là tên section. Xem section-loads.parser.ts.
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
 * Một tham chiếu thô kèm kết quả phân giải. Giữ lại từng lời gọi riêng lẻ
 * (có số dòng), kể cả lời gọi hỏng, thứ mà cạnh đã gộp không còn giữ.
 */
export interface ResolvedRef extends RawRef {
  status: Resolution["status"];
  // resolved: id của node đích; missing: id lẽ ra phải có;
  // local_block, none và unresolved: null.
  target: string | null;
}
