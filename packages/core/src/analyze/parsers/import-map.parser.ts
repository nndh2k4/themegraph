import { NodeTypes } from "@shopify/liquid-html-parser";
import type { DocumentNode, LiquidHtmlNode, LiquidTagFor, LiquidVariable } from "@shopify/liquid-html-parser";

import type { ImportMapEntry } from "../../models/index.js";
import type { LiquidValues, LoopBindings } from "./liquid-values.js";

/**
 * Đọc import map mà một file Liquid in ra:
 *
 *   <script type="importmap">
 *     { "imports": { "@theme/global": "{{ 'core.js' | asset_url }}" } }
 *   </script>
 *
 * Nhờ nó, mã JavaScript viết `import "@theme/global"` mà trình duyệt nạp
 * assets/core.js. Không đọc import map thì đồ thị không nối được hai file đó.
 *
 * Import map thường được SINH bằng một vòng lặp chứ không viết tay từng dòng:
 *
 *   {%- for entry in modules -%}
 *     {%- assign pair = entry | split: ':' -%}
 *     "@theme/{{ pair.first }}": "{{ pair.last | append: '.js' | asset_url }}",
 *   {%- endfor -%}
 *
 * Vì vậy phần Liquid trong thẻ script được "chạy thử": vòng for đi qua từng
 * phần tử với biến lặp đã gắn giá trị (để pair.first và pair.last của cùng
 * một vòng đi với nhau), mọi nhánh if đều được in, chỗ {{ }} tính được thì in
 * giá trị. Chỗ {{ ... | asset_url }} được in thành một dấu đặc biệt bọc tên
 * file, để phân biệt file của theme với URL bên ngoài. Cuối cùng chuỗi in ra
 * được dò tìm các cặp "khoá": "<dấu tên file>".
 *
 * Chỉ giữ dòng trỏ tới một file của theme qua asset_url; dòng trỏ tới URL bên
 * ngoài (CDN) không phải quan hệ giữa hai file.
 */

/** Thẻ mở và thẻ đóng của một import map. */
const IMPORT_MAP_OPEN = /<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>/gi;
const SCRIPT_CLOSE = /<\/script\s*>/gi;

/** Ký tự bọc tên file của theme trong chuỗi chạy thử; không thể có trong mã. */
const MARK = "\u0001";

/** Một cặp "khoá": "<dấu>tên file<dấu>", giá trị có thể có hoặc không có ngoặc kép. */
const ENTRY = new RegExp(`"([^"\\\\\\s]+)"\\s*:\\s*"?${MARK}([^${MARK}]+)${MARK}`, "g");

/** Filter biến tên file thành URL của file trong assets/. */
const ASSET_URL = "asset_url";

/** Số vòng lặp tối đa khi chạy thử, để một vòng lặp lồng lớn không treo. */
const MAX_ITERATIONS = 1000;

/**
 * Các dòng import map mà `content` khai, theo thứ tự in ra.
 *
 * `ast` là cây Liquid của chính `content`; `values` là bộ tính giá trị của
 * file đó, đã nạp đủ các lệnh assign.
 */
export function extractImportMap(ast: DocumentNode, content: string, values: LiquidValues): ImportMapEntry[] {
  const entries: ImportMapEntry[] = [];

  for (const open of content.matchAll(IMPORT_MAP_OPEN)) {
    const start = open.index + open[0].length;
    SCRIPT_CLOSE.lastIndex = start;
    const close = SCRIPT_CLOSE.exec(content);
    const end = close === null ? content.length : close.index;

    const printed = new ImportMapPrinter(content, start, end, values).print(ast.children);

    for (const match of printed.matchAll(ENTRY)) {
      const [, specifier, asset] = match;
      if (specifier !== undefined && asset !== undefined) entries.push({ specifier, asset });
    }
  }

  return entries;
}

/** In phần Liquid nằm giữa hai vị trí `start` và `end` của file (xem extractImportMap). */
class ImportMapPrinter {
  private iterations = 0;

  constructor(
    private readonly content: string,
    private readonly start: number,
    private readonly end: number,
    private readonly values: LiquidValues,
  ) {}

  print(nodes: readonly LiquidHtmlNode[] | undefined, bindings: LoopBindings = new Map()): string {
    return (nodes ?? []).map((node) => this.node(node, bindings)).join("");
  }

  private node(node: LiquidHtmlNode, bindings: LoopBindings): string {
    const { start, end } = node.position;
    if (end <= this.start || start >= this.end) return "";

    switch (node.type) {
      case NodeTypes.TextNode:
        // Thẻ <script> mở ngay giữa một đoạn văn bản: chỉ lấy phần bên trong.
        return this.content.slice(Math.max(start, this.start), Math.min(end, this.end));

      case NodeTypes.LiquidVariableOutput:
        return typeof node.markup === "string" ? "" : this.output(node.markup, node, bindings);

      case NodeTypes.LiquidBranch:
        return this.print(node.children, bindings);

      case NodeTypes.LiquidTag:
        if (node.name === "for" && typeof node.markup !== "string") return this.loop(node as LiquidTagFor, bindings);
        // if, unless, case...: in mọi nhánh. Thừa một dấu phẩy không sao vì
        // chuỗi in ra chỉ được dò cặp khoá-giá trị, không đọc như JSON.
        return Array.isArray(node.children) ? this.print(node.children, bindings) : "";

      default:
        return "";
    }
  }

  private loop(loop: LiquidTagFor, bindings: LoopBindings): string {
    const body = loop.children?.[0];
    if (body === undefined) return "";

    const items = this.values.loopItems(loop, bindings);
    // Không biết danh sách: in thân vòng một lần, biến lặp không biết.
    if (items === undefined) return this.print([body], bindings);

    let printed = "";
    for (const item of items) {
      if (++this.iterations > MAX_ITERATIONS) break;
      printed += this.print([body], new Map(bindings).set(loop.markup.variableName, item));
    }
    return printed;
  }

  /** Giá trị của một {{ ... }}; rỗng nếu không biết hoặc có nhiều giá trị. */
  private output(variable: LiquidVariable, at: LiquidHtmlNode, bindings: LoopBindings): string {
    const assetAt = variable.filters.findIndex((filter) => filter.name === ASSET_URL);
    const filters = assetAt === -1 ? variable.filters : variable.filters.slice(0, assetAt);

    const results = this.values.evaluate(variable.expression, filters, at, bindings);
    if (results?.length !== 1) return "";

    const [value] = results;
    if (typeof value !== "string" && typeof value !== "number") return "";

    return assetAt === -1 ? String(value) : `${MARK}${value}${MARK}`;
  }
}
