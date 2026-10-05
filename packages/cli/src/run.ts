import { parseArgs } from "node:util";

import {
  analyze,
  context,
  deadCode,
  findThemeRoot,
  impact,
  openGraph,
  renderFlow,
  verify,
  VERSION,
} from "@themegraph/core";
import type { GraphHandle } from "@themegraph/core";

import {
  formatAnalyze,
  formatContext,
  formatDeadCode,
  formatImpact,
  formatRenderFlow,
  formatVerify,
} from "./format.js";

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

  themegraph impact <file>         Sửa file này thì file nào, trang nào bị ảnh hưởng
  themegraph render-flow <trang>   Trang này render những file nào, lồng nhau ra sao
  themegraph context <file>        File này là gì, ai gọi nó, nó gọi ai
  themegraph dead-code             File nào không còn được dùng
  themegraph verify                Đối chiếu truy vấn SQL với phép duyệt bằng JavaScript

Các lệnh truy vấn chạy trên theme chứa thư mục đang đứng, đã được analyze.

Tuỳ chọn:
  -t, --theme <thư-mục>            Truy vấn theme ở thư mục này thay vì thư mục đang đứng
      --json                       In kết quả dạng JSON
  -v, --version                    In phiên bản
  -h, --help                       In hướng dẫn này`;

/** Các tuỳ chọn mà mọi lệnh con cùng nhận. */
interface Flags {
  json: boolean;
  theme: string | undefined;
}

/**
 * In kết quả của một lệnh: nguyên dạng JSON nếu có cờ --json, còn không thì
 * qua hàm trình bày của lệnh đó.
 */
function print<T>(result: T, format: (result: T) => string[], flags: Flags, io: Io): void {
  if (flags.json) {
    io.stdout(JSON.stringify(result, null, 2));
    return;
  }
  for (const line of format(result)) io.stdout(line);
}

/** Báo sai cú pháp và trả mã thoát tương ứng. */
function usageError(message: string, io: Io): number {
  io.stderr(message);
  io.stderr('Gõ "themegraph --help" để xem cách dùng.');
  return EXIT_USAGE;
}

/** Lệnh con analyze: chỉ đọc tham số, gọi lõi, rồi in kết quả. */
async function runAnalyze(positionals: string[], flags: Flags, io: Io): Promise<number> {
  if (positionals.length > 1) {
    return usageError("themegraph analyze chỉ nhận một đường dẫn.", io);
  }

  // Không có đường dẫn thì lấy thư mục đang đứng. Việc đổi "." thành đường dẫn
  // tuyệt đối là của lõi; ở đây không tự xử lý đường dẫn.
  const themeRoot = positionals[0] ?? flags.theme ?? ".";

  print(await analyze(themeRoot), formatAnalyze, flags, io);
  return EXIT_OK;
}

/**
 * Mở đồ thị cho một lệnh truy vấn, chạy lệnh, rồi luôn đóng lại.
 *
 * Theme được chọn theo thứ tự: cờ --theme, rồi tới theme chứa thư mục đang
 * đứng (tìm ngược lên thư mục cha, như git tìm .git).
 */
function withGraph(flags: Flags, body: (graph: GraphHandle) => number): number {
  // Không tìm thấy theme nào thì vẫn đưa thư mục đang đứng cho openGraph, để
  // nó ném lỗi "chưa có đồ thị" kèm cách chữa.
  const themeRoot = flags.theme ?? findThemeRoot(process.cwd()) ?? process.cwd();

  const graph = openGraph(themeRoot);
  try {
    return body(graph);
  } finally {
    graph.close();
  }
}

/**
 * Chạy một lệnh truy vấn nhận đúng một tên (file hoặc trang).
 *
 * `baseDir` là thư mục đang đứng: người đang ở trong snippets/ gõ được
 * "card.liquid" thay vì "snippets/card.liquid".
 */
function runNamedQuery<T>(
  command: string,
  what: string,
  positionals: string[],
  flags: Flags,
  io: Io,
  query: (graph: GraphHandle, name: string, options: { baseDir: string }) => T,
  format: (result: T) => string[],
): number {
  const [name, ...extra] = positionals;

  if (name === undefined || extra.length > 0) {
    return usageError(`themegraph ${command} cần đúng một tham số: ${what}.`, io);
  }

  return withGraph(flags, (graph) => {
    print(query(graph, name, { baseDir: process.cwd() }), format, flags, io);
    return EXIT_OK;
  });
}

/** Chạy một lệnh truy vấn không nhận tham số nào. */
function runBareQuery<T>(
  command: string,
  positionals: string[],
  flags: Flags,
  io: Io,
  query: (graph: GraphHandle) => T,
  format: (result: T) => string[],
  exitCodeOf: (result: T) => number = () => EXIT_OK,
): number {
  if (positionals.length > 0) {
    return usageError(`themegraph ${command} không nhận tham số nào.`, io);
  }

  return withGraph(flags, (graph) => {
    const result = query(graph);
    print(result, format, flags, io);
    return exitCodeOf(result);
  });
}

/** Chọn và chạy lệnh con. Lỗi ném ra từ lõi được bắt ở run(). */
async function dispatch(command: string, rest: string[], flags: Flags, io: Io): Promise<number> {
  switch (command) {
    case "analyze":
      return runAnalyze(rest, flags, io);
    case "impact":
      return runNamedQuery(command, "đường dẫn của một file", rest, flags, io, impact, formatImpact);
    case "render-flow":
      return runNamedQuery(command, "tên một loại trang", rest, flags, io, renderFlow, formatRenderFlow);
    case "context":
      return runNamedQuery(command, "đường dẫn của một file", rest, flags, io, context, formatContext);
    case "dead-code":
      return runBareQuery(command, rest, flags, io, deadCode, formatDeadCode);
    case "verify":
      // verify là một phép kiểm tra: không đạt thì lệnh phải thất bại, để dùng
      // được trong script và CI.
      return runBareQuery(command, rest, flags, io, verify, formatVerify, (result) =>
        result.ok ? EXIT_OK : EXIT_FAILED,
      );
    default:
      return usageError(`Không có lệnh "${command}".`, io);
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
        json: { type: "boolean" },
        theme: { type: "string", short: "t" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    // parseArgs ném lỗi khi gặp cờ không khai báo, ví dụ --abc.
    return usageError(`Lỗi: ${error instanceof Error ? error.message : String(error)}`, io);
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

  const flags: Flags = { json: parsed.values.json ?? false, theme: parsed.values.theme };

  try {
    return await dispatch(command, rest, flags, io);
  } catch (error) {
    // Mọi lỗi của lõi đi qua đây: thư mục không phải theme, theme chưa được
    // analyze, tên file không có trong đồ thị... Thông báo của chúng đã viết
    // cho người đọc, nên chỉ việc in ra.
    io.stderr(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }
}
