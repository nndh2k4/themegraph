import type { GraphScopeFactory, ThemeService } from "@themegraph/core";
import type { OverviewView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";

/** themegraph overview: theme này gồm những gì. */
export class OverviewController implements CliController {
  readonly command = "overview";

  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
    private readonly view: OverviewView,
  ) {}

  run(input: CliInput, io: Io): number {
    input.rejectArgs();
    const result = this.graphs.use(input.themeRoot(this.themes), (scope) => scope.overview.summarize());
    input.print(result, this.view, io);
    return EXIT_OK;
  }
}
