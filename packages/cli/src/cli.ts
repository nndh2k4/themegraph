#!/usr/bin/env node
// Điểm vào của lệnh `themegraph`. File này chỉ nối lệnh với thế giới thật:
// tham số dòng lệnh, console, và mã thoát của tiến trình. Mọi việc còn lại
// nằm trong run.ts để test được mà không cần mở tiến trình mới.
import { run } from "./run.js";

// Gán process.exitCode thay vì gọi process.exit(): node tự thoát khi mọi việc
// đã xong, nên output đang ghi dở không bị cắt.
process.exitCode = await run(process.argv.slice(2), {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
});
