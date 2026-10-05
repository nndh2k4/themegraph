import { resolveSettingRef } from "./resolve-setting.js";
import type { Ancestor } from "./resolve-setting.js";
import { resolveRef, TRANSLATION_PREFIX } from "./resolver.js";
import type {
  EdgeType,
  GraphEdge,
  GraphFacts,
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
  translation: "USES_TRANSLATION",
  setting: "READS_SETTING",
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
 * `facts` là những gì theme CÓ ngoài file:
 *   - schemas: dữ kiện đọc từ {% schema %} của từng file; đồ thị chỉ giữ lại
 *     và sắp xếp chúng, không suy ra cạnh nào từ đó
 *   - translationKeys: các khoá dịch của locale mặc định; mỗi khoá thành một
 *     node, để ref loại translation có đích mà trỏ tới
 *   - settings: id node của các setting theme định nghĩa
 *
 * Hàm thuần: không đọc đĩa, không phụ thuộc thứ tự đầu vào. Cùng một tập file
 * và ref luôn cho ra đúng một kết quả, đã sắp xếp.
 */
export function buildGraph(
  files: readonly ThemeFile[],
  rawRefs: readonly RawRef[],
  facts: GraphFacts = {},
): ThemeGraph {
  const { schemas = [], translationKeys = [], settings = [] } = facts;

  const filePaths = new Set(files.map((file) => file.path));

  // ---- Node -------------------------------------------------------------

  // Dùng Map theo id để một loại trang có nhiều template vẫn chỉ là một node.
  const nodes = new Map<string, GraphNode>();

  for (const file of files) {
    nodes.set(file.path, { id: file.path, kind: file.kind });
  }

  for (const key of translationKeys) {
    const id = TRANSLATION_PREFIX + key;
    nodes.set(id, { id, kind: "translation_key" });
  }

  for (const id of settings) {
    nodes.set(id, { id, kind: "setting" });
  }

  // Mọi thứ một ref có thể trỏ tới: file, khoá dịch và setting. Loại trang
  // không có ở đây vì không ref nào trỏ tới loại trang.
  const knownPaths = new Set(nodes.keys());

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

  // Ref đọc setting phải đợi: muốn biết section.settings.x trong một snippet
  // là setting của section nào thì phải có đủ cạnh RENDERS trước đã.
  const settingRefs: RawRef[] = [];

  // Các snippet nhận một tham số tên "settings" từ ít nhất một nơi gọi. Trong
  // chúng, settings.x là đọc tham số đó, không phải setting toàn cục.
  const settingsShadowedIn = new Set<string>();

  for (const ref of rawRefs) {
    if (ref.kind === "setting") {
      settingRefs.push(ref);
      continue;
    }

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

    if (ref.passesSettings === true) settingsShadowedIn.add(resolution.path);

    const type = EDGE_TYPE_OF[ref.kind];
    if (type === undefined) continue;

    addEdge(ref.from, resolution.path, type, ref.source, ref.conditional);
  }

  // ---- Layout mặc định ------------------------------------------------------

  if (filePaths.has(DEFAULT_LAYOUT)) {
    for (const file of files) {
      if (file.kind !== "template") continue;
      if (templatesWithLayoutChoice.has(file.path)) continue;

      addEdge(file.path, DEFAULT_LAYOUT, "USES_LAYOUT", "convention", false);
    }
  }

  // ---- Đọc setting ----------------------------------------------------------

  const kindOf = new Map(files.map((file) => [file.path, file.kind]));

  // "Ai render file này": chiều ngược của các cạnh RENDERS vừa dựng xong.
  const renderersOf = new Map<string, string[]>();
  for (const edge of edges.values()) {
    if (edge.type !== "RENDERS") continue;
    const list = renderersOf.get(edge.to) ?? [];
    list.push(edge.from);
    renderersOf.set(edge.to, list);
  }

  // Nhiều lần đọc trong cùng một file dùng chung một danh sách tổ tiên.
  const ancestorsCache = new Map<string, Ancestor[]>();

  /** Mọi file dẫn tới `path` qua một hay nhiều cạnh RENDERS, không kể chính nó. */
  const ancestorsOf = (path: string): Ancestor[] => {
    const cached = ancestorsCache.get(path);
    if (cached !== undefined) return cached;

    // Duyệt ngược theo chiều rộng; `seen` chặn vòng (snippet gọi lẫn nhau).
    const seen = new Set([path]);
    const queue = [path];
    const found: Ancestor[] = [];

    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      for (const renderer of renderersOf.get(current) ?? []) {
        if (seen.has(renderer)) continue;
        seen.add(renderer);
        queue.push(renderer);

        const kind = kindOf.get(renderer);
        if (kind !== undefined) found.push({ path: renderer, kind });
      }
    }

    // Không cần xếp: thứ tự ở đây chỉ quyết định thứ tự các dòng ref, mà
    // danh sách ref được xếp lại theo đích ở cuối hàm.
    ancestorsCache.set(path, found);
    return found;
  };

  for (const ref of settingRefs) {
    const shadowed = ref.to.startsWith("settings.") && settingsShadowedIn.has(ref.from);

    const resolution = shadowed
      ? ({ status: "unresolved" } as const)
      : resolveSettingRef(ref, kindOf.get(ref.from), ancestorsOf(ref.from), knownPaths);

    if (resolution.status !== "resolved") {
      refs.push({
        ...ref,
        status: resolution.status,
        target: resolution.status === "missing" ? resolution.expected : null,
      });
      continue;
    }

    // Một lần đọc trong snippet có thể ứng với setting của nhiều section:
    // ghi một dòng ref và một cạnh cho mỗi đích.
    for (const target of resolution.targets) {
      refs.push({ ...ref, status: "resolved", target });
      addEdge(ref.from, target, "READS_SETTING", ref.source, ref.conditional);
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
        // Một lần đọc setting có thể thành nhiều dòng, khác nhau ở đích.
        compareText(a.target ?? "", b.target ?? "") ||
        // Khoá cuối cùng: hai lời gọi có thể giống nhau ở mọi trường trên mà
        // chỉ khác conditional (cùng một block dùng hai lần trong một template
        // JSON, một lần bị tắt). Không so trường này thì thứ tự của chúng sẽ
        // phụ thuộc thứ tự đầu vào. false đứng trước true.
        Number(a.conditional) - Number(b.conditional),
    ),
    // Chỉ giữ schema của file có trong theme: bảng schemas tham chiếu tới
    // bảng nodes, nên một dòng mồ côi sẽ bị database từ chối.
    schemas: schemas
      .filter((schema) => filePaths.has(schema.file))
      .sort((a, b) => compareText(a.file, b.file)),
  };
}
