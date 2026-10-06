// Đo kích thước và thời gian trả lời của từng tool, gọi qua stdio trên lệnh đã
// build, với tham số mặc định. Mỗi tool gọi 5 lần, lấy trung vị.
//
// Dùng: node tools/accept/measure-server.mjs <thư mục theme> <file> <trang> <từ khoá>
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");

// SDK là phụ thuộc của gói mcp, không phải của gốc repo.
const require = createRequire(path.join(repo, "packages", "mcp", "package.json"));
const load = (id) => import(pathToFileURL(require.resolve(id)).href);
const { Client } = await load("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await load("@modelcontextprotocol/sdk/client/stdio.js");

const [theme, file, page, query] = process.argv.slice(2);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repo, "packages", "cli", "dist", "cli.js"), "mcp"],
  cwd: theme,
  env: { ...process.env },
});
const client = new Client({ name: "measure", version: "0" });
await client.connect(transport);

const calls = [
  ["impact", { target: file }],
  ["context", { target: file }],
  ["render_flow", { page }],
  ["search", { query }],
  ["dead_code", {}],
];

for (const [name, args] of calls) {
  const times = [];
  let size = 0;
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const result = await client.callTool({ name, arguments: args });
    times.push(performance.now() - started);
    size = Buffer.byteLength(result.content[0].text, "utf8");
  }
  times.sort((a, b) => a - b);
  console.log(`${name.padEnd(12)} ${(size / 1024).toFixed(1).padStart(5)} KB  ${Math.round(times[2]).toString().padStart(4)} ms`);
}
await client.close();
