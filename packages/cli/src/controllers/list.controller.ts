import type { ThemeService } from "@themegraph/core";
import type { ThemeListView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";

/** themegraph list: các theme đã phân tích, không cần đứng trong theme nào. */
export class ListController implements CliController {
  readonly command = "list";

  constructor(
    private readonly themes: ThemeService,
    private readonly view: ThemeListView,
  ) {}

  run(input: CliInput, io: Io): number {
    input.rejectArgs();
    input.print(this.themes.list(), this.view, io);
    return EXIT_OK;
  }
}
