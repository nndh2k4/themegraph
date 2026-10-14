import type { ThemeService } from "@themegraph/core";
import type { StatusView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";

/** themegraph status: đồ thị của theme đang đứng có còn khớp với đĩa không. */
export class StatusController implements CliController {
  readonly command = "status";

  constructor(
    private readonly themes: ThemeService,
    private readonly view: StatusView,
  ) {}

  async run(input: CliInput, io: Io): Promise<number> {
    input.rejectArgs();
    input.print(await this.themes.status(input.themeRoot(this.themes)), this.view, io);
    return EXIT_OK;
  }
}
