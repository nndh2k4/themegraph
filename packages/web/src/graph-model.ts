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
 * Màu của từng loại node, cho nền tối. Chọn để hai loại hay đứng cạnh nhau
 * (section và snippet, section và block) khác hẳn nhau; asset màu xám vì nó
 * nhiều và ít quan trọng nhất.
 */
export const KIND_COLORS: Record<string, string> = {
  page_type: "#f43f5e",
  template: "#f59e0b",
  layout: "#a855f7",
  section_group: "#14b8a6",
  section: "#3b82f6",
  block: "#10b981",
  snippet: "#ec4899",
  asset: "#64748b",
};

/** Màu cho loại node không có trong bảng (không nên xảy ra; để khỏi vẽ node vô hình). */
const UNKNOWN_COLOR = "#475569";

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

/**
 * Các loại quan hệ giữa file với file, theo thứ tự hiện trong bộ lọc: đi từ
 * trang xuống. Quan hệ tới khoá dịch và setting không có ở đây vì hai loại
 * node đó không được vẽ.
 */
export const DRAWN_EDGE_TYPES: readonly EdgeType[] = ["USES_TEMPLATE", "USES_LAYOUT", "RENDERS", "LOADS_SECTION", "USES_ASSET"];

/**
 * Đọc tham số `edges` của địa chỉ thành danh sách loại quan hệ. Vắng mặt
 * hoặc rỗng là tất cả; loại lạ thì bỏ (nên "none" ra danh sách rỗng).
 */
export function parseEdgeTypes(text: string): EdgeType[] {
  if (text.trim() === "") return [...DRAWN_EDGE_TYPES];

  const asked = new Set(text.split(",").map((item) => item.trim()));
  return DRAWN_EDGE_TYPES.filter((type) => asked.has(type));
}

/** Ngược với parseEdgeTypes. Đủ mọi loại viết thành chuỗi rỗng; không loại nào là "none". */
export function formatEdgeTypes(types: readonly EdgeType[]): string {
  const ordered = DRAWN_EDGE_TYPES.filter((type) => types.includes(type));
  if (ordered.length === 0) return NO_KINDS;

  return ordered.length === DRAWN_EDGE_TYPES.length ? "" : ordered.join(",");
}

/** Bật hoặc tắt một loại quan hệ trong danh sách đang chọn. */
export function toggleEdgeType(types: readonly EdgeType[], type: EdgeType): EdgeType[] {
  const next = types.includes(type) ? types.filter((entry) => entry !== type) : [...types, type];
  return DRAWN_EDGE_TYPES.filter((entry) => next.includes(entry));
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
  // Chỉ vẽ quan hệ thuộc các loại này; không nêu thì vẽ mọi loại.
  edgeTypes?: readonly EdgeType[];
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
 *   2. Giữ cạnh thuộc loại quan hệ đang chọn và có cả hai đầu còn lại; bỏ
 *      cạnh tự trỏ vào chính nó (snippet tự gọi mình), vì nó không có chiều
 *      dài để vẽ.
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
  const edgeTypes = options.edgeTypes === undefined ? null : new Set<string>(options.edgeTypes);

  for (const edge of exported.edges) {
    if (edgeTypes !== null && !edgeTypes.has(edge.type)) continue;
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

/** Một node khớp với từ khoá tìm trên màn đồ thị. */
export interface NodeHit {
  id: string;
  kind: NodeKind;
  label: string;
}

/**
 * Hạng của một node với từ khoá, số nhỏ đứng trước:
 *   0  tên ngắn bắt đầu bằng từ khoá         ("card" -> card, card-product)
 *   1  tên ngắn chứa mọi từ                  ("product card" -> card-product)
 *   2  chỉ khớp khi tính cả tên thư mục      ("sections header" -> sections/header.liquid)
 *
 * Tên đúng bằng từ khoá không cần hạng riêng: nó là tên ngắn nhất trong các
 * tên bắt đầu bằng từ khoá, và trong một hạng thì tên ngắn hơn đứng trước.
 */
function hitRank(label: string, words: readonly string[], whole: string): number {
  if (label.startsWith(whole)) return 0;
  return words.every((word) => label.includes(word)) ? 1 : 2;
}

/**
 * Tìm node theo tên, cho ô tìm kiếm của màn đồ thị.
 *
 * Từ khoá được tách thành các từ; một node khớp khi id của nó chứa MỌI từ,
 * không phân biệt hoa thường. So trên id (có cả tên thư mục) nên gõ
 * "sections header" hay "snippets card" để thu hẹp theo loại file cũng được.
 *
 * Tìm trong mọi loại node vẽ được, kể cả loại đang tắt trên hình: người tìm
 * một file thì muốn thấy nó dù ô lọc của loại đó đang tắt.
 *
 * Kết quả xếp theo hạng (xem hitRank), rồi tên ngắn hơn trước, rồi theo id.
 * Từ khoá rỗng thì không có kết quả nào.
 */
export function searchNodes(nodes: readonly { id: string; kind: NodeKind }[], query: string): NodeHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];

  const whole = words.join(" ");
  const drawn = new Set<string>(DRAWN_KINDS);
  const hits: (NodeHit & { rank: number })[] = [];

  for (const node of nodes) {
    if (!drawn.has(node.kind)) continue;

    const id = node.id.toLowerCase();
    if (!words.every((word) => id.includes(word))) continue;

    const label = nodeLabel(node.id, node.kind);
    hits.push({ id: node.id, kind: node.kind, label, rank: hitRank(label.toLowerCase(), words, whole) });
  }

  return hits
    .sort((a, b) => a.rank - b.rank || a.label.length - b.label.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, kind, label }) => ({ id, kind, label }));
}

/** Một dòng của cây file ở panel trái: thư mục (có `children`) hoặc file (có `id`). */
export interface FileTreeNode {
  name: string; // tên hiển thị của dòng này: tên thư mục, hoặc tên file kèm đuôi
  path: string; // đường dẫn từ gốc, dùng làm key và để nhớ thư mục nào đang mở
  id: string | null; // id của node trong đồ thị; null với thư mục
  kind: NodeKind | null; // loại của node; null với thư mục
  children: FileTreeNode[]; // thư mục trước, rồi file; trong mỗi nhóm xếp theo tên
  files: number; // số file nằm dưới dòng này (với file thì là 1)
}

/** Tên thư mục ảo chứa các loại trang: chúng không phải file nên không có thư mục thật. */
export const PAGES_FOLDER = "trang";

/**
 * Xếp các node vẽ được thành cây thư mục, giống cách chúng nằm trong theme:
 * layout/, templates/ (có thể có thư mục con như customers/), sections/...
 * Các loại trang nằm trong một thư mục ảo đứng đầu cây.
 */
export function buildFileTree(nodes: readonly { id: string; kind: NodeKind }[]): FileTreeNode[] {
  const drawn = new Set<string>(DRAWN_KINDS);
  const root: FileTreeNode = { name: "", path: "", id: null, kind: null, children: [], files: 0 };

  for (const node of nodes) {
    if (!drawn.has(node.kind)) continue;

    // Tên trang có thể có thư mục (customers/login), giống template của nó.
    const parts = node.kind === "page_type" ? [PAGES_FOLDER, ...node.id.slice("page:".length).split("/")] : node.id.split("/");
    let folder = root;

    // Mọi phần trừ phần cuối là thư mục; tạo nếu chưa có.
    for (const part of parts.slice(0, -1)) {
      const path = folder.path === "" ? part : `${folder.path}/${part}`;
      let next = folder.children.find((child) => child.id === null && child.name === part);

      if (next === undefined) {
        next = { name: part, path, id: null, kind: null, children: [], files: 0 };
        folder.children.push(next);
      }
      next.files++;
      folder = next;
    }

    const name = parts.at(-1) ?? node.id;
    folder.children.push({ name, path: node.id, id: node.id, kind: node.kind, children: [], files: 1 });
  }

  const sort = (folder: FileTreeNode): void => {
    folder.children.sort(
      (a, b) =>
        // Thư mục ảo "trang" đứng đầu, rồi thư mục, rồi file; cùng nhóm thì theo tên.
        Number(b.path === PAGES_FOLDER) - Number(a.path === PAGES_FOLDER) ||
        Number(a.id !== null) - Number(b.id !== null) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
    for (const child of folder.children) sort(child);
  };
  sort(root);

  return root.children;
}

/**
 * Lọc cây file theo từ khoá: giữ file có đường dẫn chứa mọi từ (không phân
 * biệt hoa thường), và các thư mục còn file bên dưới. Từ khoá rỗng thì trả
 * nguyên cây.
 */
export function filterFileTree(tree: readonly FileTreeNode[], query: string): FileTreeNode[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [...tree];

  const keep = (node: FileTreeNode): FileTreeNode | null => {
    if (node.id !== null) {
      const path = node.path.toLowerCase();
      return words.every((word) => path.includes(word)) ? node : null;
    }

    const children = node.children.map(keep).filter((child) => child !== null);
    if (children.length === 0) return null;

    return { ...node, children, files: children.reduce((total, child) => total + child.files, 0) };
  };

  return tree.map(keep).filter((node) => node !== null);
}

/**
 * Trộn một màu với màu nền: `amount` = 1 là giữ nguyên màu, 0 là thành màu
 * nền. Cả hai màu viết dạng #rrggbb.
 */
export function dimColor(color: string, background: string, amount: number): string {
  const mix = (at: number): string => {
    const value = parseInt(color.slice(at, at + 2), 16);
    const base = parseInt(background.slice(at, at + 2), 16);
    return Math.round(base + (value - base) * amount)
      .toString(16)
      .padStart(2, "0");
  };

  return `#${mix(1)}${mix(3)}${mix(5)}`;
}
