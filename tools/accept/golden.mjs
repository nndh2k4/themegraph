// Golden master: chạy CLI, MCP và HTTP API của một bản ThemeGraph ĐÃ BUILD trên
// các theme mẫu, ghi mọi đầu ra ra file, để so hai bản (ví dụ trước và sau khi
// viết lại kiến trúc) bằng golden-compare.mjs.
//
// Mỗi theme được ghi: đầu ra của analyze, toàn bộ nội dung graph.db, các lệnh
// không tham số, search, impact và context cho MỌI node (cả --json lẫn chữ),
// render-flow cho mọi trang, các lỗi người dùng hay gặp, sáu tool MCP và mọi
// route của API HTTP. Cuối cùng là status khi file đổi, và clean.
//
// Dùng (đứng ở gốc repo đã `pnpm build`):
//   node tools/accept/golden.mjs --repo <repo> --themes <thư mục> --out <thư mục ra> [--work <thư mục>]
//
//   --themes  thư mục chứa các theme mẫu, mỗi theme một thư mục con; không bị sửa
//   --work    nơi chép theme và đặt sổ đăng ký tạm (mặc định: <tmp>/themegraph-golden).
//             Hai lần chạy cần so với nhau PHẢI dùng cùng --work: độ rộng cột của
//             các bảng chữ phụ thuộc độ dài đường dẫn. Vì vậy đừng chạy song song.
import { appendFileSync, cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const { values: args } = parseArgs({
  options: { repo: { type: "string" }, themes: { type: "string" }, out: { type: "string" }, work: { type: "string" } },
});
if (args.repo === undefined || args.themes === undefined || args.out === undefined) {
  console.error("Dùng: node tools/accept/golden.mjs --repo <repo> --themes <thư mục> --out <thư mục ra> [--work <thư mục>]");
  process.exit(2);
}
const repo = path.resolve(args.repo);
const out = path.resolve(args.out);
const base = path.resolve(args.work ?? path.join(os.tmpdir(), "themegraph-golden"));

const home = path.join(base, "home");
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
process.env.THEMEGRAPH_HOME = home;

// Mỗi lần chạy dùng một bản sao mới của theme, để graph.db và trạng thái file y hệt nhau.
const work = path.join(base, "work");
rmSync(work, { recursive: true, force: true });
cpSync(path.resolve(args.themes), work, { recursive: true });

const load = (rel) => import(pathToFileURL(path.join(repo, rel)).href);
const { run } = await load("packages/cli/dist/run.js");
const mcpPkg = await load("packages/mcp/dist/index.js");
const serverPkg = await load("packages/server/dist/index.js");

const sdkRequire = createRequire(path.join(repo, "packages/mcp/package.json"));
const esm = (spec) => pathToFileURL(sdkRequire.resolve(spec).replace(`${path.sep}cjs${path.sep}`, `${path.sep}esm${path.sep}`)).href;
const { Client } = await import(esm("@modelcontextprotocol/sdk/client/index.js"));
const { InMemoryTransport } = await import(esm("@modelcontextprotocol/sdk/inMemory.js"));

mkdirSync(out, { recursive: true });

function normalize(text) {
  return text
    .replaceAll(work, "<WORK>")
    .replaceAll(work.replaceAll("\\", "\\\\"), "<WORK>")
    .replaceAll(home, "<HOME>")
    .replaceAll(home.replaceAll("\\", "\\\\"), "<HOME>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<TIME>")
    .replace(/"durationMs": \d+/g, '"durationMs": <N>');
}

let file;
function record(label, text) {
  appendFileSync(file, `### ${label}\n${normalize(text)}\n`);
}

async function cli(args) {
  const lines = [];
  const code = await run(args, { stdout: (line) => lines.push(line), stderr: (line) => lines.push(`[stderr] ${line}`) });
  record(`cli ${args.join(" ")}`, `[exit ${code}]\n${lines.join("\n")}`);
}

async function cliIn(cwd, args) {
  const before = process.cwd();
  process.chdir(cwd);
  try {
    const lines = [];
    const code = await run(args, { stdout: (line) => lines.push(line), stderr: (line) => lines.push(`[stderr] ${line}`) });
    record(`cli@${path.relative(work, cwd)} ${args.join(" ")}`, `[exit ${code}]\n${lines.join("\n")}`);
  } finally {
    process.chdir(before);
  }
}

function dumpDb(themeRoot) {
  const db = new DatabaseSync(path.join(themeRoot, ".themegraph", "graph.db"), { readOnly: true });
  try {
    const tables = db.prepare("SELECT name, sql FROM sqlite_master ORDER BY type, name").all();
    record("db schema", tables.map((t) => `${t.name}: ${t.sql}`).join("\n"));
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()) {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all().map((row) => {
        const copy = { ...row };
        if (name === "refs") delete copy.id;
        return JSON.stringify(copy);
      });
      if (name === "meta") {
        record(`db ${name}`, rows.filter((r) => !r.includes("analyzed_at")).sort().join("\n"));
      } else {
        record(`db ${name} (${rows.length})`, rows.sort().join("\n"));
      }
    }
    return {
      nodes: db.prepare("SELECT id, kind FROM nodes ORDER BY id").all().map((r) => ({ id: String(r.id), kind: String(r.kind) })),
    };
  } finally {
    db.close();
  }
}

async function mcpSession(cwd) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await mcpPkg.createServer({ cwd }).connect(serverSide);
  const client = new Client({ name: "golden", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

async function mcp(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  record(`mcp ${name} ${JSON.stringify(args)}`, `[isError ${result.isError === true}]\n${result.content.map((c) => c.text).join("\n")}`);
}

async function api(pathAndQuery, method = "GET") {
  const url = new URL(pathAndQuery, "http://localhost");
  const response = await serverPkg.handleApi({ method, path: url.pathname, query: url.searchParams });
  record(`api ${method} ${pathAndQuery}`, `[${response.status}]\n${JSON.stringify(response.body, null, 2)}`);
}

/** Lấy mẫu đều: mọi phần tử nếu ít, còn không thì mỗi bước `step` một phần tử. */
const sample = (items, max) => (items.length <= max ? items : items.filter((_, i) => i % Math.ceil(items.length / max) === 0));

const themes = readdirSync(path.join(work)).sort();
for (const name of themes) {
  const root = path.join(work, name);
  file = path.join(out, `${name}.txt`);
  writeFileSync(file, "");
  const started = Date.now();

  // --- phân tích
  await cli(["analyze", root, "--json"]);
  await cli(["analyze", root]);
  const { nodes } = dumpDb(root);
  const ids = nodes.map((n) => n.id);
  const pages = nodes.filter((n) => n.kind === "page_type").map((n) => n.id.slice("page:".length));
  const files = nodes.filter((n) => !["page_type", "translation_key", "setting"].includes(n.kind)).map((n) => n.id);

  // --- lệnh không tham số
  for (const cmd of ["list", "status", "overview", "dead-code", "verify"]) {
    await cli([cmd, "--theme", root, "--json"]);
    await cli([cmd, "--theme", root]);
  }
  await cli(["dead-code", "--theme", root, "--limit", "3"]);
  await cli(["overview", "--theme", root, "--limit", "2"]);

  // --- search
  for (const q of [[], ["card"], ["product"], ["card", "product"], ["header"], ["zzz-khong-co"]]) {
    await cli(["search", ...q, "--theme", root, "--json"]);
    await cli(["search", ...q, "--theme", root]);
  }
  await cli(["search", "--kind", "snippet", "--theme", root]);
  await cli(["search", "--kind", "setting", "--kind", "translation_key", "--limit", "5", "--theme", root, "--json"]);
  await cli(["search", "--kind", "page_type", "--theme", root, "--limit", "0"]);

  // --- impact và context cho MỌI node
  for (const id of ids) {
    await cli(["impact", id, "--theme", root, "--json"]);
    await cli(["impact", id, "--theme", root]);
    await cli(["context", id, "--theme", root, "--json"]);
    await cli(["context", id, "--theme", root]);
  }
  for (const id of sample(files, 30)) {
    await cli(["impact", id, "--theme", root, "--limit", "2"]);
    await cli(["context", id, "--theme", root, "--limit", "1"]);
    // Chỉ tên file, không thư mục.
    await cli(["impact", path.basename(id, path.extname(id)), "--theme", root]);
  }
  for (const page of pages) {
    await cli(["render-flow", page, "--theme", root, "--json"]);
    await cli(["render-flow", page, "--theme", root]);
    await cli(["render-flow", page, "--theme", root, "--depth", "2"]);
    await cli(["render-flow", page, "--theme", root, "--limit", "5"]);
  }

  // --- lỗi và đứng trong thư mục con
  await cli(["impact", "snippets/khong-co.liquid", "--theme", root]);
  await cli(["impact", "card", "--theme", root]);
  await cli(["render-flow", "khong-co-trang", "--theme", root]);
  await cli(["context", "--theme", root]);
  await cli(["impact", "a", "b", "--theme", root]);
  await cli(["overview", "thua", "--theme", root]);
  await cli(["search", "--kind", "khong-co-loai", "--theme", root]);
  await cli(["impact", "x", "--limit", "-1", "--theme", root]);
  await cli(["render-flow", "product", "--depth", "0", "--theme", root]);
  await cli(["khong-co-lenh"]);
  await cli(["--abc"]);
  await cli(["impact", "x", "--theme", path.join(work, "khong-co-theme")]);
  for (const sub of ["snippets", "sections", "templates"]) {
    const dir = path.join(root, sub);
    const local = files.filter((f) => f.startsWith(`${sub}/`)).slice(0, 3);
    for (const f of local) {
      await cliIn(dir, ["impact", path.basename(f)]);
      await cliIn(dir, ["context", path.basename(f), "--json"]);
    }
    await cliIn(dir, ["overview", "--limit", "1"]);
  }

  // --- MCP
  const client = await mcpSession(root);
  record("mcp tools", JSON.stringify((await client.listTools()).tools, null, 2));
  record("mcp instructions", client.getInstructions() ?? "");
  await mcp(client, "list_themes", {});
  await mcp(client, "search", { query: "card" });
  await mcp(client, "search", { query: "", kind: "page_type" });
  await mcp(client, "search", { query: "product", limit: 3, theme: root });
  await mcp(client, "dead_code", {});
  await mcp(client, "dead_code", { limit: 2 });
  for (const id of sample(ids, 60)) {
    await mcp(client, "impact", { target: id });
    await mcp(client, "context", { target: id, limit: 5 });
  }
  for (const page of pages) {
    await mcp(client, "render_flow", { page });
    await mcp(client, "render_flow", { page, max_depth: 1, limit: 10 });
  }
  for (const f of sample(files, 10)) await mcp(client, "render_flow", { page: f, max_depth: 5 });
  await mcp(client, "impact", { target: "khong-co" });
  await mcp(client, "impact", { target: "x", theme: "theme-khong-co" });
  await client.close();
  const lost = await mcpSession(path.join(work));
  await mcp(lost, "impact", { target: "x" });
  await lost.close();

  // --- HTTP API
  const id = serverPkg.themeId(root);
  await api("/api/themes");
  await api(`/api/themes/${id}/overview`);
  await api(`/api/themes/${id}/search?q=card`);
  await api(`/api/themes/${id}/search?q=&kind=page_type,snippet&limit=7`);
  await api(`/api/themes/${id}/dead-code`);
  await api(`/api/themes/${id}/graph`);
  await api(`/api/themes/${id}/graph?include=translations,settings`);
  for (const page of pages) await api(`/api/themes/${id}/flow?page=${encodeURIComponent(page)}&depth=2`);
  for (const f of sample(files, 40)) await api(`/api/themes/${id}/file?path=${encodeURIComponent(f)}`);
  await api(`/api/themes/${id}/file`);
  await api(`/api/themes/${id}/file?path=khong-co.liquid`);
  await api(`/api/themes/${id}/search?limit=abc`);
  await api(`/api/themes/${id}/graph?include=abc`);
  await api(`/api/themes/000000000000/overview`);
  await api(`/api/themes/${id}/khong-co`);
  await api(`/api/khong-co`);
  await api(`/api/themes`, "POST");

  console.log(`${name}: ${ids.length} node, ${Date.now() - started} ms`);
}

// --- status khi file đổi, và clean (trên mini, sau cùng)
file = path.join(out, "zz-status-clean.txt");
writeFileSync(file, "");
const mini = path.join(work, "mini");
appendFileSync(path.join(mini, "templates", "index.json"), "\n");
rmSync(path.join(mini, "locales", "en.default.schema.json"));
writeFileSync(path.join(mini, "snippets-moi.liquid"), "x");
mkdirSync(path.join(mini, "snippets"), { recursive: true });
writeFileSync(path.join(mini, "snippets", "moi.liquid"), "{% render 'khong-co' %}");
await cli(["status", "--theme", mini, "--json"]);
await cli(["status", "--theme", mini]);
await cli(["clean", "--theme", mini, "--json"]);
await cli(["list"]);
await cli(["impact", "x", "--theme", mini]);
await api("/api/themes");
await cli(["clean", "--all"]);
await cli(["list", "--json"]);
console.log("xong");
