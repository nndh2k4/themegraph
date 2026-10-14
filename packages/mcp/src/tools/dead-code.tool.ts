import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DeadCodeView } from "@themegraph/views";

import { DEFAULT_LIST_LIMIT } from "../instructions.js";
import type { McpExceptionFilter } from "../mcp.exception-filter.js";
import type { ThemeRunner } from "../theme-runner.js";
import { READ_ONLY, limitParam, themeParam } from "./tool.js";
import type { McpTool } from "./tool.js";

/** Tool dead_code: file, khoá dịch và setting không còn được dùng. */
export class DeadCodeTool implements McpTool {
  constructor(
    private readonly runner: ThemeRunner,
    private readonly view: DeadCodeView,
  ) {}

  register(server: McpServer, filter: McpExceptionFilter): void {
    server.registerTool(
      "dead_code",
      {
        title: "File không còn được dùng trong Shopify theme",
        description:
          'Shopify theme (Liquid): những file không loại trang nào dùng tới, chia hai mức: "chắc chắn không dùng" và "cần xem lại" (kèm lý do); cùng các khoá dịch và setting không file nào gọi, và các file JavaScript định nghĩa một custom element đang được viết ra mà không trang nào nạp (lỗi cần sửa, không phải file thừa). Gọi khi dọn dẹp theme hoặc được hỏi "file nào thừa", "xoá được gì".',
        inputSchema: {
          limit: limitParam(DEFAULT_LIST_LIMIT, "mỗi danh sách"),
          theme: themeParam,
        },
        annotations: READ_ONLY,
      },
      ({ limit, theme }) =>
        filter.run(() =>
          this.runner.run(theme, (scope) => this.view.render(scope.deadCode.findUnused(), { limit: limit ?? DEFAULT_LIST_LIMIT })),
        ),
    );
  }
}
