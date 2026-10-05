import { stripLeadingComment } from "./extract-json.js";
import type { ThemeFile } from "./types.js";

/**
 * Các dạng số nhiều mà Shopify hiểu. Một khoá dịch có số nhiều được viết
 * thành một object chỉ gồm các khoá này:
 *
 *   "items": { "one": "{{ count }} item", "other": "{{ count }} items" }
 *
 * và được gọi bằng tên của object đó: {{ 'cart.items' | t: count: n }}.
 */
export const PLURAL_FORMS: ReadonlySet<string> = new Set(["zero", "one", "two", "few", "many", "other"]);

/** Kiểm tra một giá trị có phải object thường (không phải null, không phải mảng). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Một object là nhóm số nhiều khi mọi khoá của nó là dạng số nhiều và mọi giá trị là chuỗi. */
function isPluralGroup(value: Record<string, unknown>): boolean {
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, text]) => PLURAL_FORMS.has(key) && typeof text === "string");
}

/**
 * File locale mặc định của theme, ví dụ locales/en.default.json. Đây là file
 * Shopify dùng khi ngôn ngữ của khách không có bản dịch, nên nó là nơi định
 * nghĩa "theme có những khoá dịch nào". Các file locale khác chỉ là bản dịch
 * của cùng bộ khoá đó.
 *
 * locales/en.default.schema.json không tính: đó là chữ của theme editor, có
 * kind riêng là locale_schema.
 */
export function isDefaultLocale(file: ThemeFile): boolean {
  return file.kind === "locale" && file.path.endsWith(".default.json");
}

/**
 * Đọc một file locale và trả về mọi khoá dịch trong đó, viết ở dạng nối bằng
 * dấu chấm như cách mã Liquid gọi chúng:
 *
 *   { "general": { "cart": { "title": "Cart" } } }   ->   general.cart.title
 *
 * Kết quả giữ thứ tự xuất hiện trong file. Ném lỗi có tên file nếu nội dung
 * không phải JSON hợp lệ.
 */
export function collectTranslationKeys(file: ThemeFile, content: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(stripLeadingComment(content));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Không đọc được JSON của "${file.path}": ${reason}`, { cause: error });
  }

  const keys: string[] = [];

  /** Đi đệ quy xuống cây JSON; `prefix` là đường đi từ gốc tới object này. */
  const visit = (node: unknown, prefix: string): void => {
    if (!isObject(node)) return;

    for (const [name, value] of Object.entries(node)) {
      const key = prefix === "" ? name : `${prefix}.${name}`;

      // Chuỗi là một câu dịch; nhóm số nhiều được gọi như một khoá duy nhất.
      if (typeof value === "string" || (isObject(value) && isPluralGroup(value))) {
        keys.push(key);
      } else {
        visit(value, key);
      }
    }
  };

  visit(data, "");
  return keys;
}
