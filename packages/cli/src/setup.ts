import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Lệnh `themegraph setup`: nối ThemeGraph vào các AI agent có trên máy.
 *
 * Việc phải làm cho từng client:
 *   - Claude Code: đăng ký MCP server ở mức người dùng, bằng chính lệnh
 *     `claude mcp add`; và chép skill vào ~/.claude/skills/themegraph/.
 *   - Cursor: thêm mục "themegraph" vào ~/.cursor/mcp.json.
 *
 * File này không thuộc lõi vì nó không biết gì về theme hay đồ thị: nó chỉ
 * ghi cấu hình của chương trình KHÁC. Mọi thứ nó chạm tới bên ngoài (thư mục
 * home, lệnh claude) đi qua SetupOptions, để test chạy trên một thư mục home
 * giả mà không bao giờ đụng cấu hình thật của người chạy test.
 */

/** Tên của MCP server trong cấu hình của các client. */
export const SERVER_NAME = "themegraph";

/** Kết quả của một lần gọi lệnh `claude`. */
export interface ClaudeRun {
  ok: boolean; // lệnh thoát với mã 0
  output: string; // stdout và stderr gộp lại
}

export interface SetupOptions {
  homeDir: string; // thư mục home của người dùng
  nodePath: string; // đường dẫn tuyệt đối của node đang chạy
  cliPath: string; // đường dẫn tuyệt đối của file cli.js đã build
  skillSource: string; // đường dẫn của file SKILL.md đi kèm gói
  dryRun: boolean; // chỉ báo việc sẽ làm, không ghi gì
  remove: boolean; // gỡ thay vì cài
  /**
   * Chạy lệnh `claude` với các tham số cho trước. Trả null khi máy không có
   * lệnh đó, tức không cài Claude Code.
   */
  runClaude: (args: string[]) => ClaudeRun | null;
}

/** Điều đã xảy ra ở một bước. */
export type SetupOutcome =
  | "done" // đã ghi (hoặc đã gỡ)
  | "unchanged" // cấu hình đã đúng sẵn, không ghi gì
  | "planned" // --dry-run: sẽ ghi nếu chạy thật
  | "skipped" // client không có trên máy
  | "failed"; // muốn ghi nhưng không ghi được

export interface SetupStep {
  target: string; // "Claude Code", "Skill cho Claude Code", "Cursor"
  outcome: SetupOutcome;
  detail: string; // một câu cho người đọc: đã làm gì, ở đâu, hoặc vì sao không
}

/** Cấu hình MCP dạng JSON mà Cursor (và nhiều client khác) dùng. */
function serverEntry(options: SetupOptions): { command: string; args: string[] } {
  // Ghi đường dẫn tuyệt đối của node và của cli.js thay cho lệnh "themegraph":
  // client mở server bằng cách chạy thẳng một file thực thi, không qua shell.
  // Trên Windows "themegraph" là một file .cmd, thứ không chạy thẳng được như
  // vậy; và trên mọi hệ, PATH của client chưa chắc giống PATH của terminal.
  return { command: options.nodePath, args: [options.cliPath, "mcp"] };
}

/** Lệnh người dùng tự gõ được khi setup không tự chạy được `claude`. */
export function manualClaudeCommand(options: SetupOptions): string {
  const quote = (value: string): string => `"${value}"`;
  return `claude mcp add --scope user ${SERVER_NAME} -- ${quote(options.nodePath)} ${quote(options.cliPath)} mcp`;
}

// ---- Claude Code: MCP server ------------------------------------------------------

function setupClaudeServer(options: SetupOptions): SetupStep {
  const target = "Claude Code";

  const version = options.runClaude(["--version"]);
  if (version === null || !version.ok) {
    return { target, outcome: "skipped", detail: "không tìm thấy lệnh claude trên máy này." };
  }

  // `claude mcp get` thoát với mã khác 0 khi chưa có server tên đó.
  const current = options.runClaude(["mcp", "get", SERVER_NAME]);
  const exists = current !== null && current.ok;

  if (options.remove) {
    if (!exists) return { target, outcome: "unchanged", detail: `chưa có MCP server "${SERVER_NAME}" để gỡ.` };
    if (options.dryRun) return { target, outcome: "planned", detail: `sẽ gỡ MCP server "${SERVER_NAME}".` };

    const removed = options.runClaude(["mcp", "remove", SERVER_NAME, "--scope", "user"]);
    return removed !== null && removed.ok
      ? { target, outcome: "done", detail: `đã gỡ MCP server "${SERVER_NAME}".` }
      : { target, outcome: "failed", detail: `không gỡ được MCP server: ${(removed?.output ?? "").trim()}` };
  }

  // Đã có server và nó trỏ đúng tới bản cli.js này thì không cần làm gì.
  // (`claude mcp get` in ra các tham số của server, trong đó có đường dẫn này.)
  if (exists && current.output.includes(options.cliPath) && current.output.includes(options.nodePath)) {
    return { target, outcome: "unchanged", detail: `MCP server "${SERVER_NAME}" đã được đăng ký.` };
  }

  if (options.dryRun) {
    return { target, outcome: "planned", detail: `sẽ chạy: ${manualClaudeCommand(options)}` };
  }

  // Có sẵn nhưng trỏ tới chỗ khác (ví dụ một bản cài cũ): `claude mcp add` từ
  // chối ghi đè, nên phải gỡ trước.
  if (exists) options.runClaude(["mcp", "remove", SERVER_NAME, "--scope", "user"]);

  const { command, args } = serverEntry(options);
  const added = options.runClaude(["mcp", "add", "--scope", "user", SERVER_NAME, "--", command, ...args]);

  return added !== null && added.ok
    ? { target, outcome: "done", detail: `đã đăng ký MCP server "${SERVER_NAME}" ở mức người dùng.` }
    : {
        target,
        outcome: "failed",
        detail: `không đăng ký được (${(added?.output ?? "").trim()}). Tự chạy: ${manualClaudeCommand(options)}`,
      };
}

// ---- Claude Code: skill -----------------------------------------------------------

function setupSkill(options: SetupOptions): SetupStep {
  const target = "Skill cho Claude Code";
  const claudeDir = path.join(options.homeDir, ".claude");
  const skillDir = path.join(claudeDir, "skills", SERVER_NAME);
  const skillFile = path.join(skillDir, "SKILL.md");

  // Thư mục ~/.claude do Claude Code tạo ở lần chạy đầu; không có nó thì coi
  // như máy không dùng Claude Code, và không tự tạo ra.
  if (!existsSync(claudeDir)) {
    return { target, outcome: "skipped", detail: `không có thư mục ${claudeDir}.` };
  }

  if (options.remove) {
    if (!existsSync(skillFile)) return { target, outcome: "unchanged", detail: "chưa có skill để gỡ." };
    if (options.dryRun) return { target, outcome: "planned", detail: `sẽ xoá ${skillFile}.` };

    rmSync(skillFile);
    // Chỉ xoá thư mục khi nó đã rỗng: người dùng có thể để file riêng ở đó.
    if (readdirSync(skillDir).length === 0) rmdirSync(skillDir);
    return { target, outcome: "done", detail: `đã xoá ${skillFile}.` };
  }

  const wanted = readFileSync(options.skillSource, "utf8");
  const current = existsSync(skillFile) ? readFileSync(skillFile, "utf8") : null;

  if (current === wanted) return { target, outcome: "unchanged", detail: `${skillFile} đã là bản mới nhất.` };
  if (options.dryRun) return { target, outcome: "planned", detail: `sẽ ghi ${skillFile}.` };

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillFile, wanted);
  return { target, outcome: "done", detail: `đã ghi ${skillFile}.` };
}

// ---- Cursor -----------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setupCursor(options: SetupOptions): SetupStep {
  const target = "Cursor";
  const cursorDir = path.join(options.homeDir, ".cursor");
  const configFile = path.join(cursorDir, "mcp.json");

  if (!existsSync(cursorDir)) {
    return { target, outcome: "skipped", detail: `không có thư mục ${cursorDir}.` };
  }

  // Đọc cấu hình hiện có. File này là của người dùng và thường chứa server
  // khác: chỉ được thêm bớt đúng một mục, và nếu không hiểu nội dung của nó
  // thì dừng lại thay vì ghi đè.
  let config: Record<string, unknown> = {};
  if (existsSync(configFile)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(configFile, "utf8"));
    } catch {
      return { target, outcome: "failed", detail: `${configFile} không phải JSON hợp lệ; không sửa file này.` };
    }
    if (!isObject(parsed) || (parsed.mcpServers !== undefined && !isObject(parsed.mcpServers))) {
      return { target, outcome: "failed", detail: `${configFile} có dạng lạ; không sửa file này.` };
    }
    config = parsed;
  }

  const servers: Record<string, unknown> = isObject(config.mcpServers) ? { ...config.mcpServers } : {};
  const write = (): void => {
    writeFileSync(configFile, `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`);
  };

  if (options.remove) {
    if (!(SERVER_NAME in servers)) {
      return { target, outcome: "unchanged", detail: `chưa có mục "${SERVER_NAME}" trong ${configFile}.` };
    }
    if (options.dryRun) return { target, outcome: "planned", detail: `sẽ gỡ mục "${SERVER_NAME}" khỏi ${configFile}.` };

    delete servers[SERVER_NAME];
    write();
    return { target, outcome: "done", detail: `đã gỡ mục "${SERVER_NAME}" khỏi ${configFile}.` };
  }

  const wanted = serverEntry(options);

  if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(wanted)) {
    return { target, outcome: "unchanged", detail: `mục "${SERVER_NAME}" trong ${configFile} đã đúng.` };
  }
  if (options.dryRun) return { target, outcome: "planned", detail: `sẽ ghi mục "${SERVER_NAME}" vào ${configFile}.` };

  servers[SERVER_NAME] = wanted;
  write();
  return { target, outcome: "done", detail: `đã ghi mục "${SERVER_NAME}" vào ${configFile}.` };
}

// ---- điểm vào ---------------------------------------------------------------------

/**
 * Cài (hoặc gỡ) phần tích hợp cho mọi client tìm thấy trên máy. Mỗi bước độc
 * lập với các bước khác: một bước lỗi không cản bước sau. Chạy lại nhiều lần
 * cho cùng một kết quả.
 */
export function setup(options: SetupOptions): SetupStep[] {
  const steps = [setupClaudeServer, setupSkill, setupCursor];

  return steps.map((step) => {
    try {
      return step(options);
    } catch (error) {
      // Lỗi hệ thống file (không có quyền ghi, đĩa đầy...) của một bước.
      return {
        target: step === setupClaudeServer ? "Claude Code" : step === setupSkill ? "Skill cho Claude Code" : "Cursor",
        outcome: "failed" as const,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/**
 * Cách chạy lệnh `claude` thật.
 *
 * Claude Code cài bằng bộ cài riêng là một file .exe (hoặc file thực thi trên
 * macOS/Linux) và chạy thẳng được. Cài qua npm trên Windows thì nó là
 * claude.cmd, thứ Node không chạy thẳng: khi lần đầu báo không tìm thấy, thử
 * lại qua shell với từng tham số được đặt trong dấu nháy kép.
 */
export function runClaudeCommand(args: string[]): ClaudeRun | null {
  const collect = (result: ReturnType<typeof spawnSync>): ClaudeRun => ({
    ok: result.status === 0,
    output: `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`,
  });

  const direct = spawnSync("claude", args, { encoding: "utf8", windowsHide: true });
  if (direct.error === undefined) return collect(direct);

  if (process.platform !== "win32") return null;

  const quoted = args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`).join(" ");
  const viaShell = spawnSync(`claude ${quoted}`, { encoding: "utf8", shell: true, windowsHide: true });

  // Qua shell, "không có lệnh" không còn là lỗi spawn mà là mã thoát của
  // cmd.exe kèm thông báo "is not recognized".
  if (viaShell.error !== undefined) return null;
  const result = collect(viaShell);
  return !result.ok && /is not recognized|not found/i.test(result.output) ? null : result;
}

/** Các dòng báo cáo của lệnh setup, cho người đọc. */
export function formatSetup(steps: readonly SetupStep[], options: Pick<SetupOptions, "dryRun" | "remove">): string[] {
  const labels: Record<SetupOutcome, string> = {
    done: "xong",
    unchanged: "giữ nguyên",
    planned: "sẽ làm",
    skipped: "bỏ qua",
    failed: "LỖI",
  };

  const width = Math.max(...steps.map((step) => step.target.length));
  const lines = steps.map(
    (step) => `  ${step.target.padEnd(width)}  ${labels[step.outcome].padEnd(10)}  ${step.detail}`,
  );

  const title = options.remove ? "Gỡ ThemeGraph khỏi các AI agent" : "Nối ThemeGraph vào các AI agent";
  const result = [`${title}${options.dryRun ? " (chạy thử, không ghi gì)" : ""}:`, ...lines];

  if (steps.every((step) => step.outcome === "skipped")) {
    result.push("", "Không tìm thấy Claude Code hay Cursor trên máy này.");
  } else if (!options.remove && !options.dryRun && steps.some((step) => step.outcome === "done")) {
    result.push("", "Khởi động lại Claude Code / Cursor để nhận cấu hình mới.");
  }
  return result;
}
