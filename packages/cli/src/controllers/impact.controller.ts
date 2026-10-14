import type { GraphScopeFactory, ThemeService } from "@themegraph/core";
import type { ImpactView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";

/** themegraph impact <file>: sửa file này thì file nào, trang nào bị ảnh hưởng. */
export class ImpactController implements CliController {
  readonly command = "impact";

  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
    private readonly view: ImpactView,
  ) {}

  run(input: CliInput, io: Io): number {
    const target = input.requireOne("đường dẫn của một file");

    // baseDir là thư mục đang đứng: người đang ở trong snippets/ gõ được
    // "card.liquid" thay vì "snippets/card.liquid".
    const result = this.graphs.use(input.themeRoot(this.themes), (scope) =>
      scope.impact.findImpact(target, { baseDir: input.cwd }),
    );
    input.print(result, this.view, io);
    return EXIT_OK;
  }
}
