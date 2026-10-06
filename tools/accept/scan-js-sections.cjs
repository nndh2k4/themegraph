// Đo cho phần review: (1) bao nhiêu section "cần xem lại" thật ra được JavaScript
// hoặc Liquid nhắc tên theo kiểu Section Rendering API; (2) block công khai có
// preset hay không. Chỉ đọc, không ghi gì.
//
// Dùng: node review-scan.cjs <thư mục theme>
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const root = process.argv[2];
const CLI = path.join(__dirname, "..", "..", "packages", "cli", "dist", "cli.js");

const dead = JSON.parse(
  execFileSync(process.execPath, [CLI, "dead-code", "--json", "-t", root], { encoding: "utf8", maxBuffer: 1 << 26 }),
);
const sections = dead.files.filter((f) => f.kind === "section").map((f) => f.id);

// Gom mọi file có thể chứa lời gọi Section Rendering API.
const files = [];
for (const dir of ["assets", "sections", "snippets", "blocks", "layout", "templates"]) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full, { recursive: true })) {
    const file = path.join(full, String(name));
    if (!/\.(js|liquid)$/.test(file) || /\.min\.js$/.test(file)) continue;
    if (fs.statSync(file).isFile()) files.push(file);
  }
}
const contents = files.map((file) => [path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "utf8")]);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let explained = 0;
console.log(`== ${path.basename(root)}: ${sections.length} section không trang nào dùng`);
for (const id of sections) {
  const name = path.basename(id, ".liquid");
  // Dạng chắc: section_id=ten, sections=ten, section: 'ten', sectionId: 'ten'.
  const strong = new RegExp(`(section_id|sections|section|sectionId|section-id)["']?\\s*[=:,]\\s*["'\`]?${escape(name)}(?![\\w-])`, "i");
  // Dạng yếu: tên đứng trong dấu nháy ở một file .js.
  const weak = new RegExp(`["'\`]${escape(name)}["'\`]`);
  const hits = [];
  for (const [file, text] of contents) {
    if (file === id) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (strong.test(line)) hits.push(`CHẮC ${file}:${i + 1}`);
      else if (file.endsWith(".js") && weak.test(line)) hits.push(`yếu  ${file}:${i + 1}`);
    }
  }
  if (hits.length > 0) explained++;
  console.log(`  ${name.padEnd(28)} ${hits.length === 0 ? "-" : hits.slice(0, 2).join(" | ")}`);
}
console.log(`  => ${explained}/${sections.length} có dấu vết được tải bằng JavaScript / Section Rendering API`);

// Block công khai và preset.
const db = new DatabaseSync(path.join(root, ".themegraph", "graph.db"), { readOnly: true });
const blocks = db
  .prepare(
    `SELECT n.id, coalesce(s.presets, -1) AS presets FROM nodes n LEFT JOIN schemas s ON s.file = n.id
     WHERE n.kind = 'block' AND substr(n.id, 1, 8) <> 'blocks/_'`,
  )
  .all();
const noPreset = blocks.filter((b) => Number(b.presets) <= 0);
console.log(`== block công khai: ${blocks.length}, trong đó không có preset: ${noPreset.length}`);
if (noPreset.length > 0) console.log("  " + noPreset.map((b) => `${b.id}(${b.presets})`).slice(0, 12).join(", "));
db.close();
