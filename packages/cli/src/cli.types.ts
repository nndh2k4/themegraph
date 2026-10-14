import type { CliInput } from "./cli-input.js";
import type { SetupOptions } from "./setup.js";

/**
 * Nơi lệnh in kết quả ra. Tách thành tham số để test gom được output mà không
 * phải chặn process.stdout; khi chạy thật, cli.ts nối chúng vào console.
 */
export interface Io {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** Những thứ test thay được khi gọi run(). Khi chạy thật không ai truyền gì. */
export interface RunOverrides {
  /**
   * Ghi đè một phần tuỳ chọn của lệnh setup. Test dùng nó để lệnh làm việc
   * trên một thư mục home giả và một lệnh `claude` giả, thay vì cấu hình thật
   * của người chạy test.
   */
  setup?: Partial<SetupOptions>;
  /**
   * Được gọi khi lệnh serve đã nghe cổng. Test dùng nó để lấy cổng thật và
   * tắt server khi xong; khi chạy thật thì server sống tới khi bấm Ctrl+C.
   */
  onServing?: (server: { port: number; url: string; close(): Promise<void> }) => void;
}

/** Mã thoát của lệnh, theo thông lệ của các công cụ dòng lệnh. */
export const EXIT_OK = 0;
export const EXIT_FAILED = 1; // lệnh hợp lệ nhưng chạy không thành công
export const EXIT_USAGE = 2; // gõ sai cú pháp

/** Một lệnh con của `themegraph`: controller của CLI. */
export interface CliController {
  readonly command: string;
  /** Chạy lệnh và trả mã thoát. Sai cú pháp thì ném UsageError. */
  run(input: CliInput, io: Io): number | Promise<number>;
}
