#!/usr/bin/env node
// Điểm vào của lệnh `themegraph`. File này chỉ nối lệnh với thế giới thật:
// tham số dòng lệnh, console, và mã thoát của tiến trình. Mọi việc còn lại
// nằm trong run.ts để test được mà không cần mở tiến trình mới.

// Trên Node 22, nạp node:sqlite làm Node in ra stderr dòng
//   "ExperimentalWarning: SQLite is an experimental feature..."
// ở MỌI lần chạy lệnh. Với người dùng đó là nhiễu, và với chương trình đọc
// output của lệnh (agent, script) đó là dữ liệu lạ. Chặn đúng một cảnh báo
// này; mọi cảnh báo khác của Node vẫn được in như thường.
const emitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (text.includes("SQLite is an experimental feature")) return;

  (emitWarning as (warning: string | Error, ...rest: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

// Phải nạp run.js SAU khi đã chặn cảnh báo, vì chính việc nạp nó kéo theo
// node:sqlite. Lệnh `import ... from` ở đầu file luôn chạy trước mọi dòng mã
// khác, nên ở đây dùng import() dạng hàm.
const { run } = await import("./run.js");

// Gán process.exitCode thay vì gọi process.exit(): node tự thoát khi mọi việc
// đã xong, nên output đang ghi dở không bị cắt.
process.exitCode = await run(process.argv.slice(2), {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
});
