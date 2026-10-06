import type {
  ContextResult,
  DeadCodeResult,
  ExportedGraph,
  ImpactResult,
  ListedTheme,
  OverviewResult,
  RenderFlowResult,
  SearchResult,
  StatusResult,
} from "@themegraph/core";

/**
 * Các lời gọi tới API của `themegraph serve`. Kiểu dữ liệu lấy thẳng từ lõi
 * bằng import chỉ-kiểu: server trả nguyên kết quả của lõi, nên hai bên không
 * thể lệch nhau mà không báo lỗi lúc biên dịch. Không có mã nào của lõi đi
 * vào bundle.
 */

export interface ApiTheme extends ListedTheme {
  id: string;
  problem: string | null; // vì sao đồ thị không mở được; null khi mở được
}

export interface OverviewResponse {
  overview: OverviewResult;
  status: StatusResult;
}

export interface FileResponse {
  context: ContextResult;
  impact: ImpactResult;
}

/** Lỗi do API trả về, giữ lại mã và gợi ý để màn hình trình bày cho đúng. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly suggestions: string[];

  constructor(status: number, code: string, message: string, suggestions: string[] = []) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
    this.code = code;
    this.suggestions = suggestions;
  }
}

/** Hàm fetch của trình duyệt; là tham số để test thay bằng một hàm giả. */
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Ghép một đường dẫn API với các tham số; tham số rỗng thì bỏ. */
export function apiUrl(path: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== "") query.set(name, value);
  }
  const text = query.toString();
  return text === "" ? path : `${path}?${text}`;
}

/** Gọi một URL của API và trả về thân JSON; ném ApiFailure nếu server báo lỗi. */
export async function getJson<T>(url: string, fetcher: Fetcher): Promise<T> {
  let response;
  try {
    response = await fetcher(url);
  } catch {
    // fetch ném lỗi khi không nối được tới server (đã tắt, sai cổng).
    throw new ApiFailure(0, "unreachable", 'Không nối được tới ThemeGraph. Lệnh "themegraph serve" còn đang chạy không?');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiFailure(response.status, "bad_response", `Server trả về dữ liệu không đọc được (mã ${response.status}).`);
  }

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; suggestions?: string[] } }).error;
    throw new ApiFailure(
      response.status,
      error?.code ?? "unknown",
      error?.message ?? `Server báo lỗi ${response.status}.`,
      error?.suggestions ?? [],
    );
  }

  return body as T;
}

/** Bộ lời gọi API, gắn với một hàm fetch. */
export function createApi(fetcher: Fetcher) {
  const theme = (id: string, route: string): string => `/api/themes/${encodeURIComponent(id)}/${route}`;

  return {
    themes: () => getJson<ApiTheme[]>("/api/themes", fetcher),
    overview: (id: string) => getJson<OverviewResponse>(theme(id, "overview"), fetcher),
    search: (id: string, q: string, kind: string) =>
      getJson<SearchResult>(apiUrl(theme(id, "search"), { q, kind, limit: "100" }), fetcher),
    deadCode: (id: string) => getJson<DeadCodeResult>(theme(id, "dead-code"), fetcher),
    file: (id: string, path: string) => getJson<FileResponse>(apiUrl(theme(id, "file"), { path }), fetcher),
    // Chỉ file và loại trang; khoá dịch và setting không được vẽ.
    graph: (id: string) => getJson<ExportedGraph>(theme(id, "graph"), fetcher),
    flow: (id: string, page: string) => getJson<RenderFlowResult>(apiUrl(theme(id, "flow"), { page }), fetcher),
  };
}

export type Api = ReturnType<typeof createApi>;
