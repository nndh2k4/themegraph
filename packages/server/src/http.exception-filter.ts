import { GraphNotReadyError, NodeNotFoundError } from "@themegraph/core";

import { fail } from "./api.types.js";
import type { ApiResponse } from "./api.types.js";
import { BadRequestError, ThemeNotFoundError } from "./http.errors.js";

/**
 * Đổi lỗi đã biết thành câu trả lời HTTP có mã và `code` riêng (giống
 * exception filter của NestJS). Lỗi không lường trước thì ném tiếp: lớp nghe
 * cổng trả 500, không để request treo.
 */
export class HttpExceptionFilter {
  catch(error: unknown): ApiResponse {
    if (error instanceof BadRequestError) return fail(400, { code: "bad_request", message: error.message });
    // RangeError: tham số đúng kiểu nhưng ngoài khoảng mà service nhận (ví dụ độ sâu).
    if (error instanceof RangeError) return fail(400, { code: "bad_request", message: error.message });
    if (error instanceof ThemeNotFoundError) return fail(404, { code: "theme_not_found", message: error.message });
    if (error instanceof NodeNotFoundError) {
      return fail(404, { code: "node_not_found", message: error.message, suggestions: error.suggestions });
    }
    if (error instanceof GraphNotReadyError) {
      return fail(409, { code: "graph_not_ready", message: error.message, reason: error.reason });
    }
    throw error;
  }
}
