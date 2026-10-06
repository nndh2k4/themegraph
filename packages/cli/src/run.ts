import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  analyze,
  cleanAllThemes,
  cleanTheme,
  context,
  deadCode,
  findRegisteredTheme,
  findThemeRoot,
  formatAnalyze,
  formatClean,
  formatContext,
  formatDeadCode,
  formatImpact,
  formatList,
  formatOverview,
  formatRenderFlow,
  formatSearch,
  formatStatus,
  formatVerify,
  impact,
  listThemes,
  NODE_KINDS,
  openGraph,
  overview,
  registryPath,
  renderFlow,
  search,
  themeStatus,
  verify,
  VERSION,
} from "@themegraph/core";
import type { FormatOptions, GraphHandle, NodeKind } from "@themegraph/core";

import { formatSetup, runClaudeCommand, setup } from "./setup.js";
import type { SetupOptions } from "./setup.js";

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
  themegraph list                  Các theme đã phân tích trên máy này
  themegraph status                Đồ thị của theme này có còn khớp với các file không
  themegraph overview              Theme này gồm những gì: số liệu, trang, file dùng nhiều
  themegraph clean                 Xoá dữ liệu ThemeGraph của theme này
                                   (--all: của mọi theme đã phân tích)

  themegraph search [từ-khoá]      Tìm file, trang, khoá dịch, setting theo tên
                                   (--kind <loại>: chỉ lấy một loại node, lặp lại được)
  themegraph impact <file>         Sửa file này thì file nào, trang nào bị ảnh hưởng
  themegraph render-flow <trang>   Trang này render những file nào, lồng nhau ra sao
                                   (--depth <n>: chỉ vẽ cây tới tầng n)
  themegraph context <file>        File này là gì, ai gọi nó, nó gọi ai
  themegraph dead-code             File nào không còn được dùng
  themegraph verify                Đối chiếu truy vấn SQL với phép duyệt bằng JavaScript

  themegraph setup                 Nối ThemeGraph vào Claude Code và Cursor: đăng ký MCP
                                   server, cài skill (--dry-run: chỉ xem; --remove: gỡ)
  themegraph mcp                   Chạy MCP server trên stdin/stdout (do AI agent gọi)

Trừ analyze, list, setup và mcp, mọi lệnh chạy trên theme chứa thư mục đang đứng.

Tuỳ chọn:
  -t, --theme <thư-mục>            Dùng theme ở thư mục này thay vì thư mục đang đứng
      --limit <n>                  Mỗi danh sách chỉ in n dòng đầu
      --json                       In kết quả dạng JSON
  -v, --version                    In phiên bản
  -h, --help                       In hướng dẫn này`;

/** Các tuỳ chọn mà mọi lệnh con cùng nhận. */
interface Flags {
  json: boolean;
  theme: string | undefined;
  all: boolean;
  limit: number | undefined;
  depth: number | undefined;
  kinds: NodeKind[];
  dryRun: boolean;
  remove: boolean;
}

/**
 * Những thứ test thay được khi gọi run(). Khi chạy thật không ai truyền gì.
 */
export interface RunOverrides {
  /**
   * Ghi đè một phần tuỳ chọn của lệnh setup. Test dùng nó để lệnh làm việc
   * trên một thư mục home giả và một lệnh `claude` giả, thay vì cấu hình thật
   * của người chạy test.
   */
  setup?: Partial<SetupOptions>;
}

/**
 * In kết quả của một lệnh: nguyên dạng JSON nếu có cờ --json, còn không thì
 * qua hàm trình bày của lệnh đó.
 */
function print<T>(result: T, format: (result: T, options: FormatOptions) => string[], flags: Flags, io: Io): void {
  if (flags.json) {
    io.stdout(JSON.stringify(result, null, 2));
    return;
  }
  // Không có --limit thì limit là undefined, tức in hết.
  const options: FormatOptions = flags.limit === undefined ? {} : { limit: flags.limit };
  for (const line of format(result, options)) io.stdout(line);
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

  const result = await analyze(themeRoot);
  print(result, formatAnalyze, flags, io);

  // Đồ thị đã ghi xong nên lệnh vẫn thành công; chỉ báo để người dùng biết vì
  // sao lệnh list không thấy theme này. In ra stderr để không lẫn vào --json.
  if (!result.registered) {
    io.stderr(`Cảnh báo: không ghi được theme vào sổ đăng ký ${registryPath()}.`);
  }
  return EXIT_OK;
}

/**
 * Theme mà một lệnh làm việc trên đó: cờ --theme, rồi tới theme chứa thư mục
 * đang đứng (tìm ngược lên thư mục cha, như git tìm .git).
 *
 * Không tìm thấy theme nào thì trả về chính thư mục đang đứng, để lõi tự báo
 * "chưa có đồ thị" kèm cách chữa.
 */
function themeRootOf(flags: Flags): string {
  return flags.theme ?? findThemeRoot(process.cwd()) ?? process.cwd();
}

/** Từ chối tham số thừa của một lệnh không nhận tham số nào. */
function rejectPositionals(command: string, positionals: string[], io: Io): number | null {
  return positionals.length > 0 ? usageError(`themegraph ${command} không nhận tham số nào.`, io) : null;
}

/** Lệnh list: đọc sổ đăng ký toàn cục, không cần đứng trong theme nào. */
function runList(positionals: string[], flags: Flags, io: Io): number {
  const rejected = rejectPositionals("list", positionals, io);
  if (rejected !== null) return rejected;

  print(listThemes(), formatList, flags, io);
  return EXIT_OK;
}

/** Lệnh status: đồ thị của theme đang đứng có còn khớp với đĩa không. */
async function runStatus(positionals: string[], flags: Flags, io: Io): Promise<number> {
  const rejected = rejectPositionals("status", positionals, io);
  if (rejected !== null) return rejected;

  print(await themeStatus(themeRootOf(flags)), formatStatus, flags, io);
  return EXIT_OK;
}

/** Lệnh clean: xoá dữ liệu của theme đang đứng, hoặc của mọi theme với --all. */
function runClean(positionals: string[], flags: Flags, io: Io): number {
  const rejected = rejectPositionals("clean", positionals, io);
  if (rejected !== null) return rejected;

  if (flags.all && flags.theme !== undefined) {
    return usageError("themegraph clean nhận --all hoặc --theme, không nhận cả hai.", io);
  }

  // Khác các lệnh khác ở một chỗ: khi graph.db của theme đã mất thì không còn
  // gì trên đĩa để nhận ra thư mục theme, nên clean hỏi thêm sổ đăng ký trước
  // khi chịu lấy thư mục đang đứng. Nhờ vậy đứng trong sections/ của một theme
  // đã mất graph.db vẫn gỡ được mục của nó khỏi sổ.
  const cwd = process.cwd();
  const themeRoot = flags.theme ?? findThemeRoot(cwd) ?? findRegisteredTheme(cwd) ?? cwd;

  const results = flags.all ? cleanAllThemes() : [cleanTheme(themeRoot)];

  print(results, formatClean, flags, io);
  return EXIT_OK;
}

/**
 * Mở đồ thị cho một lệnh truy vấn, chạy lệnh, rồi luôn đóng lại.
 *
 * Theme được chọn theo thứ tự: cờ --theme, rồi tới theme chứa thư mục đang
 * đứng (tìm ngược lên thư mục cha, như git tìm .git).
 */
function withGraph(flags: Flags, body: (graph: GraphHandle) => number): number {
  const graph = openGraph(themeRootOf(flags));
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
  format: (result: T, options: FormatOptions) => string[],
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
  format: (result: T, options: FormatOptions) => string[],
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

/**
 * Lệnh setup: nối ThemeGraph vào các AI agent có trên máy. Trả mã 1 nếu có
 * bước nào muốn ghi mà không ghi được.
 */
function runSetup(positionals: string[], flags: Flags, io: Io, overrides: RunOverrides): number {
  const rejected = rejectPositionals("setup", positionals, io);
  if (rejected !== null) return rejected;

  const options: SetupOptions = {
    homeDir: os.homedir(),
    nodePath: process.execPath,
    // File này sau khi build nằm ở dist/run.js, cạnh dist/cli.js; thư mục
    // skills/ nằm cạnh dist/ (và cạnh src/ khi chạy từ mã nguồn).
    cliPath: fileURLToPath(new URL("./cli.js", import.meta.url)),
    skillSource: fileURLToPath(new URL("../skills/themegraph/SKILL.md", import.meta.url)),
    dryRun: flags.dryRun,
    remove: flags.remove,
    runClaude: runClaudeCommand,
    ...overrides.setup,
  };

  const steps = setup(options);

  if (flags.json) io.stdout(JSON.stringify(steps, null, 2));
  else for (const line of formatSetup(steps, options)) io.stdout(line);

  return steps.some((step) => step.outcome === "failed") ? EXIT_FAILED : EXIT_OK;
}

/**
 * Lệnh mcp: chạy MCP server trên stdin/stdout cho tới khi client đóng stdin.
 *
 * Gói @themegraph/mcp (và bộ SDK nó kéo theo) chỉ được nạp ở đây, bằng
 * import() dạng hàm: các lệnh khác không phải trả giá khởi động của nó.
 *
 * Trong lệnh này TUYỆT ĐỐI không in gì ra io.stdout: stdout là đường truyền
 * của giao thức.
 */
async function runMcp(positionals: string[], flags: Flags, io: Io): Promise<number> {
  const rejected = rejectPositionals("mcp", positionals, io);
  if (rejected !== null) return rejected;

  const { runStdioServer } = await import("@themegraph/mcp");

  // --theme ở đây đổi "thư mục đang đứng" của server, tức theme mặc định khi
  // agent không nêu theme.
  await runStdioServer(flags.theme === undefined ? {} : { cwd: flags.theme });

  // Server đã sẵn sàng và đang nghe stdin; tiến trình tự thoát khi stdin đóng.
  return EXIT_OK;
}

/**
 * Lệnh search: tìm node theo tên. Từ khoá có thể gồm nhiều từ; không có từ
 * khoá thì liệt kê, thường đi kèm --kind.
 */
function runSearch(positionals: string[], flags: Flags, io: Io): number {
  return withGraph(flags, (graph) => {
    const result = search(graph, positionals.join(" "), {
      kinds: flags.kinds,
      // Ở lệnh này --limit là giới hạn của chính truy vấn, không phải của
      // phần trình bày: lõi cần nó để biết cắt sau khi đã xếp hạng.
      ...(flags.limit === undefined ? {} : { limit: flags.limit }),
    });
    print(result, formatSearch, flags, io);
    return EXIT_OK;
  });
}

/**
 * Đọc một cờ nhận số nguyên không âm. Trả về undefined khi cờ vắng mặt, và
 * null khi giá trị không hợp lệ.
 */
function parseCount(value: string | undefined, min: number): number | undefined | null {
  if (value === undefined) return undefined;
  // Chỉ nhận chuỗi toàn chữ số: Number() còn hiểu cả "1e3", " 5 " và "".
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= min ? parsed : null;
}

/** Chọn và chạy lệnh con. Lỗi ném ra từ lõi được bắt ở run(). */
async function dispatch(
  command: string,
  rest: string[],
  flags: Flags,
  io: Io,
  overrides: RunOverrides,
): Promise<number> {
  switch (command) {
    case "setup":
      return runSetup(rest, flags, io, overrides);
    case "mcp":
      return runMcp(rest, flags, io);
    case "analyze":
      return runAnalyze(rest, flags, io);
    case "list":
      return runList(rest, flags, io);
    case "status":
      return runStatus(rest, flags, io);
    case "clean":
      return runClean(rest, flags, io);
    case "impact":
      return runNamedQuery(command, "đường dẫn của một file", rest, flags, io, impact, formatImpact);
    case "search":
      return runSearch(rest, flags, io);
    case "render-flow":
      return runNamedQuery(
        command,
        "tên một loại trang",
        rest,
        flags,
        io,
        (graph, name, options) =>
          renderFlow(graph, name, flags.depth === undefined ? options : { ...options, maxDepth: flags.depth }),
        formatRenderFlow,
      );
    case "context":
      return runNamedQuery(command, "đường dẫn của một file", rest, flags, io, context, formatContext);
    case "overview":
      return runBareQuery(command, rest, flags, io, overview, formatOverview);
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
export async function run(argv: string[], io: Io, overrides: RunOverrides = {}): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        json: { type: "boolean" },
        theme: { type: "string", short: "t" },
        all: { type: "boolean" },
        limit: { type: "string" },
        depth: { type: "string" },
        kind: { type: "string", multiple: true },
        "dry-run": { type: "boolean" },
        remove: { type: "boolean" },
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

  const limit = parseCount(parsed.values.limit, 0);
  if (limit === null) return usageError("--limit cần một số nguyên từ 0 trở lên.", io);

  const depth = parseCount(parsed.values.depth, 1);
  if (depth === null) return usageError("--depth cần một số nguyên từ 1 trở lên.", io);

  const kinds = parsed.values.kind ?? [];
  const known: readonly string[] = NODE_KINDS;
  const unknownKind = kinds.find((kind) => !known.includes(kind));
  if (unknownKind !== undefined) {
    return usageError(`Không có loại node "${unknownKind}". Các loại: ${NODE_KINDS.join(", ")}.`, io);
  }

  const flags: Flags = {
    json: parsed.values.json ?? false,
    theme: parsed.values.theme,
    all: parsed.values.all ?? false,
    limit,
    depth,
    kinds: kinds as NodeKind[],
    dryRun: parsed.values["dry-run"] ?? false,
    remove: parsed.values.remove ?? false,
  };

  try {
    return await dispatch(command, rest, flags, io, overrides);
  } catch (error) {
    // Mọi lỗi của lõi đi qua đây: thư mục không phải theme, theme chưa được
    // analyze, tên file không có trong đồ thị... Thông báo của chúng đã viết
    // cho người đọc, nên chỉ việc in ra.
    io.stderr(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }
}
