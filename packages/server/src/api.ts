import path from "node:path";

import {
  context,
  deadCode,
  EXPORT_GROUPS,
  exportGraph,
  GraphNotReadyError,
  hashContent,
  impact,
  listThemes,
  NODE_KINDS,
  NodeNotFoundError,
  openGraph,
  overview,
  renderFlow,
  search,
  themeStatus,
} from "@themegraph/core";
import type { ExportGroup, GraphHandle, ListedTheme, NodeKind } from "@themegraph/core";

/**
 * Một request tới API, đã gỡ khỏi mọi thứ thuộc về HTTP của Node. Tách ra để
 * phần xử lý là một hàm thường: test gọi thẳng nó mà không cần mở cổng nào.
 */
export interface ApiRequest {
  method: string;
  path: string; // phần đường dẫn của URL, ví dụ /api/themes/ab12/search
  query: URLSearchParams;
}

/** Câu trả lời của API: mã HTTP và một giá trị sẽ được ghi ra dạng JSON. */
export interface ApiResponse {
  status: number;
  body: unknown;
}

/** Thân của một câu trả lời lỗi. `code` là thứ chương trình đọc, `message` cho người. */
export interface ApiError {
  error: {
    code: "bad_request" | "theme_not_found" | "node_not_found" | "graph_not_ready" | "not_found" | "method_not_allowed";
    message: string;
    suggestions?: string[]; // chỉ có ở node_not_found
    reason?: string; // chỉ có ở graph_not_ready
  };
}

/** Một theme trong danh sách, kèm mã dùng trong đường dẫn API. */
export interface ApiTheme extends ListedTheme {
  id: string;
  // Vì sao đồ thị của theme không mở được (graph.db không còn, hỏng, hoặc do
  // một bản ThemeGraph cũ ghi), kèm cách chữa; null khi mở được. Có ở đây để
  // màn chọn theme báo ngay, thay vì để người dùng bấm vào rồi mới gặp lỗi.
  problem: string | null;
}

/** Thử mở đồ thị của một theme; trả thông báo lỗi nếu không mở được. */
function problemOf(themePath: string): string | null {
  try {
    // Mở chỉ đọc bảng meta (vài chục byte), nên làm cho mọi theme cũng nhanh.
    openGraph(themePath).close();
    return null;
  } catch (error) {
    if (error instanceof GraphNotReadyError) return error.message;
    throw error;
  }
}

/** Lỗi do tham số của request, thành mã 400. */
class BadRequest extends Error {}

/** Lỗi do mã theme không ứng với theme nào, thành mã 404. */
class ThemeNotFound extends Error {}

/**
 * Mã của một theme trong đường dẫn API: 12 ký tự đầu của hash đường dẫn.
 *
 * Không dùng tên theme vì hai theme ở hai nơi có thể trùng tên thư mục, và
 * không dùng thẳng đường dẫn vì nó chứa dấu gạch chéo và dấu cách. Mã chỉ phụ
 * thuộc đường dẫn, nên giữ nguyên qua các lần phân tích lại.
 */
export function themeId(themeRoot: string): string {
  const resolved = path.resolve(themeRoot);
  // Windows không phân biệt hoa thường trong đường dẫn.
  return hashContent(process.platform === "win32" ? resolved.toLowerCase() : resolved).slice(0, 12);
}

function fail(status: number, error: ApiError["error"]): ApiResponse {
  return { status, body: { error } satisfies ApiError };
}

/** Đọc một tham số bắt buộc; thiếu hoặc rỗng thì báo 400. */
function required(query: URLSearchParams, name: string): string {
  const value = query.get(name);
  if (value === null || value.trim() === "") throw new BadRequest(`Thiếu tham số "${name}".`);
  return value;
}

/** Đọc một tham số là số nguyên từ `min` trở lên; vắng mặt thì trả undefined. */
function optionalInt(query: URLSearchParams, name: string, min: number): number | undefined {
  const value = query.get(name);
  if (value === null) return undefined;
  // Chỉ nhận chuỗi toàn chữ số: Number() còn hiểu cả "1e3", " 5 " và "".
  if (!/^\d+$/.test(value) || Number(value) < min) {
    throw new BadRequest(`Tham số "${name}" phải là số nguyên từ ${min} trở lên.`);
  }
  return Number(value);
}

/** Đọc một tham số dạng danh sách cách nhau bằng dấu phẩy, mỗi mục phải thuộc `allowed`. */
function optionalList<T extends string>(query: URLSearchParams, name: string, allowed: readonly T[]): T[] {
  const value = query.get(name);
  if (value === null || value === "") return [];

  const items = value.split(",").map((item) => item.trim());
  const unknown = items.find((item) => !(allowed as readonly string[]).includes(item));
  if (unknown !== undefined) {
    throw new BadRequest(`Tham số "${name}" không nhận giá trị "${unknown}". Các giá trị: ${allowed.join(", ")}.`);
  }
  return items as T[];
}

/** Mở đồ thị của theme có mã `id`, chạy `body`, rồi luôn đóng lại. */
function withTheme<T>(id: string, body: (graph: GraphHandle) => T): T {
  const theme = listThemes().find((entry) => themeId(entry.path) === id);
  if (theme === undefined) throw new ThemeNotFound(`Không có theme nào mang mã "${id}".`);

  // Mở và đóng trong từng request: giữ graph.db mở thì trên Windows lệnh
  // analyze không ghi đè được file đó trong lúc server đang chạy.
  const graph = openGraph(theme.path);
  try {
    return body(graph);
  } finally {
    graph.close();
  }
}

/** Các route nằm dưới /api/themes/:id/. Mỗi route gọi đúng một hoặc hai hàm của lõi. */
const THEME_ROUTES: Record<string, (id: string, query: URLSearchParams) => unknown> = {
  // Tổng quan kèm tình trạng đồ thị. Đây là route duy nhất so hash file với
  // đĩa (themeStatus), vì phép so đó tốn hàng trăm mili giây trên theme lớn.
  overview: async (id) => {
    const summary = withTheme(id, (graph) => overview(graph));
    return { overview: summary, status: await themeStatus(summary.themeRoot) };
  },

  search: (id, query) => {
    const kinds = optionalList<NodeKind>(query, "kind", NODE_KINDS);
    const limit = optionalInt(query, "limit", 0);

    return withTheme(id, (graph) =>
      search(graph, query.get("q") ?? "", { kinds, ...(limit === undefined ? {} : { limit }) }),
    );
  },

  // Mọi thứ về một file: quan hệ trực tiếp (context) và phạm vi ảnh hưởng
  // (impact). Đường dẫn file đi trong tham số vì nó chứa dấu gạch chéo.
  file: (id, query) => {
    const target = required(query, "path");
    return withTheme(id, (graph) => ({ context: context(graph, target), impact: impact(graph, target) }));
  },

  flow: (id, query) => {
    const page = required(query, "page");
    const maxDepth = optionalInt(query, "depth", 1);

    return withTheme(id, (graph) => renderFlow(graph, page, maxDepth === undefined ? {} : { maxDepth }));
  },

  "dead-code": (id) => withTheme(id, (graph) => deadCode(graph)),

  graph: (id, query) => {
    const include = optionalList<ExportGroup>(query, "include", EXPORT_GROUPS);
    return withTheme(id, (graph) => exportGraph(graph, { include }));
  },
};

/**
 * Xử lý một request tới /api/....
 *
 * Lớp này cố ý mỏng: mỗi route đọc tham số, gọi hàm của lõi, và trả nguyên
 * kết quả. Nó không đọc file theme, không viết SQL, và không ghi gì cả.
 */
export async function handleApi(request: ApiRequest): Promise<ApiResponse> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return fail(405, { code: "method_not_allowed", message: "API của ThemeGraph chỉ nhận GET." });
  }

  const segments = request.path.split("/").filter((segment) => segment !== "");
  const notFound = fail(404, { code: "not_found", message: `Không có đường dẫn ${request.path}.` });

  if (segments[0] !== "api" || segments[1] !== "themes") return notFound;

  try {
    if (segments.length === 2) {
      const themes: ApiTheme[] = listThemes().map((theme) => ({
        id: themeId(theme.path),
        ...theme,
        problem: problemOf(theme.path),
      }));
      return { status: 200, body: themes };
    }

    const [, , id, route] = segments;
    const handler = route === undefined ? undefined : THEME_ROUTES[route];
    if (id === undefined || handler === undefined || segments.length !== 4) return notFound;

    return { status: 200, body: await handler(id, request.query) };
  } catch (error) {
    if (error instanceof BadRequest) return fail(400, { code: "bad_request", message: error.message });
    if (error instanceof RangeError) return fail(400, { code: "bad_request", message: error.message });
    if (error instanceof ThemeNotFound) return fail(404, { code: "theme_not_found", message: error.message });
    if (error instanceof NodeNotFoundError) {
      return fail(404, { code: "node_not_found", message: error.message, suggestions: error.suggestions });
    }
    if (error instanceof GraphNotReadyError) {
      return fail(409, { code: "graph_not_ready", message: error.message, reason: error.reason });
    }
    throw error;
  }
}
