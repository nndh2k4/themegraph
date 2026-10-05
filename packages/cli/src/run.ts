import { parseArgs } from "node:util";

import { analyze, VERSION } from "@themegraph/core";
import type { AnalyzeResult } from "@themegraph/core";

/**
 * Nơi lệnh in kết quả ra. Tách thành tham số để test gom được output mà không
 * phải chặn process.stdout; khi chạy thật, cli.ts nối chúng vào console.
 */
export interface Io {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** Mã thoát của lệnh, theo thông lệ của các công cụ dòng lệnh. */
const EXIT_OK = 0;
const EXIT_FAILED = 1; // lệnh hợp lệ nhưng chạy không thành công
const EXIT_USAGE = 2; // gõ sai cú pháp

const HELP = `ThemeGraph ${VERSION} — đồ thị tri thức cho Shopify Liquid theme

Cách dùng:
  themegraph analyze [đường-dẫn]   Phân tích một theme và ghi .themegraph/graph.db
                                   (không có đường dẫn: dùng thư mục đang đứng)
  themegraph --version             In phiên bản
  themegraph --help                In hướng dẫn này`;

/** Ghép một bảng đếm thành chuỗi "RENDERS 9, USES_ASSET 1". */
function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([name, count]) => `${name} ${count}`)
    .join(", ");
}

/** In kết quả của một lần phân tích ở dạng người đọc được. */
function printAnalyzeResult(result: AnalyzeResult, io: Io): void {
  const { stats } = result;

  io.stdout(`ThemeGraph ${VERSION} — đã phân tích ${result.themeRoot}`);
  io.stdout("");
  io.stdout(`  File        ${stats.files}`);
  io.stdout(`  Node        ${stats.nodes}  (${formatCounts(stats.nodesByKind)})`);
  io.stdout(`  Cạnh        ${stats.edges}  (${formatCounts(stats.edgesByType)})`);
  io.stdout(`  Tham chiếu  ${stats.refs}  (${formatCounts(stats.refsByStatus)})`);

  if (result.missing.length > 0) {
    io.stdout("");
    io.stdout(`Tham chiếu hỏng (${result.missing.length}):`);
    for (const ref of result.missing) {
      // Ref lấy từ file JSON có line 0, tức không có số dòng để in.
      const where = ref.line > 0 ? `${ref.from}:${ref.line}` : ref.from;
      io.stdout(`  ${where}  ${ref.kind} -> ${ref.target ?? ref.to}`);
    }
  }

  if (result.errors.length > 0) {
    io.stdout("");
    io.stdout(`File lỗi (${result.errors.length}):`);
    for (const error of result.errors) {
      io.stdout(`  ${error.path}  ${error.message}`);
    }
  }

  io.stdout("");
  io.stdout(`Đã ghi ${result.dbPath} (${result.durationMs} ms)`);
}

/** Lệnh con analyze: chỉ đọc tham số, gọi lõi, rồi in kết quả. */
async function runAnalyze(positionals: string[], io: Io): Promise<number> {
  if (positionals.length > 1) {
    io.stderr("themegraph analyze chỉ nhận một đường dẫn.");
    io.stderr('Gõ "themegraph --help" để xem cách dùng.');
    return EXIT_USAGE;
  }

  // Không có đường dẫn thì lấy thư mục đang đứng. Việc đổi "." thành đường dẫn
  // tuyệt đối là của lõi; ở đây không tự xử lý đường dẫn.
  const themeRoot = positionals[0] ?? ".";

  try {
    printAnalyzeResult(await analyze(themeRoot), io);
    return EXIT_OK;
  } catch (error) {
    io.stderr(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }
}

/**
 * Chạy lệnh themegraph với danh sách tham số (không gồm "node" và tên file).
 * Trả về mã thoát thay vì tự gọi process.exit, để test gọi được nhiều lần.
 *
 * Lớp này cố ý mỏng: không đọc file theme, không biết gì về Liquid hay SQLite.
 */
export async function run(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    // parseArgs ném lỗi khi gặp cờ không khai báo, ví dụ --abc.
    io.stderr(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    io.stderr('Gõ "themegraph --help" để xem cách dùng.');
    return EXIT_USAGE;
  }

  if (parsed.values.version) {
    io.stdout(VERSION);
    return EXIT_OK;
  }

  const [command, ...rest] = parsed.positionals;

  if (parsed.values.help || command === undefined) {
    io.stdout(HELP);
    return EXIT_OK;
  }

  if (command === "analyze") {
    return runAnalyze(rest, io);
  }

  io.stderr(`Không có lệnh "${command}".`);
  io.stderr('Gõ "themegraph --help" để xem cách dùng.');
  return EXIT_USAGE;
}
