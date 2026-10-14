import type { GraphScopeFactory, ThemeService } from "@themegraph/core";
import type { DeadCodeView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";

/** themegraph dead-code: file nào không còn được dùng. */
export class DeadCodeController implements CliController {
  readonly command = "dead-code";

  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
    private readonly view: DeadCodeView,
  ) {}

  run(input: CliInput, io: Io): number {
    input.rejectArgs();
    const result = this.graphs.use(input.themeRoot(this.themes), (scope) => scope.deadCode.findUnused());
    input.print(result, this.view, io);
    return EXIT_OK;
  }
}
