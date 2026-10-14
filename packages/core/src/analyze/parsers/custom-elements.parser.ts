import type { ElementMention, ElementRole } from "./types.js";

/**
 * Tìm những chỗ một file ĐỊNH NGHĨA hoặc DÙNG một custom element.
 *
 * Theme hiện đại gắn hành vi JavaScript vào HTML bằng custom element: file
 * assets/cart-drawer.js gọi customElements.define("cart-drawer", ...), còn
 * Liquid chỉ cần viết thẻ <cart-drawer>. Giữa hai file đó không có lời gọi
 * nào: thẻ chỉ hoạt động nếu trang còn nạp file JavaScript kia bằng một thẻ
 * <script> ở đâu đó. Quên thẻ <script> thì trang vẫn hiện ra bình thường,
 * chỉ là hành vi không chạy, và đồ thị thấy file JavaScript "không ai dùng".
 *
 * Ghi lại cả hai phía cho phép dead-code phân biệt hai trường hợp đó: file
 * không ai cần (xoá được) và file có nơi cần mà không ai nạp (lỗi của theme).
 *
 * File này KHÔNG phân tích cú pháp JavaScript hay HTML. Nó tìm bốn cách viết,
 * và chỉ khi tên thẻ được viết sẵn thành chữ:
 *
 *   định nghĩa   customElements.define("ten-the", ...)
 *   dùng         <ten-the ...>                    thẻ mở
 *                is="ten-the"                     thẻ có sẵn được mở rộng
 *                createElement("ten-the")
 *
 * Cùng một bộ mẫu áp cho cả file .js lẫn .liquid: Liquid có thể chứa thẻ
 * <script> định nghĩa thẻ, và JavaScript có thể chứa chuỗi HTML dùng thẻ.
 *
 * Tìm bằng mẫu nên có thể thấy thừa phía "dùng" (ví dụ so sánh `i<n-1` trong
 * JavaScript giống thẻ <n-1). Việc đó vô hại: buildGraph chỉ giữ lần dùng
 * của những tên mà theme thật sự có định nghĩa.
 */

/**
 * Tên hợp lệ của một custom element: bắt đầu bằng chữ thường và có ít nhất
 * một gạch ngang. Chính gạch ngang phân biệt nó với thẻ HTML có sẵn.
 */
const NAME = "[a-z][a-z0-9._]*-[a-z0-9._-]*";

const DEFINE = new RegExp(`customElements\\s*\\.\\s*define\\(\\s*["'\`](${NAME})["'\`]`, "g");
// (?=[\s>/]) đòi tên kết thúc ở đó: "<my-{{ kind }}" không phải một tên viết sẵn.
const OPEN_TAG = new RegExp(`<(${NAME})(?=[\\s>/])`, "g");
// (?<![\w-]) để "this=" hay "data-is=" không bị coi là thuộc tính is.
const IS_ATTRIBUTE = new RegExp(`(?<![\\w-])is=["'](${NAME})["']`, "g");
const CREATE_ELEMENT = new RegExp(`createElement\\(\\s*["'\`](${NAME})["'\`]`, "g");

/** Chú thích Liquid và chú thích HTML: mã nằm trong đó không chạy. */
const COMMENTS = /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}|<!--[\s\S]*?-->/g;

/**
 * Thay nội dung các chú thích bằng dấu cách, giữ nguyên ký tự xuống dòng để
 * số dòng của phần còn lại không đổi.
 */
function blankComments(content: string): string {
  return content.replace(COMMENTS, (comment) => comment.replace(/[^\n]/g, " "));
}

/** Số dòng (đếm từ 1) của vị trí `index` trong `content`. */
function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Vị trí `index` có nằm sau một dấu // trên cùng dòng không (chú thích của JavaScript). */
function afterLineComment(content: string, index: number): boolean {
  const lineStart = content.lastIndexOf("\n", index - 1) + 1;
  return content.slice(lineStart, index).includes("//");
}

/**
 * Trích các custom element mà nội dung này định nghĩa và dùng.
 *
 * Mỗi cặp (tên, vai trò) chỉ có một dòng trong kết quả, mang số dòng của lần
 * xuất hiện đầu tiên. Kết quả xếp theo vị trí trong file.
 */
export function extractElements(content: string): ElementMention[] {
  const text = blankComments(content);
  const found: { name: string; role: ElementRole; index: number }[] = [];

  for (const match of text.matchAll(DEFINE)) {
    // Một lời gọi define bị tắt bằng // không định nghĩa gì cả.
    if (match[1] !== undefined && !afterLineComment(text, match.index)) {
      found.push({ name: match[1], role: "define", index: match.index });
    }
  }

  for (const pattern of [OPEN_TAG, IS_ATTRIBUTE, CREATE_ELEMENT]) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] !== undefined) found.push({ name: match[1], role: "use", index: match.index });
    }
  }

  found.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const mentions: ElementMention[] = [];

  for (const { name, role, index } of found) {
    const key = `${role} ${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ name, role, line: lineAt(text, index) });
  }

  return mentions;
}
