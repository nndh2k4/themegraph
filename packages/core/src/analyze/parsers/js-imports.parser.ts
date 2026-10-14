import type { RawRef } from "../../models/index.js";

/**
 * Tìm những chỗ mã JavaScript nạp một module khác:
 *
 *   import "./core.js";                     tĩnh, chỉ để chạy module
 *   import { Cart } from "@theme/cart";     tĩnh, lấy tên từ module
 *   export * from "./util.js";              tĩnh, xuất lại
 *   import("@theme/product-switcher")       động: chỉ nạp khi dòng đó chạy
 *
 * `to` của ref là specifier đúng như viết; việc đổi nó thành file (qua import
 * map hoặc theo đường dẫn tương đối) là của tầng dựng đồ thị.
 *
 * File này KHÔNG phân tích cú pháp JavaScript: nó tìm các mẫu chữ trên sau
 * khi xoá chú thích, và chỉ khi specifier được viết sẵn thành chữ.
 * import(duongDan) với một biến thì không biết được khi đọc mã.
 *
 * Import tĩnh là không điều kiện: module được nạp ngay khi file chứa nó được
 * nạp. Import động là có điều kiện.
 */

// (?<![\w$."'`]) để "module.import", "reimport" hay chữ "import" trong một
// chuỗi không bị tính. Phần giữa import và from chỉ gồm tên, dấu * { } và dấu
// phẩy, nên một chữ "import" lạc trong câu lệnh khác không khớp được.
const STATIC = /(?<![\w$."'`])(?:import|export)\s*(?:[\w$*{},\s]*?\s*from\s*)?(["'])([^"'\s,][^"'\n]*?)\1/g;
const DYNAMIC = /(?<![\w$."'`])import\s*\(\s*(["'`])([^"'`\s,][^"'`\n]*?)\1\s*[,)]/g;

// Chú thích /* */, và chú thích // không đứng sau dấu hai chấm (để "https://"
// trong một chuỗi không bị coi là chú thích) hay sau dấu ngoặc kép.
const COMMENTS = /\/\*[\s\S]*?\*\/|(?<![:"'`\\])\/\/[^\n]*/g;

/** Thẻ mở và thẻ đóng của một <script type="module"> trong file Liquid. */
const MODULE_SCRIPT_OPEN = /<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*>/gi;
const SCRIPT_CLOSE = /<\/script\s*>/gi;

/** Thay mọi ký tự trừ xuống dòng bằng dấu cách, để số dòng không đổi. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

/** Số dòng (đếm từ 1) của vị trí `index` trong `content`. */
function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Các module mà mã JavaScript `content` của file `from` nạp. */
export function extractImports(from: string, content: string): RawRef[] {
  const code = content.replace(COMMENTS, blank);
  const found: { to: string; index: number; conditional: boolean }[] = [];

  for (const match of code.matchAll(STATIC)) {
    if (match[2] !== undefined) found.push({ to: match[2], index: match.index, conditional: false });
  }
  for (const match of code.matchAll(DYNAMIC)) {
    // `./${name}.js` là một biểu thức, không phải specifier viết sẵn.
    if (match[2] !== undefined && !match[2].includes("${")) {
      found.push({ to: match[2], index: match.index, conditional: true });
    }
  }

  return found
    .sort((a, b) => a.index - b.index)
    .map(({ to, index, conditional }) => ({
      from,
      to,
      kind: "import" as const,
      source: "js" as const,
      conditional,
      line: lineAt(code, index),
    }));
}

/**
 * Các module mà thẻ <script type="module"> viết thẳng trong một file Liquid
 * nạp. Phần ngoài các thẻ đó bị xoá trắng trước khi tìm, để chữ "import"
 * trong HTML hay trong Liquid không bị tính.
 */
export function extractModuleScriptImports(from: string, content: string): RawRef[] {
  let code = "";
  let cursor = 0;

  for (const open of content.matchAll(MODULE_SCRIPT_OPEN)) {
    const start = open.index + open[0].length;
    if (start < cursor) continue;

    SCRIPT_CLOSE.lastIndex = start;
    const close = SCRIPT_CLOSE.exec(content);
    const end = close === null ? content.length : close.index;

    code += blank(content.slice(cursor, start)) + content.slice(start, end);
    cursor = end;
  }

  return cursor === 0 ? [] : extractImports(from, code);
}
