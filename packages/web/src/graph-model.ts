import type { EdgeType, ExportedGraph, NodeKind } from "@themegraph/core";

/**
 * Đổi dữ liệu của route /graph thành thứ màn đồ thị vẽ ra: node nào hiện, màu
 * gì, to cỡ nào, cạnh nào còn lại. Mọi hàm ở đây là hàm thuần, không đụng tới
 * trình duyệt hay thư viện vẽ, để test được bằng dữ liệu viết tay.
 */

/**
 * Các loại node màn đồ thị vẽ được, theo thứ tự hiện trong chú giải: đi từ
 * trang xuống tới file lá. Locale và config không có ở đây vì không cạnh nào
 * nối tới chúng; khoá dịch và setting thì quá nhiều để vẽ chung.
 */
export const DRAWN_KINDS: readonly NodeKind[] = [
  "page_type",
  "template",
  "layout",
  "section_group",
  "section",
  "block",
  "snippet",
  "asset",
];

/**
 * Các loại hiện sẵn khi mở màn đồ thị. Asset tắt sẵn: trên Dawn nó chiếm 190
 * trong 357 node, phần lớn là icon, và che mất cấu trúc render.
 */
export const DEFAULT_KINDS: readonly NodeKind[] = DRAWN_KINDS.filter((kind) => kind !== "asset");

/**
 * Màu của từng loại node. Chọn để hai loại hay đứng cạnh nhau (section và
 * snippet, section và block) khác hẳn nhau, và đọc được trên cả nền sáng lẫn tối.
 */
export const KIND_COLORS: Record<string, string> = {
  page_type: "#d9480f",
  template: "#e8a013",
  layout: "#7048e8",
  section_group: "#0c8599",
  section: "#1c7ed6",
  block: "#37b24d",
  snippet: "#c2255c",
  asset: "#868e96",
};

/** Màu cho loại node không có trong bảng (không nên xảy ra; để khỏi vẽ node vô hình). */
const UNKNOWN_COLOR = "#495057";

export function kindColor(kind: string): string {
  return KIND_COLORS[kind] ?? UNKNOWN_COLOR;
}

/**
 * Cách viết "không chọn loại nào" trong địa chỉ. Chuỗi rỗng đã dành cho bộ
 * mặc định, nên việc bỏ chọn hết phải có một tên riêng; không có nó thì bỏ
 * chọn ô cuối cùng sẽ làm mọi ô bật lại.
 */
export const NO_KINDS = "none";

/**
 * Đọc tham số `kinds` của địa chỉ ("section,snippet") thành danh sách loại.
 * Vắng mặt hoặc rỗng là bộ mặc định; loại lạ hoặc không vẽ được thì bỏ (nên
 * "none" ra danh sách rỗng). Kết quả luôn theo thứ tự của DRAWN_KINDS, không
 * trùng.
 */
export function parseKinds(text: string): NodeKind[] {
  if (text.trim() === "") return [...DEFAULT_KINDS];

  const asked = new Set(text.split(",").map((item) => item.trim()));
  return DRAWN_KINDS.filter((kind) => asked.has(kind));
}

/** Ngược với parseKinds. Bộ mặc định viết thành chuỗi rỗng, để địa chỉ gọn. */
export function formatKinds(kinds: readonly NodeKind[]): string {
  const ordered = DRAWN_KINDS.filter((kind) => kinds.includes(kind));
  if (ordered.length === 0) return NO_KINDS;

  const isDefault = ordered.length === DEFAULT_KINDS.length && ordered.every((kind, index) => kind === DEFAULT_KINDS[index]);

  return isDefault ? "" : ordered.join(",");
}

/** Bật hoặc tắt một loại trong danh sách đang chọn. */
export function toggleKind(kinds: readonly NodeKind[], kind: NodeKind): NodeKind[] {
  const next = kinds.includes(kind) ? kinds.filter((entry) => entry !== kind) : [...kinds, kind];
  return DRAWN_KINDS.filter((entry) => next.includes(entry));
}

/**
 * Tên ngắn in cạnh một node: bỏ thư mục và đuôi file, vì màu đã nói lên loại.
 *   snippets/card-product.liquid -> card-product
 *   templates/customers/login.json -> customers/login
 *   page:product -> product
 *   assets/base.css -> base.css      (asset giữ đuôi: icon.svg khác icon.js)
 */
export function nodeLabel(id: string, kind: string): string {
  if (id.startsWith("page:")) return id.slice("page:".length);

  const name = id.slice(id.indexOf("/") + 1);
  return kind === "asset" ? name : name.replace(/\.(liquid|json)$/, "");
}

/** Một node sẽ được vẽ. */
export interface DrawNode {
  id: string;
  kind: NodeKind;
  label: string;
  color: string;
  size: number; // bán kính tính bằng pixel
  callers: number; // số node đang hiện gọi trực tiếp tới nó
}

/**
 * Một cạnh sẽ được vẽ. Hai file có thể nối nhau bằng nhiều loại quan hệ (vừa
 * render vừa tải bằng JavaScript); trên hình chúng gộp thành một đường.
 */
export interface DrawEdge {
  key: string; // "from\nto": ký tự xuống dòng không có trong id nào
  from: string;
  to: string;
  types: EdgeType[]; // xếp theo tên
  conditional: boolean; // true khi MỌI quan hệ gộp vào đều có điều kiện
}

/** Kết quả của drawGraph(). */
export interface DrawGraph {
  nodes: DrawNode[]; // xếp theo id
  edges: DrawEdge[]; // xếp theo (from, to)
  // Số node thuộc loại đang chọn có trong theme. Khác nodes.length khi đang
  // thu về lân cận của một node.
  available: number;
  // Node đang được lấy làm tâm, nếu có và nếu nó tồn tại trong theme.
  center: string | null;
}

export interface DrawOptions {
  kinds: readonly NodeKind[];
  // Chỉ giữ node này và những gì cách nó nhiều nhất `depth` bước, theo cả hai
  // chiều. Node này luôn được vẽ, kể cả khi loại của nó đang tắt.
  center?: string;
  depth?: number; // mặc định 1
}

/** Bán kính nhỏ nhất và lớn nhất của một node. */
const MIN_SIZE = 4;
const MAX_SIZE = 18;

/**
 * Cỡ của node theo số nơi gọi nó. Dùng căn bậc hai để một snippet có 80 nơi
 * gọi không to gấp 80 lần snippet có một nơi gọi.
 */
export function nodeSize(callers: number): number {
  return Math.min(MAX_SIZE, MIN_SIZE + 2 * Math.sqrt(callers));
}

/**
 * Tập node cách `center` nhiều nhất `depth` bước, đi theo cạnh ở cả hai
 * chiều (ai gọi nó, và nó gọi ai). Gồm cả `center`.
 */
export function neighborhood(edges: readonly { from: string; to: string }[], center: string, depth: number): Set<string> {
  const neighbours = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    const list = neighbours.get(a);
    if (list === undefined) neighbours.set(a, [b]);
    else list.push(b);
  };

  for (const edge of edges) {
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }

  const reached = new Set([center]);
  let frontier = [center];

  for (let step = 0; step < depth && frontier.length > 0; step++) {
    const next: string[] = [];

    for (const id of frontier) {
      for (const other of neighbours.get(id) ?? []) {
        if (reached.has(other)) continue;
        reached.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }

  return reached;
}

/**
 * Chọn ra phần của đồ thị sẽ được vẽ.
 *
 *   1. Giữ node thuộc loại đang chọn (và node tâm, nếu có).
 *   2. Giữ cạnh có cả hai đầu còn lại; bỏ cạnh tự trỏ vào chính nó (snippet
 *      tự gọi mình), vì nó không có chiều dài để vẽ.
 *   3. Gộp các cạnh cùng hai đầu thành một.
 *   4. Nếu có node tâm: chỉ giữ lân cận của nó.
 */
export function drawGraph(exported: ExportedGraph, options: DrawOptions): DrawGraph {
  const kinds = new Set<string>(options.kinds);
  const kindOf = new Map(exported.nodes.map((node) => [node.id, node.kind]));
  const center = options.center !== undefined && kindOf.has(options.center) ? options.center : null;

  const shown = new Set(exported.nodes.filter((node) => kinds.has(node.kind) || node.id === center).map((node) => node.id));
  const available = exported.nodes.filter((node) => kinds.has(node.kind)).length;

  const merged = new Map<string, DrawEdge>();

  for (const edge of exported.edges) {
    if (edge.from === edge.to || !shown.has(edge.from) || !shown.has(edge.to)) continue;

    const key = `${edge.from}\n${edge.to}`;
    const existing = merged.get(key);

    if (existing === undefined) {
      merged.set(key, { key, from: edge.from, to: edge.to, types: [edge.type], conditional: edge.conditional });
    } else {
      existing.types.push(edge.type);
      existing.conditional = existing.conditional && edge.conditional;
    }
  }

  let edges = [...merged.values()];

  if (center !== null) {
    const near = neighborhood(edges, center, options.depth ?? 1);

    for (const id of shown) {
      if (!near.has(id)) shown.delete(id);
    }
    edges = edges.filter((edge) => near.has(edge.from) && near.has(edge.to));
  }

  const callers = new Map<string, number>();
  for (const edge of edges) callers.set(edge.to, (callers.get(edge.to) ?? 0) + 1);

  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  return {
    nodes: [...shown].sort(compare).map((id) => {
      // `shown` chỉ chứa id lấy từ exported.nodes, nên luôn tra được loại.
      const kind = kindOf.get(id) as NodeKind;
      const count = callers.get(id) ?? 0;

      return { id, kind, label: nodeLabel(id, kind), color: kindColor(kind), size: nodeSize(count), callers: count };
    }),
    edges: edges
      .map((edge) => ({ ...edge, types: [...edge.types].sort(compare) }))
      .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to)),
    available,
    center,
  };
}
