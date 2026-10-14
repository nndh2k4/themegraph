import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ImpactView } from "@themegraph/views";
import { z } from "zod";

import { DEFAULT_LIST_LIMIT } from "../instructions.js";
import type { McpExceptionFilter } from "../mcp.exception-filter.js";
import type { ThemeRunner } from "../theme-runner.js";
import { READ_ONLY, limitParam, themeParam } from "./tool.js";
import type { McpTool } from "./tool.js";

/** Tool impact: sửa một file thì trang nào, file nào bị ảnh hưởng. */
export class ImpactTool implements McpTool {
  constructor(
    private readonly runner: ThemeRunner,
    private readonly view: ImpactView,
  ) {}

  register(server: McpServer, filter: McpExceptionFilter): void {
    server.registerTool(
      "impact",
      {
        title: "Sửa một file của Shopify theme thì ảnh hưởng gì",
        description:
          'Shopify theme (Liquid): sửa hoặc xoá một file thì những file nào và những loại trang nào (product, collection, cart...) bị ảnh hưởng. Đi ngược mọi lời gọi render / section / block / layout / asset, qua mọi tầng trung gian, lên tới trang. GỌI TRƯỚC KHI SỬA một snippet, section, block, layout hay asset, và khi được hỏi kiểu "sửa X thì trang nào vỡ", "X được dùng ở những trang nào".',
        inputSchema: {
          target: z
            .string()
            .min(1)
            .describe(
              "File cần hỏi: đường dẫn tính từ gốc theme (snippets/card-product.liquid), hoặc chỉ tên file (card-product) nếu trong theme không có tên trùng.",
            ),
          limit: limitParam(DEFAULT_LIST_LIMIT, "danh sách file bị ảnh hưởng (danh sách trang luôn đầy đủ)"),
          theme: themeParam,
        },
        annotations: READ_ONLY,
      },
      ({ target, limit, theme }) =>
        filter.run(() =>
          this.runner.run(theme, (scope) => this.view.render(scope.impact.findImpact(target), { limit: limit ?? DEFAULT_LIST_LIMIT })),
        ),
    );
  }
}
