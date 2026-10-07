// Kiểm một bản ThemeGraph ĐÃ CÀI, như một người dùng sẽ dùng nó: chạy lệnh
// `themegraph` thật trên một theme thật và đi qua đủ ba lớp vỏ (dòng lệnh,
// MCP server, giao diện web).
//
// Script này không dùng gì của repo ngoài chính nó: không import gói nào, không
// cần pnpm. Nó dành cho hai việc:
//   - sau khi `npm install -g themegraph-<phiên bản>.tgz` trên một máy sạch
//     (job "install" của CI chạy nó trên Ubuntu, Windows và macOS);
//   - thử gói vừa đóng ở máy phát triển trước khi phát hành.
//
// Dùng:
//   node tools/release/smoke.mjs --theme <thư mục theme> [tuỳ chọn]
//
//   --bin <lệnh>            lệnh themegraph cần thử (mặc định: "themegraph" trên PATH)
//   --package-dir <thư mục> nơi gói được cài (mặc định: <npm root -g>/themegraph)
//   --file <file>           một file chắc chắn được trang nào đó dùng
//                           (mặc định: snippets/card-product.liquid)
//   --page <trang>          một loại trang có trong theme (mặc định: product)
//   --expect-version <v>    phiên bản phải được in ra
//   --expect-nodes <n>      số node phải ra đúng bằng n (dùng khi theme ghim ở một commit)
//   --expect-edges <n>      số cạnh phải ra đúng bằng n
//
// Mã thoát 0 khi mọi bước đạt, 1 khi có bước hỏng.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
  options: {
    bin: { type: "string", default: "themegraph" },
    "package-dir": { type: "string" },
    theme: { type: "string" },
    file: { type: "string", default: "snippets/card-product.liquid" },
    page: { type: "string", default: "product" },
    "expect-version": { type: "string" },
    "expect-nodes": { type: "string" },
    "expect-edges": { type: "string" },
  },
});

if (options.theme === undefined) {
  console.error("Thiếu --theme <thư mục theme>.");
  process.exit(2);
}
const theme = path.resolve(options.theme);

// Thư mục home giả: sổ đăng ký của ThemeGraph và cấu hình của các AI agent
// đều nằm trong đó, nên script không đọc hay ghi gì vào tài khoản thật.
const home = mkdtempSync(path.join(os.tmpdir(), "themegraph-smoke-"));
mkdirSync(path.join(home, ".claude"));
mkdirSync(path.join(home, ".cursor"));
const env = { ...process.env, THEMEGRAPH_HOME: path.join(home, ".themegraph"), HOME: home, USERPROFILE: home };

const quote = (text) => (/[\s"&|<>^]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text);

/** Chạy lệnh themegraph qua shell, đúng như người dùng gõ. */
function themegraph(...args) {
  const result = spawnSync([quote(options.bin), ...args.map(quote)].join(" "), { shell: true, env, encoding: "utf8", cwd: home });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Chạy lệnh với --json và đọc kết quả; ném lỗi nếu lệnh hỏng. */
function json(...args) {
  const result = themegraph(...args, "--json");
  if (result.code !== 0) throw new Error(`mã thoát ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`);
  return JSON.parse(result.stdout);
}

const results = [];
/** Chạy một bước. `run` trả về một dòng mô tả điều đã thấy, hoặc ném lỗi. */
async function step(name, run) {
  try {
    const detail = await run();
    results.push(true);
    console.log(`ĐẠT   ${name}${detail ? `  (${detail})` : ""}`);
  } catch (error) {
    results.push(false);
    console.log(`HỎNG  ${name}  (${error instanceof Error ? error.message : String(error)})`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// Nơi gói được cài. Hai lệnh chạy lâu (serve, mcp) được mở bằng `node cli.js`
// thay vì qua shell, để script dừng được đúng tiến trình đó.
const packageDir = path.resolve(
  options["package-dir"] ?? path.join(spawnSync("npm root -g", { shell: true, encoding: "utf8" }).stdout.trim(), "themegraph"),
);
const cliJs = path.join(packageDir, "dist", "cli.js");

console.log(`Thử lệnh "${options.bin}" (gói ở ${packageDir}) trên theme ${theme}`);
console.log(`Node ${process.version}, ${process.platform} ${process.arch}\n`);

// ---- gói ----
await step("Gói tự chứa: có giao diện, có skill, có giấy phép bên thứ ba, không kéo thêm phụ thuộc", () => {
  for (const file of ["dist/cli.js", "web/index.html", "skills/themegraph/SKILL.md", "THIRD-PARTY-LICENSES.txt", "package.json"]) {
    expect(existsSync(path.join(packageDir, file)), `gói thiếu ${file}`);
  }
  expect(!existsSync(path.join(packageDir, "node_modules")), "gói có thư mục node_modules, tức còn phụ thuộc phải tải");
  const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  const dependencies = Object.keys(manifest.dependencies ?? {});
  expect(dependencies.length === 0, `package.json còn dependencies: ${dependencies.join(", ")}`);
  return `phiên bản ${manifest.version}`;
});

// ---- dòng lệnh ----
await step("--version in đúng một dòng phiên bản, stderr sạch", () => {
  const result = themegraph("--version");
  expect(result.code === 0, `mã thoát ${result.code}: ${result.stderr.trim()}`);
  expect(/^\d+\.\d+\.\d+/.test(result.stdout.trim()), `in ra "${result.stdout.trim()}"`);
  if (options["expect-version"] !== undefined) {
    expect(result.stdout.trim() === options["expect-version"], `in ra ${result.stdout.trim()}, cần ${options["expect-version"]}`);
  }
  expect(result.stderr.trim() === "", `stderr: ${result.stderr.trim()}`);
  return result.stdout.trim();
});

let analysis;
await step("analyze: phân tích theme, không file nào lỗi, stderr không có cảnh báo của Node", () => {
  const result = themegraph("analyze", theme, "--json");
  expect(result.code === 0, `mã thoát ${result.code}: ${result.stderr.trim()}`);
  // Cảnh báo "SQLite is an experimental feature" phải bị chặn cả trong bản đã gộp.
  expect(!result.stderr.includes("ExperimentalWarning"), `stderr có cảnh báo: ${result.stderr.trim().split("\n")[0]}`);
  analysis = JSON.parse(result.stdout);
  expect(analysis.errors.length === 0, `${analysis.errors.length} file lỗi, đầu tiên: ${analysis.errors[0]?.path}`);
  expect(analysis.stats.nodes > 0 && analysis.stats.edges > 0, "đồ thị rỗng");
  expect(existsSync(path.join(theme, ".themegraph", "graph.db")), "không thấy .themegraph/graph.db trong theme");
  if (options["expect-nodes"] !== undefined) expect(analysis.stats.nodes === Number(options["expect-nodes"]), `${analysis.stats.nodes} node, cần ${options["expect-nodes"]}`);
  if (options["expect-edges"] !== undefined) expect(analysis.stats.edges === Number(options["expect-edges"]), `${analysis.stats.edges} cạnh, cần ${options["expect-edges"]}`);
  return `${analysis.stats.files} file, ${analysis.stats.nodes} node, ${analysis.stats.edges} cạnh, ${analysis.durationMs} ms`;
});

await step("list và status: theme có trong sổ đăng ký, đồ thị khớp với file trên đĩa", () => {
  const listed = json("list");
  expect(listed.length === 1 && path.resolve(listed[0].path) === theme, `list trả ${listed.length} theme`);
  const status = json("status", "-t", theme);
  expect(status.stale === false, "status báo đồ thị đã cũ ngay sau khi phân tích");
  return `${status.nodes} node`;
});

await step("overview và search", () => {
  const overview = themegraph("overview", "-t", theme);
  expect(overview.code === 0 && overview.stdout.includes("Node"), `overview: mã thoát ${overview.code}`);
  const found = json("search", path.basename(options.file, path.extname(options.file)), "-t", theme);
  expect(found.hits.some((hit) => hit.id === options.file), `search không ra ${options.file}`);
  return `${found.total} kết quả`;
});

await step(`impact ${options.file}: có trang bị ảnh hưởng`, () => {
  const impact = json("impact", options.file, "-t", theme);
  expect(impact.pages.length > 0, "không trang nào bị ảnh hưởng");
  return `${impact.pages.length} trên ${impact.totalPages} trang: ${impact.pages.map((page) => page.id.replace("page:", "")).join(", ")}`;
});

await step(`render-flow ${options.page} và context`, () => {
  const flow = json("render-flow", options.page, "-t", theme);
  expect(flow.files.length > 0, "trang không kéo theo file nào");
  const context = json("context", options.file, "-t", theme);
  expect(context.usedBy.length > 0, `không ai gọi ${options.file}`);
  return `trang ${options.page} kéo theo ${flow.files.length} file; ${options.file} có ${context.usedBy.length} nơi gọi`;
});

await step("dead-code và verify", () => {
  const dead = json("dead-code", "-t", theme);
  const verify = themegraph("verify", "-t", theme);
  expect(verify.code === 0, `verify: mã thoát ${verify.code}: ${verify.stdout.trim().split("\n").at(-1)}`);
  return `${dead.certain} file chắc chắn không dùng, ${dead.review} cần xem lại; verify: ${verify.stdout.trim().split("\n").at(-1).trim()}`;
});

await step("Lỗi của người dùng: file không có thì mã thoát khác 0 và có gợi ý", () => {
  const result = themegraph("impact", "snippets/khong-co-file-nay.liquid", "-t", theme);
  expect(result.code !== 0, "mã thoát 0 dù file không có");
  expect(result.stderr.trim() !== "", "không in thông báo lỗi");
  return result.stderr.trim().split("\n")[0].slice(0, 80);
});

// ---- giao diện web và API ----
await step("serve: API trả lời, và giao diện web đi kèm trong gói được phục vụ", async () => {
  const child = spawn(process.execPath, [cliJs, "serve", "--port", "0"], { env, cwd: home });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));

  try {
    const url = await waitFor(() => /http:\/\/localhost:\d+/.exec(stdout)?.[0], () => `serve không in địa chỉ. stdout: ${stdout.trim()} stderr: ${stderr.trim()}`);
    // 127.0.0.1 thay cho localhost: server luôn nghe ở đó, còn ::1 thì tuỳ máy.
    const base = url.replace("localhost", "127.0.0.1");

    const themes = await (await fetch(`${base}/api/themes`)).json();
    expect(themes.length === 1 && themes[0].problem === null, `/api/themes trả ${JSON.stringify(themes).slice(0, 120)}`);

    const graph = await (await fetch(`${base}/api/themes/${themes[0].id}/graph`)).json();
    expect(graph.nodes.length > 0 && graph.edges.length > 0, "/graph trả đồ thị rỗng");

    const page = await fetch(`${base}/`);
    const html = await page.text();
    expect(page.status === 200, `trang chủ trả mã ${page.status} (503 nghĩa là gói thiếu giao diện)`);
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(script !== undefined, "trang chủ không trỏ tới file JavaScript nào");
    const asset = await fetch(`${base}${script}`);
    expect(asset.status === 200 && (asset.headers.get("content-type") ?? "").includes("javascript"), `${script} trả mã ${asset.status}`);

    return `${url}, /graph ${graph.nodes.length} node, giao diện ${Math.round((await asset.arrayBuffer()).byteLength / 1024)} KB`;
  } finally {
    child.kill();
  }
});

// ---- MCP ----
await step("mcp: bắt tay, liệt kê sáu tool, gọi được tool impact", async () => {
  const child = spawn(process.execPath, [cliJs, "mcp"], { env, cwd: home });
  let buffer = "";
  let stderr = "";
  const replies = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line === "") continue;
      // Mọi dòng trên stdout của MCP server phải là JSON; dòng nào khác là lỗi giao thức.
      const message = JSON.parse(line);
      if (message.id !== undefined) replies.set(message.id, message);
    }
  });
  child.stderr.on("data", (chunk) => (stderr += chunk));

  let nextId = 0;
  const call = async (method, params) => {
    const id = ++nextId;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const reply = await waitFor(() => replies.get(id), () => `không có trả lời cho ${method}. stderr: ${stderr.trim().slice(0, 200)}`);
    expect(reply.error === undefined, `${method}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  };

  try {
    const hello = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    const { tools } = await call("tools/list", {});
    const names = tools.map((tool) => tool.name).sort();
    expect(names.join(",") === "context,dead_code,impact,list_themes,render_flow,search", `tool: ${names.join(", ")}`);

    // Tên tham số lấy từ chính schema của tool, không viết cứng ở đây.
    const impact = tools.find((tool) => tool.name === "impact");
    const fileParam = (impact.inputSchema.required ?? [])[0];
    expect(typeof fileParam === "string", "tool impact không có tham số bắt buộc nào");
    const answer = await call("tools/call", { name: "impact", arguments: { [fileParam]: options.file, theme } });
    const text = answer.content.map((part) => part.text ?? "").join("\n");
    expect(answer.isError !== true && text.includes(options.file), `impact trả: ${text.slice(0, 120)}`);

    return `${hello.serverInfo.name} ${hello.serverInfo.version}, giao thức ${hello.protocolVersion}, impact trả ${text.split("\n").length} dòng`;
  } finally {
    child.stdin.end();
    child.kill();
  }
});

// ---- nối với AI agent ----
await step("setup --dry-run: tìm thấy skill trong gói, trỏ MCP về bản đã cài", () => {
  const result = themegraph("setup", "--dry-run");
  expect(result.code === 0, `mã thoát ${result.code}: ${result.stderr.trim()}`);
  expect(result.stdout.includes("SKILL.md"), "không nhắc tới skill");
  expect(result.stdout.includes("mcp.json"), "không nhắc tới cấu hình của Cursor");
  expect(!existsSync(path.join(home, ".cursor", "mcp.json")), "--dry-run mà vẫn ghi file");
  return "không ghi gì";
});

// ---- dọn ----
await step("clean: gỡ dữ liệu của theme và mục trong sổ đăng ký", () => {
  const result = themegraph("clean", "--theme", theme);
  expect(result.code === 0, `mã thoát ${result.code}: ${result.stderr.trim()}`);
  expect(!existsSync(path.join(theme, ".themegraph", "graph.db")), "graph.db vẫn còn");
  expect(json("list").length === 0, "theme vẫn còn trong sổ đăng ký");
  return "";
});

rmSync(home, { recursive: true, force: true, maxRetries: 5 });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} đạt, ${failed} hỏng.`);
process.exit(failed === 0 ? 0 : 1);

/** Chờ `read` trả về giá trị khác undefined/null; hết 15 giây thì ném lỗi với thông báo của `explain`. */
async function waitFor(read, explain) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const value = read();
    if (value !== undefined && value !== null) return value;
    if (Date.now() > deadline) throw new Error(explain());
    await new Promise((done) => setTimeout(done, 50));
  }
}
