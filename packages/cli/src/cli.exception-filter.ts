import { EXIT_FAILED, EXIT_USAGE } from "./cli.types.js";
import type { Io } from "./cli.types.js";
import { UsageError } from "./usage.error.js";

/**
 * Đổi lỗi thành dòng báo lỗi và mã thoát (giống exception filter của NestJS).
 *
 * - UsageError: gõ sai cú pháp, kèm lời chỉ tới --help, mã 2.
 * - Mọi lỗi khác, chủ yếu là lỗi của lõi (thư mục không phải theme, theme chưa
 *   được analyze, tên file không có trong đồ thị...): thông báo của chúng đã
 *   viết cho người đọc, nên chỉ việc in ra, mã 1.
 */
export class CliExceptionFilter {
  catch(error: unknown, io: Io): number {
    if (error instanceof UsageError) {
      io.stderr(error.message);
      io.stderr('Gõ "themegraph --help" để xem cách dùng.');
      return EXIT_USAGE;
    }

    io.stderr(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }
}
