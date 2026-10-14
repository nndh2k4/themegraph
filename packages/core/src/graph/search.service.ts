import type { GraphHandle } from "./open.js";
import type { NodeKind } from "./types.js";

/** Số kết quả trả về khi người gọi không nêu giới hạn. */
export const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Mức khớp của một kết quả, từ sát nhất tới lỏng nhất:
 *   - exact:    từ khoá trùng cả tên của node ("card" với snippets/card.liquid)
 *   - prefix:   tên của node bắt đầu bằng từ khoá ("card" với card-product)
 *   - name:     từ khoá nằm giữa tên ("product" với card-product)
 *   - path:     từ khoá chỉ nằm ở phần còn lại của id, ví dụ tên thư mục
 */
export type SearchMatch = "exact" | "prefix" | "name" | "path";

/** Thứ tự xếp hạng của các mức khớp: số nhỏ đứng trước. */
const MATCH_ORDER: readonly SearchMatch[] = ["exact", "prefix", "name", "path"];

export interface SearchHit {
  id: string;
  kind: NodeKind;
  match: SearchMatch;
}

export interface SearchOptions {
  /** Chỉ lấy node thuộc các loại này. Không nêu, hoặc mảng rỗng: mọi loại. */
  kinds?: readonly NodeKind[];
  /** Số kết quả tối đa. Mặc định DEFAULT_SEARCH_LIMIT. */
  limit?: number;
}

/** Kết quả của search(). */
export interface SearchResult {
  query: string; // từ khoá như người gọi đưa vào
  hits: SearchHit[]; // các node khớp, sát nhất trước, đã cắt theo limit
  total: number; // số node khớp trước khi cắt, để nói "20 trên 57"
}

/**
 * Tên của một node, tức phần người dùng thường gõ khi tìm nó:
 *   snippets/card-product.liquid          -> card-product
 *   templates/customers/login.json        -> login
 *   page:product                          -> product
 *   t:products.product.add_to_cart        -> products.product.add_to_cart
 *   setting:sections/a.liquid#section.gap -> gap
 *
 * Kết quả luôn là chữ thường, vì phép tìm không phân biệt hoa thường.
 */
function nameOf(id: string, kind: NodeKind): string {
  const lower = id.toLowerCase();

  if (kind === "page_type") return lower.slice("page:".length);
  if (kind === "translation_key") return lower.slice("t:".length);
  // Id của setting kết thúc bằng "settings.<id>", "section.<id>" hoặc
  // "block.<id>"; id của một setting không chứa dấu chấm.
  if (kind === "setting") return lower.slice(lower.lastIndexOf(".") + 1);

  // Node file: bỏ thư mục, rồi bỏ đuôi (kể từ dấu chấm đầu tiên, để
  // "product.alt.json" có tên là "product").
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  const dot = base.indexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Khoá dịch và setting xếp sau file và trang ở cùng mức khớp. Một theme có
 * hàng trăm setting tên kiểu "card_style"; người tìm "card" gần như luôn muốn
 * file snippets/card-product.liquid trước.
 */
function isSecondary(kind: NodeKind): boolean {
  return kind === "translation_key" || kind === "setting";
}

/** Mức khớp của MỘT từ với một node; null khi từ đó không có trong id. */
function matchOf(term: string, id: string, name: string): SearchMatch | null {
  if (name === term) return "exact";
  if (name.startsWith(term)) return "prefix";
  if (name.includes(term)) return "name";
  return id.includes(term) ? "path" : null;
}

/**
 * Trả lời câu hỏi: "trong theme có file (hay trang, khoá dịch, setting) nào
 * tên như thế này?"
 *
 * Dùng khi chưa biết id chính xác của thứ cần hỏi: người gõ "card" để ra
 * snippets/card-product.liquid rồi mới gọi impact() hay context() với id đó.
 *
 * Cách khớp:
 *   - không phân biệt hoa thường
 *   - từ khoá có nhiều từ cách nhau bằng dấu cách thì MỌI từ phải có trong id
 *     ("product card" ra card-product); mức khớp của node là mức LỎNG nhất
 *     trong các từ
 *   - từ khoá rỗng khớp mọi node, để liệt kê được cả một loại bằng `kinds`;
 *     khi đó không có gì để xếp hạng nên kết quả chỉ xếp theo bảng chữ cái
 *
 * Thứ tự kết quả: mức khớp sát trước; cùng mức thì file và trang đứng trước
 * khoá dịch và setting; rồi id ngắn trước; rồi theo bảng chữ cái.
 */
export function search(graph: GraphHandle, query: string, options: SearchOptions = {}): SearchResult {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== "");
  const kinds = new Set(options.kinds ?? []);
  const limit = Math.max(0, options.limit ?? DEFAULT_SEARCH_LIMIT);

  // Theme lớn nhất đã đo có chưa tới 4000 node, nên đọc hết rồi lọc bằng
  // JavaScript vẫn chỉ mất vài mili giây, và giữ được luật khớp ở một chỗ.
  const rows = graph.db.prepare("SELECT id, kind FROM nodes").all();

  const hits: SearchHit[] = [];

  for (const row of rows) {
    const id = String(row.id);
    const kind = String(row.kind) as NodeKind;

    if (kinds.size > 0 && !kinds.has(kind)) continue;

    const lowerId = id.toLowerCase();
    const name = nameOf(id, kind);

    // Không có từ nào thì node khớp ở mức lỏng nhất.
    let worst = terms.length === 0 ? MATCH_ORDER.length - 1 : 0;
    let matched = true;

    for (const term of terms) {
      const match = matchOf(term, lowerId, name);
      if (match === null) {
        matched = false;
        break;
      }
      worst = Math.max(worst, MATCH_ORDER.indexOf(match));
    }

    if (matched) hits.push({ id, kind, match: MATCH_ORDER[worst] ?? "path" });
  }

  const byId = (a: SearchHit, b: SearchHit): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  hits.sort(
    terms.length === 0
      ? byId
      : (a, b) =>
          MATCH_ORDER.indexOf(a.match) - MATCH_ORDER.indexOf(b.match) ||
          Number(isSecondary(a.kind)) - Number(isSecondary(b.kind)) ||
          a.id.length - b.id.length ||
          byId(a, b),
  );

  return { query, hits: hits.slice(0, limit), total: hits.length };
}
