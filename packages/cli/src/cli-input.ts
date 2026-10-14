import { parseArgs } from "node:util";

import { NODE_KINDS } from "@themegraph/core";
import type { NodeKind, ThemeService } from "@themegraph/core";
import type { TextView, ViewOptions } from "@themegraph/views";

import type { Io } from "./cli.types.js";
import { UsageError } from "./usage.error.js";

/** Các tuỳ chọn mà mọi lệnh con cùng nhận. */
export interface Flags {
  json: boolean;
  theme: string | undefined;
  all: boolean;
  limit: number | undefined;
  depth: number | undefined;
  kinds: NodeKind[];
  dryRun: boolean;
  remove: boolean;
  port: number | undefined;
}

/** Kết quả của việc đọc tham số dòng lệnh, trước khi chọn lệnh con. */
export type ParsedArgs =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "command"; input: CliInput };

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

/**
 * Đọc và kiểm tra tham số dòng lệnh (giống DTO + ValidationPipe của NestJS).
 * Ném UsageError khi gặp cờ lạ hoặc giá trị không hợp lệ.
 */
export function parseCliArgs(argv: string[]): ParsedArgs {
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
        port: { type: "string" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    // parseArgs ném lỗi khi gặp cờ không khai báo, ví dụ --abc.
    throw new UsageError(`Lỗi: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (parsed.values.version) return { kind: "version" };

  const [command, ...rest] = parsed.positionals;
  if (parsed.values.help || command === undefined) return { kind: "help" };

  const limit = parseCount(parsed.values.limit, 0);
  if (limit === null) throw new UsageError("--limit cần một số nguyên từ 0 trở lên.");

  const depth = parseCount(parsed.values.depth, 1);
  if (depth === null) throw new UsageError("--depth cần một số nguyên từ 1 trở lên.");

  const port = parseCount(parsed.values.port, 0);
  if (port === null || (port !== undefined && port > 65535)) {
    throw new UsageError("--port cần một số nguyên từ 0 tới 65535.");
  }

  const kinds = parsed.values.kind ?? [];
  const known: readonly string[] = NODE_KINDS;
  const unknownKind = kinds.find((kind) => !known.includes(kind));
  if (unknownKind !== undefined) {
    throw new UsageError(`Không có loại node "${unknownKind}". Các loại: ${NODE_KINDS.join(", ")}.`);
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
    port,
  };

  return { kind: "command", input: new CliInput(command, rest, flags) };
}

/**
 * Tham số của MỘT lệnh con đã được kiểm tra: tên lệnh, các tham số vị trí còn
 * lại, và các cờ. Kèm vài hàm mà controller nào cũng cần.
 */
export class CliInput {
  constructor(
    readonly command: string,
    readonly positionals: readonly string[],
    readonly flags: Flags,
  ) {}

  /** Thư mục đang đứng, đọc ở lúc hỏi chứ không ở lúc tạo. */
  get cwd(): string {
    return process.cwd();
  }

  /** Từ chối tham số thừa của một lệnh không nhận tham số nào. */
  rejectArgs(): void {
    if (this.positionals.length > 0) throw new UsageError(`themegraph ${this.command} không nhận tham số nào.`);
  }

  /** Lệnh cần đúng một tham số (`what` là tên của nó, để báo lỗi). */
  requireOne(what: string): string {
    const [name, ...extra] = this.positionals;
    if (name === undefined || extra.length > 0) {
      throw new UsageError(`themegraph ${this.command} cần đúng một tham số: ${what}.`);
    }
    return name;
  }

  /**
   * Theme mà một lệnh làm việc trên đó: cờ --theme, rồi tới theme chứa thư mục
   * đang đứng (tìm ngược lên thư mục cha, như git tìm .git).
   *
   * Không tìm thấy theme nào thì trả về chính thư mục đang đứng, để lõi tự báo
   * "chưa có đồ thị" kèm cách chữa.
   */
  themeRoot(themes: ThemeService): string {
    return this.flags.theme ?? themes.locate(this.cwd) ?? this.cwd;
  }

  /**
   * In kết quả của một lệnh: nguyên dạng JSON nếu có cờ --json, còn không thì
   * qua view của lệnh đó.
   */
  print<T>(result: T, view: TextView<T>, io: Io): void {
    if (this.flags.json) {
      io.stdout(JSON.stringify(result, null, 2));
      return;
    }
    // Không có --limit thì limit là undefined, tức in hết.
    const options: ViewOptions = this.flags.limit === undefined ? {} : { limit: this.flags.limit };
    for (const line of view.render(result, options)) io.stdout(line);
  }
}
