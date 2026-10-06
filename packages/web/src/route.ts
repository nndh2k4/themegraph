/**
 * Định tuyến bằng phần hash của địa chỉ (sau dấu #).
 *
 * Giao diện chỉ có hai màn: chọn theme, và màn làm việc của một theme. Mọi
 * trạng thái của màn làm việc (bộ lọc, node đang chọn, tab đang mở...) nằm
 * trong địa chỉ, nên nút Back đưa về đúng trạng thái trước, và một đường dẫn
 * chép cho người khác mở ra đúng cái đang xem.
 *
 *   #/                 chọn theme
 *   #/t/<id>?...       màn làm việc của một theme, với các tham số:
 *     kinds=a,b        loại node đang hiện           (vắng mặt: bộ mặc định)
 *     edges=a,b        loại quan hệ đang hiện        (vắng mặt: tất cả)
 *     node=<id>        node đang chọn
 *     depth=1|2|3      chỉ hiện những gì cách node đang chọn chừng đó bước
 *     layout=tree      bố cục theo tầng              (vắng mặt: bố cục lực)
 *     tab=detail|flow  tab đang mở ở panel phải      (vắng mặt: tổng quan)
 *     page=<tên>       trang đang xem ở tab luồng trang
 *
 * Các địa chỉ của giao diện cũ (nhiều màn rời) vẫn đọc được, và được hiểu
 * thành trạng thái tương ứng của màn làm việc:
 *
 *   #/t/<id>/graph?kinds&node&near=1   ->  node, depth=1
 *   #/t/<id>/file?path=<id>            ->  node=<id>, tab=detail
 *   #/t/<id>/flow?page=<tên>           ->  tab=flow, page=<tên>
 *   #/t/<id>/search?...                ->  màn làm việc (ô tìm kiếm nay ở thanh trên)
 */

/** Cách xếp node trên vùng vẽ. */
export type GraphLayout = "force" | "tree";

/** Tab của panel bên phải. */
export type PanelTab = "overview" | "detail" | "flow";

export interface WorkspaceRoute {
  name: "workspace";
  themeId: string;
  kinds: string; // danh sách loại node, rỗng là bộ mặc định (xem parseKinds)
  edges: string; // danh sách loại quan hệ, rỗng là tất cả (xem parseEdgeTypes)
  node: string; // id của node đang chọn, rỗng là không chọn
  depth: number; // 0: hiện cả đồ thị; 1 tới 3: lân cận của node đang chọn
  layout: GraphLayout;
  tab: PanelTab;
  page: string; // tên loại trang ở tab luồng trang, rỗng là chưa chọn
}

export type Route = { name: "themes" } | WorkspaceRoute | { name: "not_found" };

/** Độ sâu lân cận lớn nhất giao diện cho chọn. */
export const MAX_DEPTH = 3;

/** Màn làm việc của một theme ở trạng thái ban đầu, ghi đè bằng `changes`. */
export function workspaceRoute(themeId: string, changes: Partial<Omit<WorkspaceRoute, "name" | "themeId">> = {}): WorkspaceRoute {
  return {
    name: "workspace",
    themeId,
    kinds: "",
    edges: "",
    node: "",
    depth: 0,
    layout: "force",
    tab: "overview",
    page: "",
    ...changes,
  };
}

/** Đọc tham số depth: chỉ nhận số nguyên từ 1 tới MAX_DEPTH, còn lại là 0. */
function parseDepth(text: string | null): number {
  if (text === null || !/^\d$/.test(text)) return 0;
  const depth = Number(text);
  return depth <= MAX_DEPTH ? depth : 0;
}

/** Đọc một hash (có hay không có dấu # ở đầu) thành Route. */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart = "", queryPart = ""] = raw.split(/\?(.*)/s);
  const segments = pathPart.split("/").filter((segment) => segment !== "");
  const query = new URLSearchParams(queryPart);

  if (segments.length === 0) return { name: "themes" };

  const [prefix, themeId, screen, ...extra] = segments;
  if (prefix !== "t" || themeId === undefined || extra.length > 0) return { name: "not_found" };

  if (screen === undefined) {
    const node = query.get("node") ?? "";
    const tab = query.get("tab");

    return workspaceRoute(themeId, {
      kinds: query.get("kinds") ?? "",
      edges: query.get("edges") ?? "",
      node,
      depth: parseDepth(query.get("depth")),
      layout: query.get("layout") === "tree" ? "tree" : "force",
      tab: tab === "detail" || tab === "flow" ? tab : "overview",
      page: query.get("page") ?? "",
    });
  }

  // ---- địa chỉ của giao diện cũ ----
  if (screen === "graph") {
    const node = query.get("node") ?? "";

    return workspaceRoute(themeId, {
      kinds: query.get("kinds") ?? "",
      node,
      depth: node !== "" && query.get("near") === "1" ? 1 : 0,
      tab: node === "" ? "overview" : "detail",
    });
  }
  if (screen === "file") {
    const path = query.get("path");
    // Thiếu path thì không biết mở file nào.
    return path === null || path === "" ? { name: "not_found" } : workspaceRoute(themeId, { node: path, tab: "detail" });
  }
  if (screen === "flow") return workspaceRoute(themeId, { tab: "flow", page: query.get("page") ?? "" });
  if (screen === "search") return workspaceRoute(themeId);

  return { name: "not_found" };
}

/** Đổi một Route thành hash để gán vào href. Ngược với parseRoute. */
export function formatRoute(route: Route): string {
  if (route.name !== "workspace") return "#/";

  // Chỉ ghi tham số khác giá trị ban đầu, để địa chỉ gọn.
  const query = new URLSearchParams();
  if (route.kinds !== "") query.set("kinds", route.kinds);
  if (route.edges !== "") query.set("edges", route.edges);
  if (route.node !== "") query.set("node", route.node);
  if (route.depth > 0) query.set("depth", String(route.depth));
  if (route.layout !== "force") query.set("layout", route.layout);
  if (route.tab !== "overview") query.set("tab", route.tab);
  if (route.page !== "") query.set("page", route.page);

  const text = query.toString();
  return `#/t/${route.themeId}${text === "" ? "" : `?${text}`}`;
}
