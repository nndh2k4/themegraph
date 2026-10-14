import { NodeTypes } from "@shopify/liquid-html-parser";
import type {
  ComplexLiquidExpression,
  LiquidExpression,
  LiquidFilter,
  LiquidHtmlNode,
  LiquidTagFor,
  LiquidVariable,
} from "@shopify/liquid-html-parser";

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
 * module-carousel.js. Lớp này làm đúng việc đó: lần theo assign, vòng for và
 * một nhóm filter xử lý chuỗi, rồi trả về MỌI giá trị biểu thức có thể có.
 *
 * Cách tính bỏ qua thứ tự và điều kiện (flow-insensitive): một biến được gán
 * ở nhiều chỗ thì có giá trị của mọi chỗ, nhánh if nào cũng tính. Kết quả vì
 * vậy có thể THỪA, không bao giờ thiếu so với những gì mã viết sẵn. Người
 * dùng kết quả phải bỏ những tên không ứng với gì trong theme (xem
 * RawRef.computed).
 *
 * Gặp bất cứ thứ gì không biết được khi đọc mã, như biến của Shopify
 * (product, settings...), tham số truyền vào snippet, filter chưa hỗ trợ, thì
 * cả biểu thức là "không biết" (undefined), không đoán.
 */

/** Một giá trị Liquid tính được: chuỗi, số, true/false/nil, hoặc mảng các giá trị đó. */
export type StaticValue = string | number | boolean | null | readonly StaticValue[];

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

/** Một lệnh {% assign ten = ... %}: biểu thức gán và nút của lệnh đó. */
interface Assignment {
  value: LiquidVariable;
  node: LiquidHtmlNode;
}

export class LiquidValues {
  /** Các lệnh assign của file, theo tên biến được gán. */
  private readonly assignments = new Map<string, Assignment[]>();

  /** Các biến đang được tính, để một phép gán vòng (x = x | append) dừng được. */
  private readonly inProgress = new Set<string>();

  /** Kết quả đã tính của từng lệnh assign, khi không có biến lặp nào được gắn. */
  private readonly assignmentCache = new Map<LiquidHtmlNode, PossibleValues>();

  /**
   * `parentOf` là nút cha của từng nút trong file, để biết một nút nằm trong
   * vòng for nào. Bảng có thể được điền SAU khi tạo đối tượng, miễn là điền
   * xong trước lần tính đầu tiên.
   */
  constructor(private readonly parentOf: ReadonlyMap<LiquidHtmlNode, LiquidHtmlNode | undefined>) {}

  /** Ghi lại một lệnh {% assign name = value %} của file. */
  addAssignment(name: string, value: LiquidVariable, node: LiquidHtmlNode): void {
    const list = this.assignments.get(name) ?? [];
    list.push({ value, node });
    this.assignments.set(name, list);
  }

  /**
   * Các giá trị có thể có của `expression | filters`, tính tại nút `at` (nơi
   * biểu thức được viết, để biết nó nằm trong vòng for nào).
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
   *   3. mọi lệnh assign của biến đó trong file
   */
  private variable(name: string, at: LiquidHtmlNode, bindings: LoopBindings): PossibleValues {
    if (bindings.has(name)) return [bindings.get(name) ?? null];

    const loop = this.enclosingLoop(name, at);
    if (loop !== undefined) return this.loopItems(loop, bindings);

    const assignments = this.assignments.get(name);
    if (assignments === undefined || this.inProgress.has(name)) return undefined;

    this.inProgress.add(name);
    try {
      return collect(assignments.map((assignment) => this.assignment(assignment, bindings)));
    } finally {
      this.inProgress.delete(name);
    }
  }

  private assignment({ value, node }: Assignment, bindings: LoopBindings): PossibleValues {
    if (bindings.size > 0) return this.evaluate(value.expression, value.filters, node, bindings);

    if (!this.assignmentCache.has(node)) {
      this.assignmentCache.set(node, this.evaluate(value.expression, value.filters, node));
    }
    return this.assignmentCache.get(node);
  }

  /** Vòng for gần nhất bao quanh `at` có biến lặp tên `name`. */
  private enclosingLoop(name: string, at: LiquidHtmlNode): LiquidTagFor | undefined {
    for (let node = this.parentOf.get(at); node !== undefined; node = this.parentOf.get(node)) {
      if (
        node.type === NodeTypes.LiquidTag &&
        node.name === "for" &&
        typeof node.markup !== "string" &&
        node.markup.variableName === name
      ) {
        return node as LiquidTagFor;
      }
    }
    return undefined;
  }
}
