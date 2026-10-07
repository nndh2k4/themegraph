// Đóng gói ThemeGraph thành MỘT file .tgz cài được trên máy chỉ có Node:
//
//   npm install -g themegraph-<phiên bản>.tgz
//
// Trong repo, lệnh `themegraph` là gói packages/cli, và nó cần ba gói nội bộ
// khác (core, mcp, server) cùng bản build của giao diện web. Các gói đó không
// có trên npm, nên gói cli tự nó không cài được ở máy khác. Script này gộp tất
// cả vào một gói tự chứa:
//
//   dist/cli.js (+ các file phụ)   mã của cli, core, mcp, server và mọi thư viện
//                                  bên thứ ba, gộp bằng Rolldown
//   web/                           bản build của giao diện (packages/web/dist)
//   skills/                        skill cho AI agent
//   THIRD-PARTY-LICENSES.txt       giấy phép của các thư viện đã gộp vào
//
// Gói không có `dependencies`: cài nó không tải thêm gì từ npm.
//
// Dùng: pnpm build && node tools/release/pack.mjs      (hoặc: pnpm run pack)
// Kết quả: release/themegraph-<phiên bản>.tgz
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { rolldown } from "rolldown";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const out = path.join(root, "release");
const stage = path.join(out, "stage");
const at = (...parts) => path.join(root, ...parts);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function fail(message) {
  console.error(`Lỗi: ${message}`);
  process.exit(1);
}

// ---- 1. Mọi thứ cần gộp phải được build trước ----
const inputs = [
  "packages/core/dist/index.js",
  "packages/mcp/dist/index.js",
  "packages/server/dist/index.js",
  "packages/cli/dist/cli.js",
  "packages/web/dist/index.html",
];
const missing = inputs.filter((file) => !existsSync(at(file)));
if (missing.length > 0) fail(`chưa có ${missing.join(", ")}. Chạy "pnpm build" trước.`);

// ---- 2. Một phiên bản duy nhất ----
// Phiên bản in ra bởi `themegraph --version` là hằng số trong core; phiên bản
// của gói là trong package.json. Hai nơi lệch nhau thì người dùng cài bản 1.2
// mà lệnh lại báo 1.1.
const cliPackage = readJson(at("packages/cli/package.json"));
const { VERSION } = await import(pathToFileURL(at("packages/core/dist/version.js")).href);
const version = cliPackage.version;
const versions = { "packages/cli/package.json": version, "package.json": readJson(at("package.json")).version, "packages/core/src/version.ts": VERSION };
if (new Set(Object.values(versions)).size !== 1) {
  fail(`phiên bản không thống nhất: ${Object.entries(versions).map(([file, value]) => `${file} = ${value}`).join("; ")}`);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, "dist"), { recursive: true });

// ---- 3. Gộp mã ----
// Đầu vào là bản đã biên dịch của cli (JavaScript, không phải TypeScript), nên
// mã được gộp chính là mã mà bộ test đã chạy.
//
// cli.js nạp run.js bằng import() dạng hàm, SAU khi đã chặn cảnh báo của
// node:sqlite (xem packages/cli/src/cli.ts). Rolldown giữ import() đó thành
// một file riêng, nên thứ tự ấy còn nguyên trong gói.
const warnings = [];
const bundle = await rolldown({
  input: at("packages/cli/dist/cli.js"),
  platform: "node",
  onLog: (level, log) => {
    if (level === "warn") warnings.push(log.message);
  },
});
const { output } = await bundle.write({
  dir: path.join(stage, "dist"),
  format: "esm",
  entryFileNames: "cli.js",
  chunkFileNames: "[name]-[hash].js",
});
await bundle.close();

for (const warning of warnings) console.warn(`  cảnh báo khi gộp: ${warning}`);

// Lệnh `themegraph` chạy trực tiếp file này, nên nó phải giữ dòng "#!" ở đầu.
const entry = readFileSync(path.join(stage, "dist", "cli.js"), "utf8");
if (!entry.startsWith("#!/usr/bin/env node")) fail('dist/cli.js sau khi gộp mất dòng "#!/usr/bin/env node".');

// Không import nào được trỏ ra ngoài gói, trừ module có sẵn của Node.
const builtins = new Set((await import("node:module")).builtinModules.flatMap((name) => [name, `node:${name}`]));
const external = new Set();
for (const chunk of output) {
  if (chunk.type !== "chunk") continue;
  for (const name of [...chunk.imports, ...chunk.dynamicImports]) {
    const isOwnChunk = output.some((other) => other.fileName === name);
    if (!isOwnChunk && !builtins.has(name)) external.add(name);
  }
}
if (external.size > 0) fail(`gói còn import từ bên ngoài: ${[...external].join(", ")}`);

// ---- 4. Giấy phép của các thư viện đã gộp ----
// Mã của bên thứ ba nay nằm trong file phát hành của ta; giấy phép của họ (hầu
// hết là MIT) đòi giữ lại thông báo bản quyền trong mọi bản sao.
const moduleIds = new Set(output.flatMap((chunk) => (chunk.type === "chunk" ? chunk.moduleIds : [])));
const thirdParty = new Map();

for (const id of moduleIds) {
  const file = id.replace(/^\0+/, "").split("?")[0];
  if (!path.isAbsolute(file) || !file.split(path.sep).includes("node_modules")) continue;

  // Đi ngược lên tới package.json có tên và phiên bản. Một số gói đặt
  // package.json phụ (chỉ có "type") trong thư mục con; bỏ qua chúng.
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const info = readJson(manifest);
    if (typeof info.name !== "string" || typeof info.version !== "string") continue;

    const key = `${info.name}@${info.version}`;
    if (!thirdParty.has(key)) {
      const licenseFile = readdirSync(dir).find((name) => /^(licen[sc]e|copying)(\.|$)/i.test(name));
      thirdParty.set(key, {
        name: info.name,
        version: info.version,
        license: typeof info.license === "string" ? info.license : "(không ghi trong package.json)",
        text: licenseFile === undefined ? null : readFileSync(path.join(dir, licenseFile), "utf8").trim(),
      });
    }
    break;
  }
}

const packages = [...thirdParty.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
const withoutText = packages.filter((entry) => entry.text === null);
const notices = [
  "ThemeGraph gộp mã của các thư viện dưới đây vào thư mục dist/.",
  "Mỗi thư viện thuộc bản quyền của tác giả của nó và được dùng theo giấy phép ghi kèm.",
  "",
  ...packages.flatMap((entry) => [
    "=".repeat(78),
    `${entry.name} ${entry.version}`,
    `Giấy phép: ${entry.license}`,
    "=".repeat(78),
    "",
    entry.text ?? "(Gói này không kèm file giấy phép; xem trang của gói trên npm.)",
    "",
  ]),
].join("\n");
writeFileSync(path.join(stage, "THIRD-PARTY-LICENSES.txt"), notices);

// ---- 5. Các phần không phải mã ----
cpSync(at("packages/web/dist"), path.join(stage, "web"), { recursive: true });
cpSync(at("packages/cli/skills"), path.join(stage, "skills"), { recursive: true });
for (const file of ["README.md", "LICENSE"]) {
  if (existsSync(at(file))) cpSync(at(file), path.join(stage, file));
  else console.warn(`  chú ý: repo chưa có ${file}, gói sẽ thiếu file này`);
}

// ---- 6. package.json của gói phát hành ----
// Không có "dependencies": mọi thứ đã nằm trong dist/.
const rootPackage = readJson(at("package.json"));
writeFileSync(
  path.join(stage, "package.json"),
  `${JSON.stringify(
    {
      name: cliPackage.name,
      version,
      description: cliPackage.description,
      license: rootPackage.license,
      type: "module",
      bin: cliPackage.bin,
      engines: cliPackage.engines,
      files: ["dist", "web", "skills", "THIRD-PARTY-LICENSES.txt"],
      ...(rootPackage.repository === undefined ? {} : { repository: rootPackage.repository }),
      ...(rootPackage.homepage === undefined ? {} : { homepage: rootPackage.homepage }),
    },
    null,
    2,
  )}\n`,
);

// ---- 7. npm pack ----
// shell: true vì trên Windows npm là file npm.cmd.
const packed = spawnSync(`npm pack --pack-destination "${out}"`, { cwd: stage, shell: true, encoding: "utf8" });
if (packed.status !== 0) fail(`npm pack thất bại:\n${packed.stderr}`);

const tarball = path.join(out, packed.stdout.trim().split("\n").at(-1).trim());
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const sizeOf = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).reduce((total, item) => (item.isFile() ? total + statSync(path.join(item.parentPath, item.name)).size : total), 0);

console.log(`Đã đóng gói ${path.relative(root, tarball)} (${kb(statSync(tarball).size)})`);
console.log(`  dist/   ${kb(sizeOf(path.join(stage, "dist")))} trong ${output.length} file, gộp ${moduleIds.size} module`);
console.log(`  web/    ${kb(sizeOf(path.join(stage, "web")))}`);
console.log(`  thư viện bên thứ ba đã gộp: ${packages.length}${withoutText.length > 0 ? ` (${withoutText.length} gói không kèm file giấy phép: ${withoutText.map((entry) => entry.name).join(", ")})` : ""}`);
console.log(`Cài thử: npm install -g "${tarball}"`);
