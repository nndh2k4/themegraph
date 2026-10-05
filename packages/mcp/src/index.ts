import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";
import type { ServerOptions } from "./server.js";

export {
  createServer,
  DEFAULT_FLOW_DEPTH,
  DEFAULT_FLOW_LINES,
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_RESULTS,
  INSTRUCTIONS,
} from "./server.js";
export type { ServerOptions } from "./server.js";

/**
 * Chạy MCP server trên stdin/stdout của tiến trình, tức cách mà Claude Code
 * và Cursor mở một server cục bộ.
 *
 * Trên đường truyền này stdout CHỈ được chứa thông điệp JSON-RPC. Mọi thứ
 * khác (cảnh báo của Node, log) phải ra stderr, nếu không client sẽ đọc phải
 * một dòng không phải JSON và ngắt kết nối. Vì vậy trong gói này không có
 * lời gọi console.log nào.
 *
 * Promise trả về hoàn thành khi server đã sẵn sàng nhận thông điệp. Tiến trình
 * tự kết thúc khi client đóng stdin.
 */
export async function runStdioServer(options: ServerOptions = {}): Promise<void> {
  const server = createServer(options);
  await server.connect(new StdioServerTransport());
}
