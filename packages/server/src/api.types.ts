import type { ListedTheme } from "@themegraph/core";

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

/** Một câu trả lời lỗi. */
export function fail(status: number, error: ApiError["error"]): ApiResponse {
  return { status, body: { error } satisfies ApiError };
}
