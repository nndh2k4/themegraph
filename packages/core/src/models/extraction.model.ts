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
}
