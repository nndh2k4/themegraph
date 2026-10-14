import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContextView } from "@themegraph/views";
import { z } from "zod";

import { DEFAULT_LIST_LIMIT } from "../instructions.js";
import type { McpExceptionFilter } from "../mcp.exception-filter.js";
import type { ThemeRunner } from "../theme-runner.js";
import { READ_ONLY, limitParam, themeParam } from "./tool.js";
import type { McpTool } from "./tool.js";

/** Tool context: ai gọi một file, nó gọi ai, nó đọc setting và khoá dịch nào. */
export class ContextTool implements McpTool {
  constructor(
    private readonly runner: ThemeRunner,
    private readonly view: ContextView,
  ) {}

  register(server: McpServer, filter: McpExceptionFilter): void {
    server.registerTool(
      "context",
      {
        title: "Một file của Shopify theme: ai gọi nó, nó gọi ai",
        description:
          "Shopify theme (Liquid): mọi thứ ở ngay quanh một file. Ai gọi nó (kèm số dòng của lời gọi), nó gọi những file nào, đọc những setting nào (và setting đó khai ở section nào), dùng những khoá dịch nào, có tham chiếu hỏng nào, và thuộc những loại trang nào. Gọi trước khi đọc hay sửa một file để biết nó nằm ở đâu trong theme. Cũng nhận id của một setting hoặc khoá dịch (t:general.cart.title) để biết file nào dùng nó.",
        inputSchema: {
          target: z
            .string()
            .min(1)
            .describe(
              "File cần hỏi: đường dẫn tính từ gốc theme (sections/header.liquid), hoặc chỉ tên file nếu không trùng; hoặc id của một trang, setting, khoá dịch.",
            ),
          limit: limitParam(DEFAULT_LIST_LIMIT, "mỗi danh sách"),
          theme: themeParam,
        },
        annotations: READ_ONLY,
      },
      ({ target, limit, theme }) =>
        filter.run(() =>
          this.runner.run(theme, (scope) => this.view.render(scope.context.describe(target), { limit: limit ?? DEFAULT_LIST_LIMIT })),
        ),
    );
  }
}
