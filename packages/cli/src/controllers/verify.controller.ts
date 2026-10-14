import type { GraphScopeFactory, ThemeService } from "@themegraph/core";
import type { VerifyView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_FAILED, EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";

/**
 * themegraph verify: đối chiếu truy vấn SQL với phép duyệt bằng JavaScript.
 * Là một phép kiểm tra: không đạt thì lệnh phải thất bại, để dùng được trong
 * script và CI.
 */
export class VerifyController implements CliController {
  readonly command = "verify";

  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
    private readonly view: VerifyView,
  ) {}

  run(input: CliInput, io: Io): number {
    input.rejectArgs();
    const result = this.graphs.use(input.themeRoot(this.themes), (scope) => scope.verify.verify());
    input.print(result, this.view, io);
    return result.ok ? EXIT_OK : EXIT_FAILED;
  }
}
