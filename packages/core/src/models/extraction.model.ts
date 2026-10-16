import type { FileError } from "./graph.model.js";
import type { RawRef } from "./ref.model.js";

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
  // Type của các block CỤC BỘ (mục có "name" trong "blocks" của schema). Chỉ
  // dùng lúc dựng đồ thị, để ref block trong JSON template không bị nối sang
  // file cùng tên trong blocks/; không lưu vào đồ thị.
  localBlockTypes?: string[];
}

/**
 * Vai trò của một file với một custom element:
 * - define: file gọi customElements.define("ten", ...)
 * - use:    file viết thẻ <ten>, thuộc tính is="ten", hoặc createElement("ten")
 */
export type ElementRole = "define" | "use";

/** Một custom element được nhắc tới trong một file (xem CustomElementsParser). */
export interface ElementMention {
  name: string; // tên thẻ, ví dụ 'cart-drawer'
  role: ElementRole;
  line: number; // dòng đầu tiên nó xuất hiện với vai trò này, đếm từ 1
}

/** Một ElementMention kèm file chứa nó, dạng lưu trong đồ thị. */
export interface FileElement extends ElementMention {
  file: string; // cùng định dạng với ThemeFile.path
}

/**
 * Một dòng của import map (<script type="importmap">): mã JavaScript viết
 * `import "@theme/global"` thì trình duyệt nạp file assets/core.js.
 */
export interface ImportMapEntry {
  specifier: string; // khoá của import map, ví dụ '@theme/global'
  asset: string; // tên file trong assets/ mà khoá trỏ tới, ví dụ 'core.js'
}

/** Một ImportMapEntry kèm file Liquid khai nó. */
export interface FileImportMapEntry extends ImportMapEntry {
  file: string; // cùng định dạng với ThemeFile.path
}

/** Một giá trị Liquid tính được khi chỉ đọc mã: chuỗi, số, true/false/nil, hoặc mảng các giá trị đó. */
export type StaticValue = string | number | boolean | null | readonly StaticValue[];

/**
 * Những loại đối tượng của Shopify mà đồ thị cần nhận ra khi chúng được gán
 * sang tên khác hay truyền vào snippet, vì setting được đọc qua chúng:
 *
 * - settings:         setting toàn cục của theme
 * - section, block:   section hay block đang render
 * - blocks:           danh sách block của section (section.blocks)
 * - section.settings, block.settings: bộ setting của section hay block
 */
export type ObjectKind = "settings" | "section" | "block" | "blocks" | "section.settings" | "block.settings";

/**
 * Một loại đối tượng kèm NGUỒN GỐC của nó: các file mà đối tượng đó thuộc
 * về. section.settings truyền từ sections/product.liquid có nguồn gốc là
 * file đó, kể cả sau khi đi qua nhiều tầng snippet. Lần đọc setting qua đối
 * tượng này chỉ được nối tới setting của các file nguồn gốc.
 */
export interface ObjectOrigin {
  kind: ObjectKind;
  origins: string[]; // đường dẫn file, đã xếp
}

/** Một tham số truyền vào snippet: nó là đối tượng loại nào, và có thể mang giá trị nào. */
export interface CallArgument {
  name: string;
  kinds: ObjectOrigin[];
  // Các giá trị có thể có, khi tính được (xem liquid-values.ts); null nếu không biết.
  values: StaticValue[] | null;
}

/**
 * Một lời gọi snippet, kèm những gì nơi gọi truyền vào. Với {% render %} đó
 * là các tham số (cả `with x as y` và `for x as y`); với {% include %}, vốn
 * dùng chung biến với nơi gọi, đó là mọi biến của nơi gọi.
 */
export interface SnippetCall {
  snippet: string; // tên snippet như viết trong mã, ví dụ 'card-product'
  args: CallArgument[];
}

/**
 * Những gì một snippet nhận được từ MỌI nơi gọi nó, theo tên tham số: gộp
 * loại đối tượng và giá trị của các nơi gọi. Tầng parse dùng nó để hiểu
 * `section_st.title` trong snippet khi nơi gọi viết `section_st: section.settings`.
 */
export interface CallContext {
  kinds: ReadonlyMap<string, readonly ObjectOrigin[]>;
  values: ReadonlyMap<string, readonly StaticValue[]>;
}

/**
 * Một setting có kiểu là tài nguyên của cửa hàng (product, collection...).
 * Theme block con đọc nó qua closest.<kiểu>, không viết tên setting.
 */
export interface ResourceSetting {
  setting: string; // id node của setting (xem settingNodeId)
  type: string; // 'product', 'collection', 'article', 'blog' hoặc 'page'
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
  // Các dòng import map file này khai. Chỉ file .liquid mới có; mọi file khác
  // trả mảng rỗng.
  importMap: ImportMapEntry[];
  // Các lời gọi snippet của file, kèm tham số (xem SnippetCall). Chỉ file
  // .liquid mới có; dùng để dựng CallContext cho snippet, không thành cạnh.
  calls: SnippetCall[];
  // Các setting kiểu tài nguyên mà schema của file khai (xem ResourceSetting).
  resourceSettings: ResourceSetting[];
  // Lỗi ở MỘT PHẦN của file (ví dụ JSON trong {% schema %} hỏng). File vẫn được
  // phân tích; các quan hệ còn đọc được vẫn có trong `refs`.
  warnings: string[];
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
 * theme CÓ gì, còn tham chiếu mô tả ai DÙNG gì. GraphBuilder nhận cả hai.
 */
export interface GraphFacts {
  schemas?: readonly FileSchema[];
  // Mọi khoá dịch của locale mặc định, dạng 'general.cart.title'.
  translationKeys?: readonly string[];
  // Id node của mọi setting theme định nghĩa (xem settingNodeId).
  settings?: readonly string[];
  // Hash nội dung của các file đã đọc, để status biết file nào đã đổi.
  fileHashes?: readonly FileHash[];
  // Custom element từng file định nghĩa và dùng (xem CustomElementsParser).
  elements?: readonly FileElement[];
  // Import map của theme, để đổi specifier của ref import thành file.
  importMap?: readonly FileImportMapEntry[];
  // Setting kiểu tài nguyên của mọi file, để phân giải closest.<kiểu>.
  resourceSettings?: readonly ResourceSetting[];
  // File không phân tích được trọn vẹn, để dead-code và context cảnh báo.
  fileErrors?: readonly FileError[];
}
