import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "@themegraph/core";

import { INSTRUCTIONS } from "./instructions.js";
import { McpModule } from "./mcp.module.js";
import type { ServerOptions } from "./mcp.module.js";

/**
 * Tạo MCP server với sáu tool. Chưa nối với đường truyền nào.
 *
 * Lớp này cố ý mỏng, như lớp CLI: mỗi tool đọc tham số, gọi MỘT service của
 * lõi, rồi gửi lại đúng những dòng chữ mà lệnh `themegraph` tương ứng in ra.
 * Không tool nào tự truy vấn graph.db hay tự tính gì.
 *
 * Server chỉ đọc. Nó không bao giờ chạy analyze: khi đồ thị đã cũ, câu trả
 * lời kèm một dòng cảnh báo và việc phân tích lại là của người dùng.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const module = new McpModule(options);
  const server = new McpServer({ name: "themegraph", version: VERSION }, { instructions: INSTRUCTIONS });

  for (const tool of module.tools) tool.register(server, module.filter);
  return server;
}
