import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NODE_KINDS } from "@themegraph/core";
import type { SearchView } from "@themegraph/views";
import { z } from "zod";

import { DEFAULT_SEARCH_RESULTS } from "../instructions.js";
import type { McpExceptionFilter } from "../mcp.exception-filter.js";
import type { ThemeRunner } from "../theme-runner.js";
import { READ_ONLY, limitParam, themeParam } from "./tool.js";
import type { McpTool } from "./tool.js";

/** Tool search: tìm node theo tên trong một theme. */
export class SearchTool implements McpTool {
  constructor(
    private readonly runner: ThemeRunner,
    private readonly view: SearchView,
  ) {}

  register(server: McpServer, filter: McpExceptionFilter): void {
    server.registerTool(
      "search",
      {
        title: "Tìm file trong Shopify theme theo tên",
        description:
          'Tìm node trong đồ thị của một Shopify theme theo tên: file Liquid/JSON/asset, loại trang, khoá dịch, setting. Gọi khi chưa biết đường dẫn chính xác (ví dụ chỉ biết "card product"), rồi dùng id trả về cho impact, context hoặc render_flow. Không tìm trong NỘI DUNG file; việc đó dùng grep.',
        inputSchema: {
          query: z
            .string()
            .default("")
            .describe(
              'Một hoặc nhiều từ, không phân biệt hoa thường; mọi từ phải có trong đường dẫn, ví dụ "card product". Để trống cùng với kind để liệt kê cả một loại.',
            ),
          kind: z
            .enum(NODE_KINDS)
            .optional()
            .describe("Chỉ lấy một loại node, ví dụ snippet, section, template, page_type, setting, translation_key."),
          limit: limitParam(DEFAULT_SEARCH_RESULTS, "kết quả"),
          theme: themeParam,
        },
        annotations: READ_ONLY,
      },
      ({ query, kind, limit, theme }) =>
        filter.run(() =>
          this.runner.run(theme, (scope) =>
            this.view.render(scope.search.search(query, { kinds: kind === undefined ? [] : [kind], limit: limit ?? DEFAULT_SEARCH_RESULTS })),
          ),
        ),
    );
  }
}
