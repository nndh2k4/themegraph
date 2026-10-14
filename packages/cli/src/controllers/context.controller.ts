import type { GraphScopeFactory, ThemeService } from "@themegraph/core";
import type { ContextView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";

/** themegraph context <file>: file này là gì, ai gọi nó, nó gọi ai. */
export class ContextController implements CliController {
  readonly command = "context";

  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
    private readonly view: ContextView,
  ) {}

  run(input: CliInput, io: Io): number {
    const target = input.requireOne("đường dẫn của một file");
    const result = this.graphs.use(input.themeRoot(this.themes), (scope) =>
      scope.context.describe(target, { baseDir: input.cwd }),
    );
    input.print(result, this.view, io);
    return EXIT_OK;
  }
}
