import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RenderFlowView } from "@themegraph/views";
import { z } from "zod";

import { DEFAULT_FLOW_DEPTH, DEFAULT_FLOW_LINES } from "../instructions.js";
import type { McpExceptionFilter } from "../mcp.exception-filter.js";
import type { ThemeRunner } from "../theme-runner.js";
import { READ_ONLY, limitParam, themeParam } from "./tool.js";
import type { McpTool } from "./tool.js";

/** Tool render_flow: cây các file mà một trang (hoặc một file) kéo theo. */
export class RenderFlowTool implements McpTool {
  constructor(
    private readonly runner: ThemeRunner,
    private readonly view: RenderFlowView,
  ) {}

  register(server: McpServer, filter: McpExceptionFilter): void {
    server.registerTool(
      "render_flow",
      {
        title: "Một trang của Shopify theme render những file nào",
        description:
          'Shopify theme (Liquid): cây các file mà một loại trang kéo theo: template, layout, section, block, snippet, asset, lồng nhau đúng như thứ tự gọi. Gọi khi được hỏi "trang product gồm những gì", "file nào tham gia render trang cart", hoặc để tìm chỗ sửa một thứ hiện trên một trang. Cũng nhận một file làm gốc để xem riêng phần cây bên dưới nó.',
        inputSchema: {
          page: z
            .string()
            .min(1)
            .describe(
              "Tên loại trang (product, collection, index, cart, customers/login...), hoặc đường dẫn một file để lấy cây con của nó.",
            ),
          max_depth: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe(
              `Số tầng của cây, tính từ gốc. Mặc định ${DEFAULT_FLOW_DEPTH}. Node bị cắt ghi số file con chưa mở; hỏi tiếp bằng chính node đó làm gốc.`,
            ),
          limit: limitParam(DEFAULT_FLOW_LINES, "cây"),
          theme: themeParam,
        },
        annotations: READ_ONLY,
      },
      ({ page, max_depth, limit, theme }) =>
        filter.run(() =>
          this.runner.run(theme, (scope) =>
            this.view.render(scope.renderFlow.buildFlow(page, { maxDepth: max_depth ?? DEFAULT_FLOW_DEPTH }), {
              limit: limit ?? DEFAULT_FLOW_LINES,
            }),
          ),
        ),
    );
  }
}
