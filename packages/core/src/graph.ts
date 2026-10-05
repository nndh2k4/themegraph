import { resolveRef } from "./resolver.js";
import type {
  EdgeType,
  GraphEdge,
  GraphNode,
  RawRef,
  RefKind,
  ResolvedRef,
  ThemeFile,
  ThemeGraph,
} from "./types.js";

/** Layout mà Shopify dùng khi template không chỉ định layout nào. */
const DEFAULT_LAYOUT = "layout/theme.liquid";

/** So sánh hai chuỗi theo mã ký tự, giống cách scanner sắp xếp. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Loại cạnh ứng với mỗi loại ref.
 *
 * no_layout không có ở đây: nó không sinh cạnh, chỉ là tín hiệu "đừng gán
 * layout mặc định".
 */
const EDGE_TYPE_OF: Partial<Record<RefKind, EdgeType>> = {
  render: "RENDERS",
  include: "RENDERS",
  section: "RENDERS",
  section_group: "RENDERS",
  block: "RENDERS",
  asset: "USES_ASSET",
  layout: "USES_LAYOUT",
};

/**
 * Suy tên loại trang từ đường dẫn của một template.
 *
 *   templates/product.json            -> { page: 'product',         alternate: false }
 *   templates/product.2-columns.json  -> { page: 'product',         alternate: true  }
 *   templates/customers/login.json    -> { page: 'customers/login', alternate: false }
 *   templates/gift_card.liquid        -> { page: 'gift_card',       alternate: false }
 *
 * Quy ước của Shopify: phần tên trước dấu chấm đầu tiên là loại trang, phần
 * giữa (nếu có) là hậu tố của template thay thế. Thư mục con (customers/,
 * metaobject/) là một phần của loại trang.
 */
function pageTypeOf(templatePath: string): { page: string; alternate: boolean } {
  const relative = templatePath.slice("templates/".length);
  const slash = relative.lastIndexOf("/");

  const dir = relative.slice(0, slash + 1); // '' hoặc 'customers/'
  const parts = relative.slice(slash + 1).split("."); // ['product', '2-columns', 'json']

  return {
    page: dir + (parts[0] ?? ""),
    // Đủ 3 phần trở lên nghĩa là có hậu tố giữa tên và đuôi file.
    alternate: parts.length > 2,
  };
}

/**
 * Dựng đồ thị của một theme từ danh sách file và danh sách tham chiếu thô.
 *
 * Hàm thuần: không đọc đĩa, không phụ thuộc thứ tự đầu vào. Cùng một tập file
 * và ref luôn cho ra đúng một kết quả, đã sắp xếp.
 */
export function buildGraph(files: readonly ThemeFile[], rawRefs: readonly RawRef[]): ThemeGraph {
  const knownPaths = new Set(files.map((file) => file.path));

  // ---- Node -------------------------------------------------------------

  // Dùng Map theo id để một loại trang có nhiều template vẫn chỉ là một node.
  const nodes = new Map<string, GraphNode>();

  for (const file of files) {
    nodes.set(file.path, { id: file.path, kind: file.kind });
  }

  // ---- Cạnh -------------------------------------------------------------

  // Khoá của Map là bộ (from, to, type). Ký tự phân cách là dấu xuống dòng vì
  // nó không thể xuất hiện trong đường dẫn file hay tên loại cạnh.
  const edges = new Map<string, GraphEdge>();

  // Mỗi cạnh nhớ riêng tập nguồn của nó; chuỗi `sources` được ghép lại ở cuối.
  const sourcesOf = new Map<string, Set<string>>();

  /** Thêm một lời gọi vào cạnh tương ứng, tạo cạnh nếu chưa có. */
  const addEdge = (
    from: string,
    to: string,
    type: EdgeType,
    source: string,
    conditional: boolean,
  ): void => {
    const key = [from, to, type].join("\n");
    const existing = edges.get(key);

    if (existing === undefined) {
      edges.set(key, { from, to, type, conditional, sources: "", count: 1 });
      sourcesOf.set(key, new Set([source]));
      return;
    }

    // Gộp: cạnh chỉ còn "có điều kiện" khi mọi lời gọi đều có điều kiện.
    existing.conditional = existing.conditional && conditional;
    existing.count += 1;
    sourcesOf.get(key)?.add(source);
  };

  // ---- Loại trang và template ---------------------------------------------

  for (const file of files) {
    if (file.kind !== "template") continue;

    const { page, alternate } = pageTypeOf(file.path);
    const pageId = `page:${page}`;

    nodes.set(pageId, { id: pageId, kind: "page_type" });

    // Template mặc định luôn phục vụ trang đó. Template thay thế chỉ được dùng
    // khi merchant gán nó cho một sản phẩm hay trang cụ thể: có điều kiện.
    addEdge(pageId, file.path, "USES_TEMPLATE", "convention", alternate);
  }

  // ---- Cạnh từ tham chiếu ---------------------------------------------------

  const refs: ResolvedRef[] = [];

  // Template đã tự nói về layout của mình (chọn một layout, hoặc khai không
  // dùng layout) thì không nhận layout mặc định nữa.
  const templatesWithLayoutChoice = new Set<string>();

  for (const ref of rawRefs) {
    const resolution = resolveRef(ref, knownPaths);

    if (ref.kind === "layout" || ref.kind === "no_layout") {
      templatesWithLayoutChoice.add(ref.from);
    }

    refs.push({
      ...ref,
      status: resolution.status,
      target:
        resolution.status === "resolved"
          ? resolution.path
          : resolution.status === "missing"
            ? resolution.expected
            : null,
    });

    // Chỉ ref có file đích mới thành cạnh. Block cục bộ và tham chiếu hỏng
    // vẫn nằm trong `refs` để tra cứu, nhưng không có node nào để trỏ tới.
    if (resolution.status !== "resolved") continue;

    const type = EDGE_TYPE_OF[ref.kind];
    if (type === undefined) continue;

    addEdge(ref.from, resolution.path, type, ref.source, ref.conditional);
  }

  // ---- Layout mặc định ------------------------------------------------------

  if (knownPaths.has(DEFAULT_LAYOUT)) {
    for (const file of files) {
      if (file.kind !== "template") continue;
      if (templatesWithLayoutChoice.has(file.path)) continue;

      addEdge(file.path, DEFAULT_LAYOUT, "USES_LAYOUT", "convention", false);
    }
  }

  // ---- Hoàn thiện và sắp xếp ------------------------------------------------

  for (const [key, edge] of edges) {
    edge.sources = [...(sourcesOf.get(key) ?? [])].sort().join(",");
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => compareText(a.id, b.id)),
    edges: [...edges.values()].sort(
      (a, b) =>
        compareText(a.from, b.from) || compareText(a.to, b.to) || compareText(a.type, b.type),
    ),
    refs: refs.sort(
      (a, b) =>
        compareText(a.from, b.from) ||
        a.line - b.line ||
        compareText(a.kind, b.kind) ||
        compareText(a.to, b.to) ||
        compareText(a.source, b.source) ||
        // Khoá cuối cùng: hai lời gọi có thể giống nhau ở mọi trường trên mà
        // chỉ khác conditional (cùng một block dùng hai lần trong một template
        // JSON, một lần bị tắt). Không so trường này thì thứ tự của chúng sẽ
        // phụ thuộc thứ tự đầu vào. false đứng trước true.
        Number(a.conditional) - Number(b.conditional),
    ),
  };
}
