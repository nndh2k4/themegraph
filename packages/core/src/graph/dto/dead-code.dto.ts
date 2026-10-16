import type { FileError, NodeKind } from "../../models/index.js";

/**
 * Mức tin cậy của một kết luận "file này không được dùng".
 *
 * - certain: mọi cách dùng loại file này đều hiện ra trong đồ thị, và đồ thị
 *   không có cách nào. Xoá được.
 * - review:  đồ thị không thấy ai dùng, nhưng loại file này còn những cách
 *   dùng mà phân tích tĩnh mã Liquid không nhìn thấy (xem REVIEW_ROOT_KINDS).
 *   Phải có người kiểm tra trước khi xoá.
 */
export type DeadConfidence = "certain" | "review";

/**
 * Vì sao file bị coi là không được dùng.
 *
 * - unreferenced:        không file nào gọi nó
 * - only_used_by_unused: có file gọi nó, nhưng mọi file gọi đều nằm trong
 *                        chính danh sách này
 */
export type DeadReason = "unreferenced" | "only_used_by_unused";

/** Một file không trang nào dùng tới. */
export interface DeadFile {
  id: string;
  kind: NodeKind;
  confidence: DeadConfidence;
  reason: DeadReason;
  usedBy: string[]; // các file gọi trực tiếp tới nó (đều là file không dùng)
}

/** Một custom element mà file JavaScript định nghĩa, và những file đang dùng thẻ đó. */
export interface NeededElement {
  name: string; // tên thẻ, ví dụ 'disclosures-close'
  usedBy: string[]; // các file ĐANG DÙNG có viết thẻ này, xếp theo id
}

/**
 * Một asset không trang nào nạp, nhưng lại định nghĩa custom element mà một
 * file đang dùng viết ra. Đây không phải mã chết mà là một lỗi của theme:
 * thiếu thẻ <script> nạp file, nên thẻ hiện ra mà hành vi không chạy.
 */
export interface NotLoadedAsset {
  id: string;
  elements: NeededElement[]; // xếp theo tên thẻ
  usedBy: string[]; // các file gọi nó; đều là file không dùng, thường là rỗng
}

/** Kết quả của deadCode(). */
export interface DeadCodeResult {
  // Mức certain trước, rồi review; trong mỗi mức xếp theo id. Không gồm các
  // asset ở `notLoaded`.
  files: DeadFile[];
  certain: number;
  review: number;
  // Asset không trang nào nạp nhưng có nơi cần tới (xem NotLoadedAsset), xếp
  // theo id. Tách khỏi `files` vì lời khuyên ngược hẳn: không xoá, mà nạp nó.
  notLoaded: NotLoadedAsset[];
  // File không phân tích được trọn vẹn. Quan hệ của chúng có thể thiếu, nên khi
  // danh sách này khác rỗng thì mọi mục của `files` đều ở mức review.
  fileErrors: FileError[];
  // Theme có file ĐANG DÙNG nào nhận mọi theme block qua "@theme" hay không.
  // Nếu có, block công khai không bao giờ bị báo, vì merchant thêm được chúng
  // vào file đó. Một file nhận "@theme" mà chính nó không ai dùng thì không
  // tính: không có nó trên trang nào thì cũng không thêm được gì vào nó.
  acceptsThemeBlocks: boolean;
  // Khoá dịch có trong locale mặc định mà không file nào gọi bằng tên viết
  // sẵn. Luôn ở mức cần xem lại: khoá còn có thể được gọi bằng tên ghép lúc
  // chạy ('products.' | append: handle | t), thứ đồ thị không thấy.
  unusedTranslationKeys: string[];
  // Setting có trong schema mà không file nào đọc bằng tên viết sẵn, ghi ở
  // dạng id không có tiền tố 'setting:'. Cũng luôn ở mức cần xem lại, vì còn
  // hai cách đọc mà đồ thị không thấy:
  //   - tên ghép từ dữ liệu lúc chạy: section.settings[block.id]. Tên ghép từ
  //     chữ viết sẵn, kể cả qua tham số của snippet, thì đồ thị đã tính ra
  //     (xem liquid-values.ts, call-context.ts);
  //   - vài setting toàn cục do chính Shopify đọc (ví dụ của trang thanh toán).
  unusedSettings: string[];
}
