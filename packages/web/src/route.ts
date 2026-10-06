/**
 * Định tuyến bằng phần hash của địa chỉ (sau dấu #).
 *
 * Bốn màn hình không đáng để thêm một thư viện định tuyến. Dùng hash thay vì
 * đường dẫn thật thì server không cần biết gì về các màn hình, và nút
 * Back / Forward của trình duyệt vẫn chạy đúng.
 *
 *   #/                              danh sách theme
 *   #/t/<id>                        tổng quan của một theme
 *   #/t/<id>/search?q=...&kind=...  tìm kiếm
 *   #/t/<id>/file?path=...          chi tiết một file (hoặc trang, khoá dịch, setting)
 */
export type Route =
  | { name: "themes" }
  | { name: "overview"; themeId: string }
  | { name: "search"; themeId: string; q: string; kind: string }
  | { name: "file"; themeId: string; path: string }
  | { name: "not_found" };

/** Đọc một hash (có hay không có dấu # ở đầu) thành Route. */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart = "", queryPart = ""] = raw.split(/\?(.*)/s);
  const segments = pathPart.split("/").filter((segment) => segment !== "");
  const query = new URLSearchParams(queryPart);

  if (segments.length === 0) return { name: "themes" };

  const [prefix, themeId, screen, ...extra] = segments;
  if (prefix !== "t" || themeId === undefined || extra.length > 0) return { name: "not_found" };

  if (screen === undefined) return { name: "overview", themeId };
  if (screen === "search") {
    return { name: "search", themeId, q: query.get("q") ?? "", kind: query.get("kind") ?? "" };
  }
  if (screen === "file") {
    const path = query.get("path");
    // Thiếu path thì không biết mở file nào.
    return path === null || path === "" ? { name: "not_found" } : { name: "file", themeId, path };
  }
  return { name: "not_found" };
}

/** Đổi một Route thành hash để gán vào href. Ngược với parseRoute. */
export function formatRoute(route: Route): string {
  switch (route.name) {
    case "themes":
    case "not_found":
      return "#/";
    case "overview":
      return `#/t/${route.themeId}`;
    case "search": {
      const query = new URLSearchParams();
      if (route.q !== "") query.set("q", route.q);
      if (route.kind !== "") query.set("kind", route.kind);
      const text = query.toString();
      return `#/t/${route.themeId}/search${text === "" ? "" : `?${text}`}`;
    }
    case "file":
      return `#/t/${route.themeId}/file?${new URLSearchParams({ path: route.path }).toString()}`;
  }
}
