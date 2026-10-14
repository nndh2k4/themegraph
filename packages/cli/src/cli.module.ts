import { CoreModule } from "@themegraph/core";
import {
  AnalyzeView,
  CleanView,
  ContextView,
  DeadCodeView,
  ImpactView,
  OverviewView,
  RenderFlowView,
  SearchView,
  StatusView,
  ThemeListView,
  VerifyView,
} from "@themegraph/views";

import { CliExceptionFilter } from "./cli.exception-filter.js";
import { CliRouter } from "./cli.router.js";
import type { RunOverrides } from "./cli.types.js";
import { AnalyzeController } from "./controllers/analyze.controller.js";
import { CleanController } from "./controllers/clean.controller.js";
import { ContextController } from "./controllers/context.controller.js";
import { DeadCodeController } from "./controllers/dead-code.controller.js";
import { ImpactController } from "./controllers/impact.controller.js";
import { ListController } from "./controllers/list.controller.js";
import { McpController } from "./controllers/mcp.controller.js";
import { OverviewController } from "./controllers/overview.controller.js";
import { RenderFlowController } from "./controllers/render-flow.controller.js";
import { SearchController } from "./controllers/search.controller.js";
import { ServeController } from "./controllers/serve.controller.js";
import { SetupController } from "./controllers/setup.controller.js";
import { StatusController } from "./controllers/status.controller.js";
import { VerifyController } from "./controllers/verify.controller.js";
import type { PackagePaths } from "./package-paths.js";

/**
 * Module của CLI: nối lõi, các view và các controller lại với nhau. Đây là nơi
 * duy nhất trong gói cli `new` các provider.
 */
export class CliModule {
  readonly router: CliRouter;

  constructor(paths: PackagePaths, overrides: RunOverrides = {}) {
    const { analyzer, themes, graphs } = new CoreModule();

    this.router = new CliRouter(
      [
        new SetupController(paths, overrides),
        new McpController(),
        new ServeController(paths, overrides),
        new AnalyzeController(analyzer, themes, new AnalyzeView()),
        new ListController(themes, new ThemeListView()),
        new StatusController(themes, new StatusView()),
        new CleanController(themes, new CleanView()),
        new ImpactController(themes, graphs, new ImpactView()),
        new SearchController(themes, graphs, new SearchView()),
        new RenderFlowController(themes, graphs, new RenderFlowView()),
        new ContextController(themes, graphs, new ContextView()),
        new OverviewController(themes, graphs, new OverviewView()),
        new DeadCodeController(themes, graphs, new DeadCodeView()),
        new VerifyController(themes, graphs, new VerifyView()),
      ],
      new CliExceptionFilter(),
    );
  }
}
