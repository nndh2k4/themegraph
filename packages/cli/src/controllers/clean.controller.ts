import type { ThemeService } from "@themegraph/core";
import type { CleanView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";
import { UsageError } from "../usage.error.js";

/** themegraph clean: xoá dữ liệu của theme đang đứng, hoặc của mọi theme với --all. */
export class CleanController implements CliController {
  readonly command = "clean";

  constructor(
    private readonly themes: ThemeService,
    private readonly view: CleanView,
  ) {}

  run(input: CliInput, io: Io): number {
    input.rejectArgs();

    if (input.flags.all && input.flags.theme !== undefined) {
      throw new UsageError("themegraph clean nhận --all hoặc --theme, không nhận cả hai.");
    }

    // Khác các lệnh khác ở một chỗ: khi đồ thị của theme đã mất thì không còn
    // gì trên đĩa để nhận ra thư mục theme, nên clean hỏi thêm sổ đăng ký trước
    // khi chịu lấy thư mục đang đứng. Nhờ vậy đứng trong sections/ của một theme
    // đã mất graph.db vẫn gỡ được mục của nó khỏi sổ.
    const cwd = input.cwd;
    const themeRoot = input.flags.theme ?? this.themes.locate(cwd) ?? this.themes.findRegistered(cwd) ?? cwd;

    const results = input.flags.all ? this.themes.cleanAll() : [this.themes.clean(themeRoot)];

    input.print(results, this.view, io);
    return EXIT_OK;
  }
}
