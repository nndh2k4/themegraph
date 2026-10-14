import type { RawRef, RefSource } from "./types.js";

/**
 * Tìm những chỗ một file yêu cầu Shopify render RIÊNG một section rồi trả về
 * HTML của nó (Section Rendering API). Đây là cách JavaScript của theme cập
 * nhật một phần trang mà không tải lại: giỏ hàng dạng ngăn kéo, xem nhanh sản
 * phẩm, gợi ý tìm kiếm...
 *
 * Section được tải kiểu này không có lời gọi {% section %} nào và không nằm
 * trong template JSON nào, nên nếu không quét ở đây thì đồ thị coi nó là
 * "không trang nào dùng".
 *
 * File này KHÔNG phân tích cú pháp JavaScript. Nó chỉ tìm bốn cách viết của
 * API đó, và chỉ khi tên section được viết sẵn thành chữ:
 *
 *   1. ?section_id=cart-drawer            trong một URL (cả ở file .js lẫn .liquid)
 *   2. ?sections=cart-drawer,cart-icon    như trên, nhiều section
 *   3. section: 'cart-icon-bubble'        thuộc tính của object, chỉ ở file .js
 *   4. id: 'cart-notification-product'    chỉ bên trong getSectionsToRender() { ... }
 *
 * Dạng 3 và 4 là quy ước của theme Dawn mà hầu hết theme khác chép theo: một
 * hàm getSectionsToRender() trả về danh sách section cần xin lại.
 *
 * Tên là biến thì bỏ qua: `section_id=${this.sectionId}` và
 * `section_id={{ section.id }}` không cho biết section nào. Vì vậy quan hệ
 * tìm được ở đây là một phần của sự thật, không phải toàn bộ.
 *
 * Mọi kết quả đều `conditional: true`: section chỉ được tải khi người dùng làm
 * một việc gì đó trên trang. Cái tên tìm được có ứng với một file trong
 * sections/ hay không là việc của resolver; tên không ứng với file nào thì bị
 * bỏ, không coi là tham chiếu hỏng.
 */

/** Tên một section: chữ, số, gạch ngang, gạch dưới; bắt đầu bằng chữ hoặc số. */
const NAME = "[A-Za-z0-9][A-Za-z0-9_-]*";

// (?![\w${-]) chặn trường hợp tên chỉ là phần đầu của một biểu thức, ví dụ
// "section_id=main-${type}": chữ "main-" không phải là tên một section.
const SECTION_ID = new RegExp(`[?&"'\`]section_id=(${NAME})(?![\\w\${-])`, "g");
const SECTIONS = new RegExp(`[?&"'\`]sections=(${NAME}(?:,${NAME})*)(?![\\w\${,-])`, "g");
const SECTION_PROPERTY = new RegExp(`\\bsection:\\s*["'](${NAME})["']`, "g");
const ID_PROPERTY = new RegExp(`\\bid:\\s*["'](${NAME})["']`, "g");
const SECTIONS_TO_RENDER = /getSectionsToRender\s*\([^)]*\)\s*\{/g;

/** Số dòng (đếm từ 1) của vị trí `index` trong `content`. */
function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Trích các section mà nội dung này tải qua Section Rendering API.
 *
 * `from` là đường dẫn của file; `source` cho biết đó là file JavaScript hay
 * Liquid. Dạng 3 và 4 chỉ áp dụng cho JavaScript, vì trong Liquid chữ
 * "section:" và "id:" xuất hiện ở rất nhiều chỗ không liên quan.
 */
export function extractSectionLoads(from: string, content: string, source: Extract<RefSource, "js" | "liquid">): RawRef[] {
  const found: { name: string; index: number }[] = [];

  for (const match of content.matchAll(SECTION_ID)) {
    if (match[1] !== undefined) found.push({ name: match[1], index: match.index });
  }
  for (const match of content.matchAll(SECTIONS)) {
    for (const name of (match[1] ?? "").split(",")) found.push({ name, index: match.index });
  }

  if (source === "js") {
    for (const match of content.matchAll(SECTION_PROPERTY)) {
      if (match[1] !== undefined) found.push({ name: match[1], index: match.index });
    }

    // Thân của getSectionsToRender() kết thúc ở câu return đầu tiên của nó;
    // lấy tới dấu "];" đầu tiên là đủ để gồm cả mảng được trả về.
    for (const definition of content.matchAll(SECTIONS_TO_RENDER)) {
      const start = definition.index;
      const end = content.indexOf("];", start);
      const body = content.slice(start, end === -1 ? start : end);

      for (const match of body.matchAll(ID_PROPERTY)) {
        if (match[1] !== undefined) found.push({ name: match[1], index: start + match.index });
      }
    }
  }

  // Một section thường được nhắc nhiều lần trong một file; mỗi lần là một ref,
  // để số dòng của từng chỗ còn tra lại được. Xếp theo vị trí trong file.
  return found
    .sort((a, b) => a.index - b.index || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ name, index }) => ({
      from,
      to: name,
      kind: "section_load" as const,
      source,
      conditional: true,
      line: lineAt(content, index),
    }));
}
