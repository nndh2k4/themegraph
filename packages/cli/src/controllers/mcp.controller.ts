import type { CliInput } from "../cli-input.js";
import { EXIT_OK } from "../cli.types.js";
import type { CliController } from "../cli.types.js";

/**
 * themegraph mcp: chạy MCP server trên stdin/stdout cho tới khi client đóng stdin.
 *
 * Gói @themegraph/mcp (và bộ SDK nó kéo theo) chỉ được nạp ở đây, bằng
 * import() dạng hàm: các lệnh khác không phải trả giá khởi động của nó.
 *
 * Trong lệnh này TUYỆT ĐỐI không in gì ra io.stdout: stdout là đường truyền
 * của giao thức.
 */
export class McpController implements CliController {
  readonly command = "mcp";

  async run(input: CliInput): Promise<number> {
    input.rejectArgs();

    const { runStdioServer } = await import("@themegraph/mcp");

    // --theme ở đây đổi "thư mục đang đứng" của server, tức theme mặc định khi
    // agent không nêu theme.
    await runStdioServer(input.flags.theme === undefined ? {} : { cwd: input.flags.theme });

    // Server đã sẵn sàng và đang nghe stdin; tiến trình tự thoát khi stdin đóng.
    return EXIT_OK;
  }
}
