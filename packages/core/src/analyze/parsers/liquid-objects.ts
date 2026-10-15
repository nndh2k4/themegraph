import { NodeTypes } from "@shopify/liquid-html-parser";
import type { ComplexLiquidExpression, LiquidExpression, LiquidVariable, LiquidVariableLookup } from "@shopify/liquid-html-parser";

import type { CallContext, ObjectKind, ObjectOrigin } from "../../models/index.js";

/**
 * Biết một biến Liquid đang chứa ĐỐI TƯỢNG nào của Shopify, để nhận ra lần
 * đọc setting dù nó được viết qua tên khác:
 *
 *   {%- assign st = section.settings -%}          st.title     -> section.settings.title
 *   {%- for b in section.blocks -%}                b.settings.x -> block.settings.x
 *   {%- assign hero = section.blocks | where: 'type', 'hero' | first -%}
 *                                                  hero.settings.image -> block.settings.image
 *   {%- assign last_block = block -%}              last_block.settings.x -> block.settings.x
 *
 * và trong một snippet, tham số mà nơi gọi truyền một đối tượng vào
 * (`render 'gallery', section_st: section.settings`), lấy từ CallContext.
 *
 * Mỗi loại đối tượng đi kèm NGUỒN GỐC (xem ObjectOrigin): đối tượng của
 * chính file này có nguồn gốc là file này; đối tượng nhận từ nơi gọi giữ
 * nguồn gốc mà nơi gọi ghi cho nó.
 *
 * Cách tính bỏ qua thứ tự (flow-insensitive): một biến có mọi loại đối tượng
 * mà nó từng được gán trong file. Tên `settings`, `section` và `block` luôn
 * mang loại của chính chúng, cộng loại do nơi gọi truyền vào nếu có.
 */

/** Một lần đọc setting: đọc khoá `key` của bộ setting `object`, thuộc các file `origins`. */
export interface SettingRead {
  object: Extract<ObjectKind, "settings" | "section.settings" | "block.settings">;
  key: LiquidExpression;
  origins: string[];
}

/** Các loại đối tượng một biểu thức có thể là, mỗi loại kèm tập nguồn gốc. */
type Kinds = Map<ObjectKind, Set<string>>;

/** Filter giữ nguyên danh sách block (chỉ lọc hay xếp lại). */
const LIST_FILTERS = new Set(["where", "sort", "sort_natural", "reverse", "uniq", "compact", "concat"]);

/** Filter lấy một phần tử của danh sách. */
const ELEMENT_FILTERS = new Set(["first", "last"]);

const BUILTIN: ReadonlyMap<string, ObjectKind> = new Map([
  ["settings", "settings"],
  ["section", "section"],
  ["block", "block"],
]);

const SETTING_OBJECTS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["settings", "section.settings", "block.settings"]);

/** Loại đối tượng sau khi truy cập `.key` (hoặc `[key]`) trên một đối tượng loại `kind`. */
function step(kind: ObjectKind, key: LiquidExpression): ObjectKind | undefined {
  const name = key.type === NodeTypes.String ? key.value : undefined;

  switch (kind) {
    case "section":
      return name === "settings" ? "section.settings" : name === "blocks" ? "blocks" : undefined;
    case "block":
      return name === "settings" ? "block.settings" : undefined;
    case "blocks":
      // blocks.first, blocks.last, blocks[0], blocks[i]; blocks.size thì không.
      return name === undefined || name === "first" || name === "last" ? "block" : undefined;
    default:
      return undefined;
  }
}

/** Thêm `origins` vào loại `kind` của `kinds`. */
function add(kinds: Kinds, kind: ObjectKind, origins: Iterable<string>): void {
  const set = kinds.get(kind) ?? new Set<string>();
  for (const origin of origins) set.add(origin);
  kinds.set(kind, set);
}

function merge(target: Kinds, source: Kinds): void {
  for (const [kind, origins] of source) add(target, kind, origins);
}

export class LiquidObjects {
  private readonly assignments = new Map<string, LiquidVariable[]>();
  private readonly loops = new Map<string, LiquidExpression[]>();
  private readonly cache = new Map<string, Kinds>();
  private readonly inProgress = new Set<string>();

  /** `file` là đường dẫn của file đang phân tích: nguồn gốc của các đối tượng sẵn có. */
  constructor(
    private readonly file: string,
    private readonly context?: CallContext,
  ) {}

  /** Ghi lại một lệnh {% assign name = value %} của file. */
  addAssignment(name: string, value: LiquidVariable): void {
    this.assignments.set(name, [...(this.assignments.get(name) ?? []), value]);
    this.cache.clear();
  }

  /** Ghi lại một vòng {% for name in collection %} (hoặc tablerow) của file. */
  addLoop(name: string, collection: LiquidExpression): void {
    this.loops.set(name, [...(this.loops.get(name) ?? []), collection]);
    this.cache.clear();
  }

  /** Tên mọi biến được gán hay lặp trong file mà mang một loại đối tượng. */
  names(): string[] {
    return [...new Set([...this.assignments.keys(), ...this.loops.keys()])].filter((name) => this.ofVariable(name).size > 0);
  }

  /** Các loại đối tượng của một biểu thức không filter, ở dạng truyền được cho snippet. */
  originsOf(expression: ComplexLiquidExpression, each = false): ObjectOrigin[] {
    let kinds = this.ofExpression(expression);
    // {% render 'x' for blocks as b %}: snippet nhận từng phần tử.
    if (each) {
      const elements: Kinds = new Map();
      const blocks = kinds.get("blocks");
      if (blocks !== undefined) add(elements, "block", blocks);
      kinds = elements;
    }
    return LiquidObjects.toOrigins(kinds);
  }

  /** Các loại đối tượng của biến `name`, ở dạng truyền được cho snippet. */
  originsOfVariable(name: string): ObjectOrigin[] {
    return LiquidObjects.toOrigins(this.ofVariable(name));
  }

  /**
   * Các lần đọc setting mà một biểu thức tra cứu viết ra: một lần cho mỗi
   * cách hiểu biến gốc. `section_st.title` cho section.settings.title nếu
   * section_st là section.settings; `item.settings[k]` cho block.settings[k]
   * nếu item là một block.
   */
  settingReads(lookup: LiquidVariableLookup): SettingRead[] {
    if (lookup.name === null) return [];

    const reads: SettingRead[] = [];
    for (const [start, origins] of this.ofVariable(lookup.name)) {
      let kind: ObjectKind | undefined = start;
      for (const key of lookup.lookups) {
        if (kind === undefined) break;
        if (SETTING_OBJECTS.has(kind)) {
          reads.push({ object: kind as SettingRead["object"], key, origins: [...origins].sort() });
          break;
        }
        kind = step(kind, key);
      }
    }
    return reads;
  }

  private static toOrigins(kinds: Kinds): ObjectOrigin[] {
    return [...kinds]
      .map(([kind, origins]) => ({ kind, origins: [...origins].sort() }))
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  }

  private ofVariable(name: string): Kinds {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;
    if (this.inProgress.has(name)) return new Map();

    this.inProgress.add(name);
    const kinds: Kinds = new Map();
    try {
      const builtin = BUILTIN.get(name);
      if (builtin !== undefined) add(kinds, builtin, [this.file]);
      for (const { kind, origins } of this.context?.kinds.get(name) ?? []) add(kinds, kind, origins);
      for (const value of this.assignments.get(name) ?? []) merge(kinds, this.ofValue(value));
      for (const collection of this.loops.get(name) ?? []) {
        const blocks = this.ofExpression(collection).get("blocks");
        if (blocks !== undefined) add(kinds, "block", blocks);
      }
    } finally {
      this.inProgress.delete(name);
    }

    this.cache.set(name, kinds);
    return kinds;
  }

  /** Các loại đối tượng của `expression | filters`. */
  private ofValue(variable: LiquidVariable): Kinds {
    let kinds = this.ofExpression(variable.expression);

    for (const filter of variable.filters) {
      if (LIST_FILTERS.has(filter.name)) continue;
      // x | default: block.settings: là x, hoặc là giá trị mặc định.
      if (filter.name === "default") {
        const [fallback] = filter.args;
        if (fallback !== undefined && fallback.type !== NodeTypes.NamedArgument) {
          kinds = new Map(kinds);
          merge(kinds, this.ofExpression(fallback));
        }
        continue;
      }
      if (ELEMENT_FILTERS.has(filter.name)) {
        const elements: Kinds = new Map();
        const blocks = kinds.get("blocks");
        if (blocks !== undefined) add(elements, "block", blocks);
        kinds = elements;
        continue;
      }
      return new Map();
    }
    return kinds;
  }

  /** Các loại đối tượng của một biểu thức không filter. */
  private ofExpression(expression: ComplexLiquidExpression): Kinds {
    const result: Kinds = new Map();
    if (expression.type !== NodeTypes.VariableLookup || expression.name === null) return result;

    for (const [start, origins] of this.ofVariable(expression.name)) {
      let kind: ObjectKind | undefined = start;
      for (const key of expression.lookups) {
        if (kind === undefined) break;
        kind = step(kind, key);
      }
      if (kind !== undefined) add(result, kind, origins);
    }
    return result;
  }
}
