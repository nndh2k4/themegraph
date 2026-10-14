import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpExceptionFilter } from "../mcp.exception-filter.js";

/**
 * Một tool của MCP server: controller của lớp vỏ MCP. Mỗi tool tự khai tên,
 * mô tả và schema tham số (zod đóng vai DTO + ValidationPipe), rồi đăng ký
 * với server; phần thân của nó đi qua exception filter.
 */
export interface McpTool {
  register(server: McpServer, filter: McpExceptionFilter): void;
}

/** Mọi tool đều chỉ đọc và chỉ nhìn vào dữ liệu trên máy. */
export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** Tham số `theme` mà mọi tool truy vấn cùng nhận. */
export const themeParam = z
  .string()
  .optional()
  .describe(
    "Tên hoặc đường dẫn của theme cần hỏi (xem list_themes). Bỏ trống: theme chứa thư mục đang làm việc, hoặc theme duy nhất đã phân tích.",
  );

/** Tham số `limit` của các tool trả danh sách. */
export const limitParam = (fallback: number, what: string) =>
  z.number().int().min(1).max(2000).optional().describe(`Số dòng tối đa của ${what}. Mặc định ${fallback}.`);
