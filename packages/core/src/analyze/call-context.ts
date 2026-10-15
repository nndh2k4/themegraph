import type { CallContext, ObjectKind, ObjectOrigin, SnippetCall, StaticValue } from "../models/index.js";

/**
 * Gộp các lời gọi snippet của cả theme thành ngữ cảnh của từng snippet: mỗi
 * tham số có thể là đối tượng loại nào, mang giá trị nào (xem CallContext).
 *
 * Trong Liquid, snippet không tự biết tham số của nó là gì:
 *
 *   sections/product.liquid       {% render 'gallery', section_st: section.settings %}
 *   snippets/gallery.liquid       {{ section_st.enable_zoom }}
 *
 * Chỉ khi biết nơi gọi truyền section.settings vào thì section_st.enable_zoom
 * mới là lần đọc setting enable_zoom. AnalyzeService dùng kết quả ở đây để
 * phân tích lại snippet với ngữ cảnh đó, lặp tới khi ngữ cảnh không đổi nữa:
 * một snippet nhận được ngữ cảnh mới thì các snippet nó gọi cũng có thể nhận
 * được ngữ cảnh mới.
 *
 * Loại đối tượng của một tham số là hợp của mọi nơi gọi, mỗi loại giữ
 * nguồn gốc của từng nơi gọi (xem ObjectOrigin).
 *
 * Giá trị của một tham số là hợp của mọi nơi gọi. Nơi gọi truyền một giá trị
 * không biết được thì không góp gì; quá MAX_VALUES giá trị thì tham số đó coi
 * như không biết, để vòng lặp phân tích lại không phình mãi.
 */

const MAX_VALUES = 256;

/** Đường dẫn file của snippet có tên `name`, theo quy ước của Shopify. */
export function snippetPath(name: string): string {
  return `snippets/${name}.liquid`;
}

interface Accumulator {
  kinds: Map<string, Map<ObjectKind, Set<string>>>;
  values: Map<string, Map<string, StaticValue>>;
  tooMany: Set<string>;
}

/**
 * Ngữ cảnh của từng snippet được gọi, theo đường dẫn. `calls` là danh sách
 * lời gọi của từng file, theo một thứ tự cố định (thứ tự file của scanner),
 * để thứ tự giá trị trong kết quả không phụ thuộc lần chạy.
 */
export function buildCallContexts(calls: Iterable<readonly SnippetCall[]>): Map<string, CallContext> {
  const accumulators = new Map<string, Accumulator>();

  for (const fileCalls of calls) {
    for (const call of fileCalls) {
      const path = snippetPath(call.snippet);
      let acc = accumulators.get(path);
      if (acc === undefined) {
        acc = { kinds: new Map(), values: new Map(), tooMany: new Set() };
        accumulators.set(path, acc);
      }

      for (const arg of call.args) {
        if (arg.kinds.length > 0) {
          const kinds = acc.kinds.get(arg.name) ?? new Map<ObjectKind, Set<string>>();
          for (const { kind, origins } of arg.kinds) {
            const set = kinds.get(kind) ?? new Set<string>();
            for (const origin of origins) set.add(origin);
            kinds.set(kind, set);
          }
          acc.kinds.set(arg.name, kinds);
        }

        if (arg.values === null || acc.tooMany.has(arg.name)) continue;
        const values = acc.values.get(arg.name) ?? new Map<string, StaticValue>();
        for (const value of arg.values) values.set(JSON.stringify(value), value);

        if (values.size > MAX_VALUES) {
          acc.tooMany.add(arg.name);
          acc.values.delete(arg.name);
        } else {
          acc.values.set(arg.name, values);
        }
      }
    }
  }

  const contexts = new Map<string, CallContext>();
  for (const [path, acc] of accumulators) {
    if (acc.kinds.size === 0 && acc.values.size === 0) continue;
    contexts.set(path, {
      kinds: new Map([...acc.kinds].map(([name, kinds]) => [name, toOrigins(kinds)])),
      values: new Map([...acc.values].map(([name, values]) => [name, [...values.values()]])),
    });
  }
  return contexts;
}

function toOrigins(kinds: ReadonlyMap<ObjectKind, ReadonlySet<string>>): ObjectOrigin[] {
  return [...kinds]
    .map(([kind, origins]) => ({ kind, origins: [...origins].sort() }))
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

/** Một chuỗi đại diện cho ngữ cảnh, để so hai ngữ cảnh có như nhau không. Rỗng nếu không có. */
export function contextKey(context: CallContext | undefined): string {
  if (context === undefined) return "";
  const sorted = <T>(map: ReadonlyMap<string, T>) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([sorted(context.kinds), sorted(context.values)]);
}
