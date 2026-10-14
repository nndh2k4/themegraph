import { CoreModule } from "@themegraph/core";
import {
  ContextView,
  DeadCodeView,
  ImpactView,
  RenderFlowView,
  SearchView,
  ThemeListView,
  ThemeNoteView,
} from "@themegraph/views";

import { McpExceptionFilter } from "./mcp.exception-filter.js";
import { ThemeRunner } from "./theme-runner.js";
import { ContextTool } from "./tools/context.tool.js";
import { DeadCodeTool } from "./tools/dead-code.tool.js";
import { ImpactTool } from "./tools/impact.tool.js";
import { ListThemesTool } from "./tools/list-themes.tool.js";
import { RenderFlowTool } from "./tools/render-flow.tool.js";
import { SearchTool } from "./tools/search.tool.js";
import type { McpTool } from "./tools/tool.js";

export interface ServerOptions {
  /**
   * Thư mục coi là "đang đứng" khi tool không được nêu theme. Mặc định là thư
   * mục làm việc của tiến trình, tức thư mục dự án mà client mở server.
   */
  cwd?: string;
}

/**
 * Module của MCP server: nối lõi, các view và sáu tool. Thứ tự của `tools` là
 * thứ tự client thấy trong danh sách tool.
 */
export class McpModule {
  readonly tools: readonly McpTool[];
  readonly filter = new McpExceptionFilter();

  constructor(options: ServerOptions = {}) {
    const { themes, graphs } = new CoreModule();
    const runner = new ThemeRunner(themes, graphs, new ThemeNoteView(), options.cwd ?? process.cwd());

    this.tools = [
      new ListThemesTool(themes, new ThemeListView()),
      new SearchTool(runner, new SearchView()),
      new ImpactTool(runner, new ImpactView()),
      new ContextTool(runner, new ContextView()),
      new RenderFlowTool(runner, new RenderFlowView()),
      new DeadCodeTool(runner, new DeadCodeView()),
    ];
  }
}
