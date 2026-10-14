import type { AnalyzeService, ThemeService } from "@themegraph/core";
import type { AnalyzeView } from "@themegraph/views";

import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController, Io } from "../cli.types.js";
import { UsageError } from "../usage.error.js";

/** themegraph analyze [đường-dẫn]: phân tích một theme và ghi đồ thị. */
export class AnalyzeController implements CliController {
  readonly command = "analyze";

  constructor(
    private readonly analyzer: AnalyzeService,
    private readonly themes: ThemeService,
    private readonly view: AnalyzeView,
  ) {}

  async run(input: CliInput, io: Io): Promise<number> {
    if (input.positionals.length > 1) throw new UsageError("themegraph analyze chỉ nhận một đường dẫn.");

    // Không có đường dẫn thì lấy thư mục đang đứng. Việc đổi "." thành đường dẫn
    // tuyệt đối là của lõi; ở đây không tự xử lý đường dẫn.
    const themeRoot = input.positionals[0] ?? input.flags.theme ?? ".";

    const result = await this.analyzer.analyze(themeRoot);
    input.print(result, this.view, io);

    // Đồ thị đã ghi xong nên lệnh vẫn thành công; chỉ báo để người dùng biết vì
    // sao lệnh list không thấy theme này. In ra stderr để không lẫn vào --json.
    if (!result.registered) {
      io.stderr(`Cảnh báo: không ghi được theme vào sổ đăng ký ${this.themes.registryLocation}.`);
    }
    return EXIT_OK;
  }
}
