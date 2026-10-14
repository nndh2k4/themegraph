import os from "node:os";

import type { CliInput } from "../cli-input.js";
import { EXIT_FAILED, EXIT_OK } from "../cli.types.js";
import type { CliController, Io, RunOverrides } from "../cli.types.js";
import type { PackagePaths } from "../package-paths.js";
import { formatSetup, runClaudeCommand, setup } from "../setup.js";
import type { SetupOptions } from "../setup.js";

/**
 * themegraph setup: nối ThemeGraph vào các AI agent có trên máy. Trả mã 1 nếu
 * có bước nào muốn ghi mà không ghi được.
 */
export class SetupController implements CliController {
  readonly command = "setup";

  constructor(
    private readonly paths: PackagePaths,
    private readonly overrides: RunOverrides,
  ) {}

  run(input: CliInput, io: Io): number {
    input.rejectArgs();

    const options: SetupOptions = {
      homeDir: os.homedir(),
      nodePath: process.execPath,
      cliPath: this.paths.cliPath,
      skillSource: this.paths.skillSource,
      dryRun: input.flags.dryRun,
      remove: input.flags.remove,
      runClaude: runClaudeCommand,
      ...this.overrides.setup,
    };

    const steps = setup(options);

    if (input.flags.json) io.stdout(JSON.stringify(steps, null, 2));
    else for (const line of formatSetup(steps, options)) io.stdout(line);

    return steps.some((step) => step.outcome === "failed") ? EXIT_FAILED : EXIT_OK;
  }
}
