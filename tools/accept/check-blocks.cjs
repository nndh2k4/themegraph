// Đối chiếu ĐỘC LẬP các quan hệ tới theme block: script này tự đọc file của theme
// bằng regex và JSON.parse, không dùng dòng mã nào của ThemeGraph, rồi so với
// các cạnh trong graph.db. Mục đích là kiểm chính các QUY TẮC về block, thứ mà
// bộ test (viết theo cùng cách hiểu với mã) không kiểm được.
//
// Bốn nguồn tham chiếu tới một block, theo tài liệu Shopify:
//   schema   mục {"type": "<tên>"} trong "blocks" của {% schema %} (section hoặc block)
//   static   {% content_for "block", type: "<tên>", id: ... %}
//   json     block có "type": "<tên>" trong JSON template hoặc section group, mọi tầng lồng
//   preset   block có "type": "<tên>" trong "presets" của {% schema %}
//
// Dùng: node tools/accept/check-blocks.cjs <thư mục theme>
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const root = process.argv[2];
const rel = (file) => path.relative(root, file).replaceAll("\\", "/");

function listFiles(dir, pattern) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full, { recursive: true })
    .map((name) => path.join(full, String(name)))
    .filter((file) => pattern.test(file) && fs.statSync(file).isFile());
}

const blockNames = new Set(listFiles("blocks", /\.liquid$/).map((file) => path.basename(file, ".liquid")));

/** refs: tên block -> Map(file tham chiếu -> tập nguồn). */
const refs = new Map();
function add(block, file, source) {
  if (!blockNames.has(block)) return;
  if (!refs.has(block)) refs.set(block, new Map());
  const byFile = refs.get(block);
  if (!byFile.has(file)) byFile.set(file, new Set());
  byFile.get(file).add(source);
}

/** Đi qua mọi block trong một cấu trúc "blocks" của JSON (mảng hoặc object, lồng nhau). */
function walkBlocks(blocks, visit) {
  if (blocks === null || typeof blocks !== "object") return;
  for (const entry of Array.isArray(blocks) ? blocks : Object.values(blocks)) {
    if (entry === null || typeof entry !== "object") continue;
    visit(entry);
    walkBlocks(entry.blocks, visit);
  }
}

const acceptors = [];
let schemaErrors = 0;

// ---- file Liquid: schema, preset, static ----
for (const file of [...listFiles("sections", /\.liquid$/), ...listFiles("blocks", /\.liquid$/), ...listFiles("snippets", /\.liquid$/), ...listFiles("layout", /\.liquid$/), ...listFiles("templates", /\.liquid$/)]) {
  const text = fs.readFileSync(file, "utf8");
  const id = rel(file);

  for (const match of text.matchAll(/content_for\s+["']block["']\s*,[^%]*?type:\s*["']([^"']+)["']/g)) {
    add(match[1], id, "static");
  }

  const schema = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(text);
  if (!schema) continue;
  let json;
  try {
    json = JSON.parse(schema[1]);
  } catch {
    schemaErrors++;
    continue;
  }

  for (const entry of Array.isArray(json.blocks) ? json.blocks : []) {
    if (entry === null || typeof entry !== "object" || typeof entry.type !== "string") continue;
    if (entry.type === "@theme") acceptors.push(id);
    // Mục có "name" là block CỤC BỘ khai ngay trong section, không phải tham
    // chiếu tới file trong blocks/.
    else if (!entry.type.startsWith("@") && entry.name === undefined) add(entry.type, id, "schema");
  }
  for (const preset of Array.isArray(json.presets) ? json.presets : []) {
    walkBlocks(preset?.blocks, (entry) => typeof entry.type === "string" && add(entry.type, id, "preset"));
  }
}

// ---- file JSON: template và section group ----
function readJson(file) {
  // File JSON do Shopify sinh ra mở đầu bằng một khối chú thích /* ... */.
  const text = fs.readFileSync(file, "utf8").replace(/^﻿?\s*\/\*[\s\S]*?\*\//, "");
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function scanJsonDir(dir, source) {
  for (const file of listFiles(dir, /\.json$/)) {
    const json = readJson(file);
    if (json === null || typeof json.sections !== "object" || json.sections === null) continue;
    for (const section of Object.values(json.sections)) {
      walkBlocks(section?.blocks, (entry) => typeof entry.type === "string" && add(entry.type, rel(file), source));
    }
  }
}
scanJsonDir("templates", "json");
scanJsonDir("sections", "json");

// Thư mục listings/ chứa các bộ template của từng preset của theme. ThemeGraph
// không quét nó; ghi riêng để biết có block nào CHỈ được dùng ở đó không.
const listingRefs = new Map();
for (const file of listFiles("listings", /\.json$/)) {
  const json = readJson(file);
  if (json === null || typeof json.sections !== "object" || json.sections === null) continue;
  for (const section of Object.values(json.sections)) {
    walkBlocks(section?.blocks, (entry) => {
      if (typeof entry.type !== "string" || !blockNames.has(entry.type)) return;
      listingRefs.set(entry.type, (listingRefs.get(entry.type) ?? 0) + 1);
    });
  }
}

// ---- so với đồ thị ----
const db = new DatabaseSync(path.join(root, ".themegraph", "graph.db"), { readOnly: true });
const incoming = db.prepare("SELECT src FROM edges WHERE dst = ? AND src <> dst ORDER BY src");

let same = 0;
const onlyScript = [];
const onlyGraph = [];
for (const name of [...blockNames].sort()) {
  const id = `blocks/${name}.liquid`;
  const graph = new Set(incoming.all(id).map((row) => String(row.src)));
  const mine = refs.get(name) ?? new Map();
  // Tham chiếu chỉ nằm trong preset không phải là quan hệ render; so riêng.
  const strong = new Set([...mine].filter(([, sources]) => [...sources].some((s) => s !== "preset")).map(([file]) => file));

  const a = [...strong].filter((file) => !graph.has(file) && file !== id);
  const b = [...graph].filter((file) => !strong.has(file));
  if (a.length === 0 && b.length === 0) same++;
  for (const file of a) onlyScript.push(`${id} <- ${file} (${[...mine.get(file)].join("+")})`);
  for (const file of b) onlyGraph.push(`${id} <- ${file}${mine.has(file) ? " (chỉ preset)" : ""}`);
}

const sources = { schema: 0, static: 0, json: 0, preset: 0 };
for (const byFile of refs.values()) for (const set of byFile.values()) for (const s of set) sources[s]++;

console.log(`Theme: ${root}`);
console.log(`Block: ${blockNames.size}; schema không đọc được: ${schemaErrors}`);
console.log(`Tham chiếu tìm được, theo nguồn: ${JSON.stringify(sources)}`);
console.log(`File nhận "@theme": ${acceptors.join(", ") || "(không có)"}`);
console.log(`Block có tập file tham chiếu TRÙNG với đồ thị: ${same}/${blockNames.size}`);
console.log(`Script thấy mà đồ thị không có (${onlyScript.length}):`);
for (const line of onlyScript.slice(0, 40)) console.log(`  ${line}`);
console.log(`Đồ thị có mà script không thấy (${onlyGraph.length}):`);
for (const line of onlyGraph.slice(0, 40)) console.log(`  ${line}`);

// Block không có tham chiếu nào trong theme nhưng có trong listings/.
const noRefs = [...blockNames].filter((name) => ![...(refs.get(name) ?? new Map()).values()].some((set) => [...set].some((s) => s !== "preset")));
const onlyInListings = noRefs.filter((name) => listingRefs.has(name));
console.log(`Block không được tham chiếu trong theme: ${noRefs.length}; trong số đó có mặt ở listings/: ${onlyInListings.length}`);
for (const name of onlyInListings) console.log(`  ${name} (${listingRefs.get(name)} lần trong listings/)`);
db.close();
