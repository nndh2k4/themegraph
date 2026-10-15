import { NodeTypes } from "@shopify/liquid-html-parser";
import type {
  ComplexLiquidExpression,
  LiquidExpression,
  LiquidFilter,
  LiquidHtmlNode,
  LiquidTag,
  LiquidTagFor,
  LiquidVariable,
} from "@shopify/liquid-html-parser";

import type { CallContext, StaticValue } from "../../models/index.js";

/**
 * Tính giá trị của một biểu thức Liquid khi CHỈ ĐỌC MÃ, không chạy theme.
 *
 * Nhiều theme không viết sẵn tên file mà ghép nó từ một danh sách viết sẵn:
 *
 *   {%- assign modules = 'global:core,slide:module-carousel' | split: ',' -%}
 *   {%- for entry in modules -%}
 *     {%- assign pair = entry | split: ':' -%}
 *     {{ pair.last | append: '.js' | asset_url }}
 *   {%- endfor -%}
 *
 * Mọi mảnh ở đây đều là chữ viết sẵn, nên tên file tính được: core.js và
 * module-carousel.js. Lớp này làm đúng việc đó: lần theo assign, capture, vòng
 * for và một nhóm filter xử lý chuỗi, rồi trả về MỌI giá trị biểu thức có thể có.
 *
 * Thứ tự được tính theo kiểu "lệnh gán với tới" (xem reaching): lệnh gán đứng
 * trước và chắc chắn đã chạy che các lệnh gán cũ hơn, còn lệnh gán trong một
 * nhánh if thì chỉ cộng thêm khả năng. Nhờ vậy phép gán cộng dồn
 *
 *   {%- assign rows = '' -%}
 *   {%- if show_sku -%}{%- assign rows = rows | append: 'sku,' -%}{%- endif -%}
 *   {%- assign rows = rows | split: ',' -%}
 *
 * tính được. Nhánh if nào cũng được coi là có thể chạy, nên kết quả có thể
 * THỪA so với một lần chạy thật. Người dùng kết quả phải bỏ những tên không
 * ứng với gì trong theme (xem RawRef.computed).
 *
 * Biến không được gán trong file (tham số của snippet) lấy giá trị từ
 * CallContext, tức những gì các nơi gọi truyền vào. Gặp thứ không biết được
 * khi đọc mã, như dữ liệu của Shopify (product, settings...) hay filter chưa
 * hỗ trợ, thì cả biểu thức là "không biết" (undefined), không đoán.
 */

/** Các giá trị một biểu thức có thể có; undefined là không biết. */
export type PossibleValues = StaticValue[] | undefined;

/**
 * Giá trị đã gắn cho biến lặp của những vòng for đang được "chạy thử", theo
 * tên biến. Xem renderImportMaps: muốn giữ đúng cặp khoá-giá trị của từng
 * vòng lặp thì phải tính từng vòng một với biến lặp đã gắn.
 */
export type LoopBindings = ReadonlyMap<string, StaticValue>;

/**
 * Số giá trị tối đa của một biểu thức, và số phần tử tối đa của một mảng tạo
 * từ (a..b). Quá ngưỡng thì coi là không biết, để phép tính không nổ tổ hợp.
 */
const MAX_VALUES = 256;

const NO_BINDINGS: LoopBindings = new Map();

/** Đổi một giá trị thành chuỗi theo cách Liquid in nó ra. */
function text(value: StaticValue): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.map(text).join("");
  return String(value);
}

/** Bỏ các giá trị trùng nhau, giữ thứ tự gặp đầu tiên. */
function unique(values: readonly StaticValue[]): StaticValue[] {
  const seen = new Set<string>();
  const result: StaticValue[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/** Mọi tổ hợp lấy mỗi danh sách một phần tử; undefined nếu quá MAX_VALUES. */
function combinations(lists: readonly StaticValue[][]): StaticValue[][] | undefined {
  let result: StaticValue[][] = [[]];
  for (const list of lists) {
    const next: StaticValue[][] = [];
    for (const prefix of result) {
      for (const value of list) next.push([...prefix, value]);
    }
    if (next.length > MAX_VALUES) return undefined;
    result = next;
  }
  return result;
}

/** Giá trị của `value.<key>` hoặc `value[key]`; undefined nếu không biết. */
function lookup(value: StaticValue, key: StaticValue): StaticValue | undefined {
  if (Array.isArray(value)) {
    if (key === "first") return value[0] ?? null;
    if (key === "last") return value.at(-1) ?? null;
    if (key === "size") return value.length;
    if (typeof key === "number" && Number.isInteger(key)) return value.at(key) ?? null;
    return undefined;
  }
  if (typeof value === "string" && key === "size") return value.length;
  return undefined;
}

/** Ruby (và Liquid) bỏ các phần rỗng ở CUỐI kết quả của split. */
function split(value: string, separator: string): string[] {
  const parts = separator === "" ? [...value] : value.split(separator);
  while (parts.at(-1) === "") parts.pop();
  return parts;
}

/**
 * Áp một filter xử lý chuỗi hay mảng. `args` là các tham số vị trí đã tính.
 * Trả undefined với filter chưa hỗ trợ hoặc giá trị không hợp.
 */
function applyFilter(name: string, value: StaticValue, args: readonly StaticValue[]): StaticValue | undefined {
  const [first, second] = args;

  switch (name) {
    case "append":
      return first === undefined ? undefined : text(value) + text(first);
    case "prepend":
      return first === undefined ? undefined : text(first) + text(value);
    case "split":
      return first === undefined ? undefined : split(text(value), text(first));
    case "join":
      return Array.isArray(value) ? value.map(text).join(first === undefined ? " " : text(first)) : undefined;
    case "first":
    case "last":
    case "size":
      return lookup(value, name);
    case "reverse":
      return Array.isArray(value) ? [...value].reverse() : undefined;
    case "uniq":
      return Array.isArray(value) ? unique(value) : undefined;
    case "compact":
      return Array.isArray(value) ? value.filter((item) => item !== null) : undefined;
    case "downcase":
      return text(value).toLowerCase();
    case "upcase":
      return text(value).toUpperCase();
    case "strip":
      return text(value).trim();
    case "lstrip":
      return text(value).trimStart();
    case "rstrip":
      return text(value).trimEnd();
    case "remove":
      return first === undefined ? undefined : text(value).replaceAll(text(first), "");
    case "remove_first":
      return first === undefined ? undefined : text(value).replace(text(first), "");
    case "replace":
      return first === undefined || second === undefined ? undefined : text(value).replaceAll(text(first), text(second));
    case "replace_first":
      return first === undefined || second === undefined ? undefined : text(value).replace(text(first), text(second));
    case "default": {
      const empty = value === null || value === false || value === "" || (Array.isArray(value) && value.length === 0);
      return empty ? (first ?? null) : value;
    }
    default:
      return undefined;
  }
}

/** Gom các giá trị có thể có; undefined nếu một phần không biết hoặc quá nhiều. */
function collect(groups: readonly PossibleValues[]): PossibleValues {
  const all: StaticValue[] = [];
  for (const group of groups) {
    if (group === undefined) return undefined;
    all.push(...group);
  }
  const result = unique(all);
  return result.length > MAX_VALUES ? undefined : result;
}

/**
 * Một lệnh gán giá trị cho một biến:
 *   - assign:  {% assign ten = bieu_thuc %}
 *   - capture: {% capture ten %}...{% endcapture %}, giá trị là phần thân in ra
 */
type Definition =
  | { kind: "assign"; node: LiquidHtmlNode; value: LiquidVariable }
  | { kind: "capture"; node: LiquidTag };

/** Các tag mà phần thân là các nhánh (LiquidBranch) chỉ chạy khi điều kiện đúng. */
const BRANCHING_TAGS = new Set(["if", "unless", "case"]);

/** Các tag không in gì ra khi chạy. */
const SILENT_TAGS = new Set(["assign", "capture", "comment", "increment", "decrement", "break", "continue", "doc"]);

export class LiquidValues {
  /** Các lệnh gán của file, theo tên biến, xếp theo vị trí trong file khi cần. */
  private readonly definitions = new Map<string, Definition[]>();
  private readonly sortedNames = new Set<string>();

  /** Các lệnh gán đang được tính, để một phép gán vòng dừng được. */
  private readonly inProgress = new Set<LiquidHtmlNode>();

  /** Kết quả đã tính của từng lệnh gán, khi không có biến lặp nào được gắn. */
  private readonly cache = new Map<LiquidHtmlNode, PossibleValues>();

  /**
   * `parentOf` là nút cha của từng nút trong file, để biết một nút nằm trong
   * vòng for hay nhánh if nào. Bảng có thể được điền SAU khi tạo đối tượng,
   * miễn là điền xong trước lần tính đầu tiên.
   *
   * `content` là nội dung file, để lấy chữ của phần thân {% capture %}.
   *
   * `context` là những gì các nơi gọi truyền vào, khi file là một snippet:
   * một biến không được gán trong file thì lấy giá trị từ đó.
   */
  constructor(
    private readonly parentOf: ReadonlyMap<LiquidHtmlNode, LiquidHtmlNode | undefined>,
    private readonly content: string,
    private readonly context?: CallContext,
  ) {}

  /** Ghi lại một lệnh {% assign name = value %} của file. */
  addAssignment(name: string, value: LiquidVariable, node: LiquidHtmlNode): void {
    this.define(name, { kind: "assign", node, value });
  }

  /** Ghi lại một lệnh {% capture name %} của file. */
  addCapture(name: string, node: LiquidTag): void {
    this.define(name, { kind: "capture", node });
  }

  /** Tên mọi biến được gán trong file. */
  names(): string[] {
    return [...this.definitions.keys()];
  }

  /**
   * Các giá trị có thể có của `expression | filters`, tính tại nút `at` (nơi
   * biểu thức được viết, để biết nó nằm sau lệnh gán nào, trong vòng for nào).
   */
  evaluate(
    expression: ComplexLiquidExpression,
    filters: readonly LiquidFilter[],
    at: LiquidHtmlNode,
    bindings: LoopBindings = NO_BINDINGS,
  ): PossibleValues {
    let values = this.expression(expression, at, bindings);

    for (const filter of filters) {
      if (values === undefined) return undefined;

      // Tham số có tên (ví dụ `t: count: 3`) không thuộc các filter ở đây.
      const args: PossibleValues[] = [];
      for (const arg of filter.args) {
        if (arg.type === NodeTypes.NamedArgument) return undefined;
        args.push(this.expression(arg, at, bindings));
      }
      if (args.some((arg) => arg === undefined)) return undefined;

      const tuples = combinations([values, ...(args as StaticValue[][])]);
      if (tuples === undefined) return undefined;

      const next: StaticValue[] = [];
      for (const [value, ...rest] of tuples) {
        const result = applyFilter(filter.name, value ?? null, rest);
        if (result === undefined) return undefined;
        next.push(result);
      }
      values = collect([next]);
    }

    return values;
  }

  /** Các giá trị có thể có của biến `name` tại nút `at`. */
  valuesOf(name: string, at: LiquidHtmlNode): PossibleValues {
    return this.variable(name, at, NO_BINDINGS);
  }

  /**
   * Các phần tử một vòng {% for %} có thể đi qua: gộp phần tử của mọi giá trị
   * có thể có của danh sách. undefined nếu danh sách không biết.
   */
  loopItems(loop: LiquidTagFor, bindings: LoopBindings = NO_BINDINGS): PossibleValues {
    const collection = this.expression(loop.markup.collection, loop, bindings);
    if (collection === undefined) return undefined;

    const items: StaticValue[] = [];
    for (const value of collection) {
      if (!Array.isArray(value)) return undefined;
      items.push(...(loop.markup.reversed ? [...value].reverse() : value));
    }
    return items.length > MAX_VALUES ? undefined : items;
  }

  private define(name: string, definition: Definition): void {
    const list = this.definitions.get(name) ?? [];
    list.push(definition);
    this.definitions.set(name, list);
    this.sortedNames.delete(name);
  }

  private expression(expression: ComplexLiquidExpression, at: LiquidHtmlNode, bindings: LoopBindings): PossibleValues {
    switch (expression.type) {
      case NodeTypes.String:
        return [expression.value];
      case NodeTypes.Number: {
        const value = Number(expression.value);
        return Number.isNaN(value) ? undefined : [value];
      }
      case NodeTypes.LiquidLiteral:
        return [expression.value];
      case NodeTypes.Range:
        return this.range(expression.start, expression.end, at, bindings);
      case NodeTypes.VariableLookup:
        return this.variableLookup(expression.name, expression.lookups, at, bindings);
      default:
        // So sánh, and / or: không cần cho tên file.
        return undefined;
    }
  }

  /** (a..b): một mảng số nguyên từ a tới b. */
  private range(start: LiquidExpression, end: LiquidExpression, at: LiquidHtmlNode, bindings: LoopBindings): PossibleValues {
    const [from] = this.expression(start, at, bindings) ?? [];
    const [to] = this.expression(end, at, bindings) ?? [];

    if (!Number.isInteger(from) || !Number.isInteger(to)) return undefined;
    const length = (to as number) - (from as number) + 1;
    if (length < 0 || length > MAX_VALUES) return undefined;

    return [Array.from({ length }, (_, i) => (from as number) + i)];
  }

  private variableLookup(
    name: string | null,
    lookups: readonly LiquidExpression[],
    at: LiquidHtmlNode,
    bindings: LoopBindings,
  ): PossibleValues {
    if (name === null) return undefined;

    let values = this.variable(name, at, bindings);

    for (const key of lookups) {
      if (values === undefined) return undefined;

      // Khoá viết sẵn (pair.last, list[0]) chỉ có một giá trị. Khoá là biến
      // mà không biết được, như list[forloop.index0], thì lấy mọi phần tử.
      const keys = this.expression(key, at, bindings);
      const next: StaticValue[] = [];

      for (const value of values) {
        if (keys === undefined) {
          if (!Array.isArray(value)) return undefined;
          next.push(...value);
          continue;
        }
        for (const k of keys) {
          const result = lookup(value, k);
          if (result === undefined) return undefined;
          next.push(result);
        }
      }
      values = collect([next]);
    }

    return values;
  }

  /**
   * Giá trị của một biến tại `at`, theo thứ tự:
   *   1. biến lặp đã được gắn giá trị (bindings)
   *   2. biến lặp của một vòng for bao quanh `at`: mọi phần tử của vòng đó
   *   3. các lệnh gán VỚI TỚI được `at` (xem reaching), cộng giá trị nơi gọi
   *      truyền vào nếu có thể chưa lệnh gán nào chạy
   */
  private variable(name: string, at: LiquidHtmlNode, bindings: LoopBindings): PossibleValues {
    if (bindings.has(name)) return [bindings.get(name) ?? null];

    const loop = this.enclosingLoop(name, at);
    if (loop !== undefined) return this.loopItems(loop, bindings);

    const { definitions, certain } = this.reaching(name, at);
    const passed = this.context?.values.get(name);

    // Một lệnh gán đang được tính có thể với tới chính nó qua vòng lặp trước
    // ({% for %}...{% assign x = x | split: ',' %}...{% endfor %}). Phần đóng
    // góp đó được bỏ qua, thay vì làm cả biến thành không biết.
    const groups = definitions
      .filter((definition) => !this.inProgress.has(definition.node))
      .map((definition) => this.definition(definition, bindings));
    if (!certain && passed !== undefined) groups.push([...passed]);

    return groups.length === 0 ? undefined : collect(groups);
  }

  /**
   * Các lệnh gán của `name` có thể là lệnh gán cuối cùng đã chạy khi tới `at`
   * (reaching definitions):
   *
   *   - đi ngược từ `at` qua các lệnh gán đứng trước, dừng ở lệnh đầu tiên
   *     CHẮC CHẮN đã chạy (không nằm trong nhánh nào mà `at` không nằm trong).
   *     Vì vậy {% assign x = 'a' %}{% assign x = x | append: 'b' %} cho x = 'ab'
   *     ở sau, và lệnh thứ hai thấy x = 'a'.
   *   - cộng các lệnh gán đứng SAU `at` nhưng cùng nằm trong một vòng for bao
   *     quanh `at`: chúng chạy ở vòng lặp trước.
   *
   * `certain` cho biết có lệnh gán nào chắc chắn đã chạy không.
   */
  private reaching(name: string, at: LiquidHtmlNode): { definitions: Definition[]; certain: boolean } {
    const all = this.sortedDefinitions(name);
    const start = at.position.start;
    const definitions: Definition[] = [];
    let certain = false;

    for (let i = all.length - 1; i >= 0; i--) {
      const definition = all[i];
      if (definition === undefined || definition.node.position.start >= start) continue;
      definitions.push(definition);
      if (this.alwaysRunsBefore(definition.node, at)) {
        certain = true;
        break;
      }
    }

    // Đã gom theo chiều ngược; trả về theo thứ tự trong file.
    definitions.reverse();

    const loops = this.enclosingLoops(at);
    for (const definition of all) {
      if (definition.node.position.start < start) continue;
      if (loops.some((loop) => this.isInside(definition.node, loop))) definitions.push(definition);
    }

    return { definitions, certain };
  }

  private sortedDefinitions(name: string): readonly Definition[] {
    const list = this.definitions.get(name) ?? [];
    if (!this.sortedNames.has(name)) {
      list.sort((a, b) => a.node.position.start - b.node.position.start);
      this.sortedNames.add(name);
    }
    return list;
  }

  /**
   * Nút `definition` (đứng trước `at`) có chắc chắn chạy mỗi khi `at` chạy
   * không: mọi nhánh và vòng lặp chứa nó cũng phải chứa `at`.
   */
  private alwaysRunsBefore(definition: LiquidHtmlNode, at: LiquidHtmlNode): boolean {
    for (let node = this.parentOf.get(definition); node !== undefined; node = this.parentOf.get(node)) {
      if (node.type === NodeTypes.LiquidBranch && !this.isInside(at, node)) return false;
    }
    return true;
  }

  private isInside(node: LiquidHtmlNode, container: LiquidHtmlNode): boolean {
    for (let current = this.parentOf.get(node); current !== undefined; current = this.parentOf.get(current)) {
      if (current === container) return true;
    }
    return false;
  }

  private definition(definition: Definition, bindings: LoopBindings): PossibleValues {
    const { node } = definition;
    if (this.inProgress.has(node)) return undefined;

    const compute = (): PossibleValues => {
      this.inProgress.add(node);
      try {
        return definition.kind === "assign"
          ? this.evaluate(definition.value.expression, definition.value.filters, node, bindings)
          : this.capture(definition.node, bindings);
      } finally {
        this.inProgress.delete(node);
      }
    };

    if (bindings.size > 0) return compute();
    if (!this.cache.has(node)) this.cache.set(node, compute());
    return this.cache.get(node);
  }

  // ---- In phần thân của {% capture %} -----------------------------------------

  /** Các chuỗi mà phần thân của một {% capture %} có thể in ra. */
  private capture(tag: LiquidTag, bindings: LoopBindings): PossibleValues {
    const body = this.bodyRange(tag);
    if (body === undefined) return undefined;

    return this.printSequence(tag.children ?? [], body, tag.whitespaceEnd === "-", tag.delimiterWhitespaceStart === "-", this.inLiquidTag(tag), bindings);
  }

  /**
   * In một dãy nút nằm trong khoảng `range` của file. Khoảng trắng giữa hai
   * nút được giữ, trừ khi một bên có dấu `-` ({%- -%}, {{- -}}) hoặc dãy nằm
   * trong {% liquid %} (ở đó chỉ echo mới in ra).
   */
  private printSequence(
    nodes: readonly LiquidHtmlNode[],
    range: { start: number; end: number },
    trimStart: boolean,
    trimEnd: boolean,
    liquidMode: boolean,
    bindings: LoopBindings,
  ): PossibleValues {
    const parts: StaticValue[][] = [];
    let cursor = range.start;
    let trimNext = trimStart;

    for (const node of [...nodes].sort((a, b) => a.position.start - b.position.start)) {
      const gap = this.content.slice(cursor, node.position.start);
      const trimmed = liquidMode || trimNext || ("whitespaceStart" in node && node.whitespaceStart === "-");
      parts.push([trimmed ? "" : gap]);

      const printed = this.printNode(node, liquidMode, bindings);
      if (printed === undefined) return undefined;
      parts.push(printed);

      trimNext = endTrims(node);
      cursor = node.position.end;
    }

    const tail = this.content.slice(cursor, range.end);
    parts.push([liquidMode || trimNext || trimEnd ? "" : tail]);

    const joined = combinations(parts);
    return joined === undefined ? undefined : collect([joined.map((pieces) => pieces.map(text).join(""))]);
  }

  private printNode(node: LiquidHtmlNode, liquidMode: boolean, bindings: LoopBindings): PossibleValues {
    switch (node.type) {
      case NodeTypes.TextNode:
        return [this.content.slice(node.position.start, node.position.end)];

      case NodeTypes.LiquidVariableOutput:
        return typeof node.markup === "string" ? undefined : this.printValue(node.markup, bindings);

      case NodeTypes.LiquidRawTag:
        if (node.name === "raw") return [node.body.value];
        return node.name === "comment" || node.name === "doc" ? [""] : undefined;

      case NodeTypes.LiquidTag:
        return this.printTag(node, liquidMode, bindings);

      default:
        return undefined;
    }
  }

  private printValue(variable: LiquidVariable, bindings: LoopBindings): PossibleValues {
    const values = this.evaluate(variable.expression, variable.filters, variable, bindings);
    return values?.map(text);
  }

  private printTag(tag: LiquidTag, liquidMode: boolean, bindings: LoopBindings): PossibleValues {
    if (tag.name === "echo") {
      return typeof tag.markup === "string" ? undefined : this.printValue(tag.markup as LiquidVariable, bindings);
    }
    if (tag.name === "liquid") {
      const statements = Array.isArray(tag.markup) ? (tag.markup as LiquidHtmlNode[]) : [];
      return this.printSequence(statements, tag.position, true, true, true, bindings);
    }
    if (SILENT_TAGS.has(tag.name)) return [""];

    const branches = (tag.children ?? []).filter((child) => child.type === NodeTypes.LiquidBranch);

    if (BRANCHING_TAGS.has(tag.name)) {
      // Mọi nhánh đều có thể chạy; không có else thì có thể không nhánh nào chạy.
      // Phần trước {% when %} đầu tiên của case không bao giờ được in.
      const groups: PossibleValues[] = [];
      branches.forEach((branch, i) => {
        if (tag.name === "case" && branch.name === null) return;
        groups.push(this.printBranch(tag, branches, i, liquidMode, bindings));
      });
      if (!branches.some((branch) => branch.name === "else")) groups.push([""]);
      return collect(groups);
    }

    if (tag.name === "for" && typeof tag.markup !== "string") {
      const loop = tag as LiquidTagFor;
      const items = this.loopItems(loop, bindings);
      if (items === undefined || branches[0] === undefined) return undefined;
      if (items.length === 0) return branches[1] === undefined ? [""] : this.printBranch(tag, branches, 1, liquidMode, bindings);

      const iterations: StaticValue[][] = [];
      for (const item of items) {
        const printed = this.printBranch(tag, branches, 0, liquidMode, new Map(bindings).set(loop.markup.variableName, item));
        if (printed === undefined) return undefined;
        iterations.push(printed);
      }
      const joined = combinations(iterations);
      return joined === undefined ? undefined : collect([joined.map((pieces) => pieces.map(text).join(""))]);
    }

    // render, section, form, tablerow...: không biết in ra gì.
    return undefined;
  }

  /** In nhánh thứ `i` của một tag có nhiều nhánh (if, case, for). */
  private printBranch(
    tag: LiquidTag,
    branches: readonly LiquidHtmlNode[],
    i: number,
    liquidMode: boolean,
    bindings: LoopBindings,
  ): PossibleValues {
    const branch = branches[i];
    if (branch === undefined || branch.type !== NodeTypes.LiquidBranch) return undefined;

    const range = this.bodyRange(branch);
    if (range === undefined) return undefined;

    const next = branches[i + 1];
    const trimStart = (i === 0 ? tag.whitespaceEnd : branch.whitespaceEnd) === "-";
    const trimEnd =
      (next !== undefined && next.type === NodeTypes.LiquidBranch ? next.whitespaceStart : tag.delimiterWhitespaceStart) === "-";

    return this.printSequence(branch.children, range, trimStart, trimEnd, liquidMode, bindings);
  }

  /** Khoảng của phần thân một tag hay một nhánh: giữa tag mở và tag đóng. */
  private bodyRange(node: LiquidHtmlNode): { start: number; end: number } | undefined {
    if (!("blockStartPosition" in node) || !("blockEndPosition" in node)) return undefined;
    const start = node.blockStartPosition?.end;
    const end = node.blockEndPosition?.start;
    return start === undefined || end === undefined || end < start ? undefined : { start, end };
  }

  private inLiquidTag(node: LiquidHtmlNode): boolean {
    for (let current = this.parentOf.get(node); current !== undefined; current = this.parentOf.get(current)) {
      if (current.type === NodeTypes.LiquidTag && current.name === "liquid") return true;
    }
    return false;
  }

  // ---- Vòng lặp ----------------------------------------------------------------

  /** Các vòng for bao quanh `at`, từ trong ra ngoài. */
  private enclosingLoops(at: LiquidHtmlNode): LiquidTagFor[] {
    const loops: LiquidTagFor[] = [];
    for (let node = this.parentOf.get(at); node !== undefined; node = this.parentOf.get(node)) {
      if (node.type === NodeTypes.LiquidTag && node.name === "for" && typeof node.markup !== "string") {
        loops.push(node as LiquidTagFor);
      }
    }
    return loops;
  }

  /** Vòng for gần nhất bao quanh `at` có biến lặp tên `name`. */
  private enclosingLoop(name: string, at: LiquidHtmlNode): LiquidTagFor | undefined {
    return this.enclosingLoops(at).find((loop) => loop.markup.variableName === name);
  }
}

/**
 * Nút có cắt khoảng trắng phía SAU nó không: {{ x -}}, {% assign -%}, hay
 * {% endif -%} với tag có thẻ đóng.
 */
function endTrims(node: LiquidHtmlNode): boolean {
  if (node.type === NodeTypes.LiquidVariableOutput) return node.whitespaceEnd === "-";
  if (node.type !== NodeTypes.LiquidTag && node.type !== NodeTypes.LiquidRawTag) return false;

  const close = node.blockEndPosition;
  const hasClose = close !== undefined && close.end > close.start;
  return (hasClose ? node.delimiterWhitespaceEnd : node.whitespaceEnd) === "-";
}
