import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ThemeService } from "@themegraph/core";
import type { ThemeListView } from "@themegraph/views";

import type { McpExceptionFilter } from "../mcp.exception-filter.js";
import { READ_ONLY } from "./tool.js";
import type { McpTool } from "./tool.js";

/** Tool list_themes: các theme đã phân tích trên máy này. Không cần chọn theme. */
export class ListThemesTool implements McpTool {
  constructor(
    private readonly themes: ThemeService,
    private readonly view: ThemeListView,
  ) {}

  register(server: McpServer, filter: McpExceptionFilter): void {
    server.registerTool(
      "list_themes",
      {
        title: "Các Shopify theme đã phân tích",
        description:
          "Liệt kê các Shopify theme đã được ThemeGraph phân tích trên máy này: tên, đường dẫn, số node và cạnh, thời điểm phân tích. Gọi khi cần biết có những theme nào, hoặc khi một tool khác báo phải chọn theme.",
        inputSchema: {},
        annotations: READ_ONLY,
      },
      () => filter.run(() => this.view.render(this.themes.list())),
    );
  }
}
