import type { GraphScopeFactory, ThemeService } from "@themegraph/core";
import type { SearchView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";

/**
 * themegraph search [từ-khoá]: tìm node theo tên. Từ khoá có thể gồm nhiều từ;
 * không có từ khoá thì liệt kê, thường đi kèm --kind.
 */
export class SearchController implements CliController {
  readonly command = "search";

  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
    private readonly view: SearchView,
  ) {}

  run(input: CliInput, io: Io): number {
    const { kinds, limit } = input.flags;
    const result = this.graphs.use(input.themeRoot(this.themes), (scope) =>
      scope.search.search(input.positionals.join(" "), {
        kinds,
        // Ở lệnh này --limit là giới hạn của chính truy vấn, không phải của
        // phần trình bày: service cần nó để biết cắt sau khi đã xếp hạng.
        ...(limit === undefined ? {} : { limit }),
      }),
    );
    input.print(result, this.view, io);
    return EXIT_OK;
  }
}
