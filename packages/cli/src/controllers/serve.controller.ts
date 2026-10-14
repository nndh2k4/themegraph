import type { CliInput } from "../cli-input.js";
import { EXIT_FAILED, EXIT_OK } from "../cli.types.js";
import type { CliController, Io, RunOverrides } from "../cli.types.js";
import type { PackagePaths } from "../package-paths.js";
import { resolveWebRoot } from "../web-root.js";

/**
 * themegraph serve: chạy giao diện web và API trên 127.0.0.1 cho tới khi bị ngắt.
 *
 * Gói @themegraph/server chỉ được nạp ở đây, như gói mcp ở lệnh mcp.
 */
export class ServeController implements CliController {
  readonly command = "serve";

  constructor(
    private readonly paths: PackagePaths,
    private readonly overrides: RunOverrides,
  ) {}

  async run(input: CliInput, io: Io): Promise<number> {
    input.rejectArgs();

    const { DEFAULT_PORT, startServer } = await import("@themegraph/server");
    const port = input.flags.port ?? DEFAULT_PORT;

    let server;
    try {
      // Giao diện nằm trong gói khi cài từ bản phát hành, hoặc ở
      // packages/web/dist/ khi chạy trong repo mã nguồn (xem resolveWebRoot).
      server = await startServer({ port, webRoot: resolveWebRoot(this.paths.webRoots) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        io.stderr(`Lỗi: cổng ${port} đang được dùng. Có thể một lệnh "themegraph serve" khác đang chạy; nếu không, thử cổng khác: themegraph serve --port ${port + 1}`);
        return EXIT_FAILED;
      }
      throw error;
    }

    io.stdout(`ThemeGraph đang chạy ở ${server.url}`);
    io.stdout("Bấm Ctrl+C để dừng.");
    this.overrides.onServing?.(server);

    // Server giữ tiến trình sống; lệnh "xong" ở đây nhưng tiến trình chưa thoát.
    return EXIT_OK;
  }
}
