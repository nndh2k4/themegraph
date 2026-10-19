import type { RawRef } from "../../models/index.js";
import { scriptRanges } from "./import-map.parser.js";
import { lineIndex } from "./line-index.js";

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

/** Thay mọi ký tự trừ xuống dòng bằng dấu cách, để số dòng không đổi. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

/** Một chỗ nạp module; `index` là vị trí trong chuỗi đã tìm, để xếp theo thứ tự viết. */
interface FoundImport {
  to: string;
  index: number;
  conditional: boolean;
}

/**
 * Các chỗ nạp module trong mã `content`. `withStatic` là false thì chỉ tìm
 * import() động (xem extractInlineScriptImports).
 */
function findImports(content: string, withStatic: boolean): FoundImport[] {
  const code = content.replace(COMMENTS, blank);
  const found: FoundImport[] = [];

  if (withStatic) {
    for (const match of code.matchAll(STATIC)) {
      if (match[2] !== undefined) found.push({ to: match[2], index: match.index, conditional: false });
    }
  }
  for (const match of code.matchAll(DYNAMIC)) {
    // `./${name}.js` là một biểu thức, không phải specifier viết sẵn.
    if (match[2] !== undefined && !match[2].includes("${")) {
      found.push({ to: match[2], index: match.index, conditional: true });
    }
  }

  return found;
}

/** Đổi các chỗ tìm được thành ref, theo thứ tự viết; `content` để tính số dòng. */
function toRefs(from: string, content: string, found: FoundImport[]): RawRef[] {
  const lineAt = lineIndex(content);

  return found
    .sort((a, b) => a.index - b.index)
    .map(({ to, index, conditional }) => ({
      from,
      to,
      kind: "import" as const,
      source: "js" as const,
      conditional,
      line: lineAt(index),
    }));
}

/** Các module mà mã JavaScript `content` của file `from` nạp. */
export function extractImports(from: string, content: string): RawRef[] {
  return toRefs(from, content, findImports(content, true));
}

/**
 * Các module mà thẻ <script> viết thẳng trong một file Liquid nạp:
 *   - trong <script type="module">: cả import tĩnh lẫn import() động
 *   - trong <script> thường: chỉ import() động. Trình duyệt chạy import()
 *     trong mọi script, còn import tĩnh ngoài module là lỗi cú pháp nên
 *     không nạp gì.
 *
 * Bỏ qua <script src="..."> (thân rỗng) và <script type="importmap"> (chỉ là
 * ánh xạ, xem scriptRanges). Phần ngoài các thẻ script bị xoá trắng trước khi
 * tìm, để chữ "import" trong HTML hay trong Liquid không bị tính.
 */
export function extractInlineScriptImports(from: string, content: string): RawRef[] {
  let modules = "";
  let classic = "";
  let cursor = 0;

  for (const { start, end, kind, isModule } of scriptRanges(content)) {
    // start < cursor: chữ "<script>" nằm trong thân một script trước đó.
    if (kind !== "inline" || start < cursor) continue;

    // Hai bản sao của file, mỗi bản chỉ giữ thân của một loại script, để vị
    // trí trong cả hai bản vẫn là vị trí trong file gốc.
    const gap = blank(content.slice(cursor, start));
    const body = content.slice(start, end);
    modules += gap + (isModule ? body : blank(body));
    classic += gap + (isModule ? blank(body) : body);
    cursor = end;
  }

  if (cursor === 0) return [];
  return toRefs(from, content, [...findImports(modules, true), ...findImports(classic, false)]);
}
