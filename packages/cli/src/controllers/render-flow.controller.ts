import type { GraphScopeFactory, RenderFlowOptions, ThemeService } from "@themegraph/core";
import type { RenderFlowView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";

/** themegraph render-flow <trang>: trang này render những file nào, lồng nhau ra sao. */
export class RenderFlowController implements CliController {
  readonly command = "render-flow";

  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
    private readonly view: RenderFlowView,
  ) {}

  run(input: CliInput, io: Io): number {
    const page = input.requireOne("tên một loại trang");
    const { depth } = input.flags;
    const options: RenderFlowOptions = depth === undefined ? { baseDir: input.cwd } : { baseDir: input.cwd, maxDepth: depth };

    const result = this.graphs.use(input.themeRoot(this.themes), (scope) => scope.renderFlow.buildFlow(page, options));
    input.print(result, this.view, io);
    return EXIT_OK;
  }
}
