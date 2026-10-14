import { CliModule } from "./cli.module.js";
import type { Io, RunOverrides } from "./cli.types.js";
import { packagePaths } from "./package-paths.js";

export type { Io, RunOverrides } from "./cli.types.js";

/**
 * Chạy lệnh themegraph với danh sách tham số (không gồm "node" và tên file).
 * Trả về mã thoát thay vì tự gọi process.exit, để test gọi được nhiều lần.
 *
 * Đây là hàm khởi động (giống main.ts + NestFactory.create của NestJS): tạo
 * CliModule rồi giao việc cho router. Mỗi lần gọi một module mới, nên mỗi lần
 * gọi đọc đúng THEMEGRAPH_HOME lúc đó.
 */
export async function run(argv: string[], io: Io, overrides: RunOverrides = {}): Promise<number> {
  return new CliModule(packagePaths(), overrides).router.run(argv, io);
}
