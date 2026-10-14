import { VERSION } from "@themegraph/core";

import { parseCliArgs } from "./cli-input.js";
import type { CliExceptionFilter } from "./cli.exception-filter.js";
import { EXIT_OK } from "./cli.types.js";
import type { CliController, Io } from "./cli.types.js";
import { HELP } from "./help.js";
import { UsageError } from "./usage.error.js";

/**
 * Router của CLI: đọc tham số dòng lệnh, chọn controller theo tên lệnh con,
 * và cho mọi lỗi đi qua exception filter.
 *
 * Lớp này cố ý mỏng: không đọc file theme, không biết gì về Liquid hay SQLite.
 */
export class CliRouter {
  private readonly controllers: ReadonlyMap<string, CliController>;

  constructor(
    controllers: readonly CliController[],
    private readonly filter: CliExceptionFilter,
  ) {
    this.controllers = new Map(controllers.map((controller) => [controller.command, controller]));
  }

  async run(argv: string[], io: Io): Promise<number> {
    try {
      const parsed = parseCliArgs(argv);

      if (parsed.kind === "version") {
        io.stdout(VERSION);
        return EXIT_OK;
      }
      if (parsed.kind === "help") {
        io.stdout(HELP);
        return EXIT_OK;
      }

      const controller = this.controllers.get(parsed.input.command);
      if (controller === undefined) throw new UsageError(`Không có lệnh "${parsed.input.command}".`);

      return await controller.run(parsed.input, io);
    } catch (error) {
      return this.filter.catch(error, io);
    }
  }
}
