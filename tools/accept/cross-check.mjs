// Đối chiếu kết quả của ThemeGraph với một phép dò KHÔNG dùng tới ThemeGraph,
// trên một mẫu trường hợp chọn ngẫu nhiên, để ước lượng tỉ lệ đúng và tỉ lệ sót.
//
// Ý tưởng: với mỗi đối tượng được chọn (một snippet, một khoá dịch...), có hai
// danh sách "những chỗ nhắc tới nó":
//
//   - của công cụ:  lệnh `themegraph context` (đọc từ đồ thị);
//   - của phép dò:  tìm chính cái TÊN đó, viết trong dấu nháy, ở mọi file văn
//                   bản của theme. Phép dò không hiểu Liquid; nó chỉ tìm chuỗi.
//
// Chỗ nào có ở cả hai thì khớp. Chỗ chỉ có ở một bên được in ra để một người
// mở file và phân xử: công cụ sót, công cụ bịa, hay phép dò bắt nhầm (tên nằm
// trong chú thích, hoặc trùng tên với thứ khác). Kết quả phân xử ghi vào một
// file JSON; lệnh `report` gộp lại thành bảng.
//
// Mẫu được chọn bằng bộ sinh số ngẫu nhiên có hạt giống cố định, từ danh sách
// file trên đĩa chứ không từ đồ thị, để người làm không chọn theo cảm tính và
// để ai cũng chọn lại được đúng mẫu đó.
//
// Dùng:
//   node tools/accept/cross-check.mjs pick   --theme <thư mục> --seed <chữ> --out <mẫu.json>
//   node tools/accept/cross-check.mjs run    --theme <thư mục> --cases <mẫu.json> --out <kết-quả.json>
//   node tools/accept/cross-check.mjs report --verdicts <phân-xử.json> <kết-quả.json> [<kết-quả.json> ...]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const [command, ...rest] = process.argv.slice(2);
const { values: options, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    theme: { type: "string" },
    seed: { type: "string", default: "themegraph" },
    cases: { type: "string" },
    out: { type: "string" },
    verdicts: { type: "string" },
    bin: { type: "string", default: "themegraph" },
  },
});

const quote = (text) => (/[\s"&|<>^]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Chạy lệnh themegraph với --json trên theme đang xét; trả null nếu lệnh hỏng. */
function tool(theme, ...args) {
  const result = spawnSync([quote(options.bin), ...args.map(quote), "-t", quote(theme), "--json"].join(" "), {
    shell: true,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.status === 0 ? JSON.parse(result.stdout) : { failed: (result.stderr || result.stdout).trim().split("\n")[0] };
}

// ---- đọc theme từ đĩa, không qua ThemeGraph ----

const TEXT_FILE = /\.(liquid|json|js|css)$/;

/** Mọi file văn bản của theme, dạng đường dẫn tương đối dùng dấu "/". */
function textFiles(theme) {
  return readdirSync(theme, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && TEXT_FILE.test(item.name))
    .map((item) => path.relative(theme, path.join(item.parentPath, item.name)).replaceAll("\\", "/"))
    .filter((file) => !file.split("/").some((part) => part.startsWith(".")))
    .sort();
}

const listDir = (theme, dir, pattern) =>
  existsSync(path.join(theme, dir)) ? readdirSync(path.join(theme, dir)).filter((name) => pattern.test(name)).sort() : [];

/**
 * Đọc một file JSON của theme. Bỏ khối chú thích ở đầu và các dòng chỉ có chú
 * thích: đủ cho việc CHỌN mẫu, và cố ý không dùng hàm của ThemeGraph.
 */
function readThemeJson(file) {
  const text = readFileSync(file, "utf8")
    .replace(/^﻿/, "")
    .replace(/^\s*\/\*[\s\S]*?\*\//, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(text);
}

/** Khối {% schema %} của một file Liquid, đã đọc thành object; null nếu không có hoặc hỏng. */
function schemaOf(theme, file) {
  const content = readFileSync(path.join(theme, file), "utf8");
  const body = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(content)?.[1];
  if (body === undefined) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const PLURAL_FORMS = new Set(["zero", "one", "two", "few", "many", "other"]);

/** Các khoá dịch của file dịch mặc định, dạng 'a.b.c'. Nhóm số nhiều (one/other) tính là một khoá. */
function translationKeys(theme) {
  const file = listDir(theme, "locales", /\.default\.json$/).find((name) => !name.endsWith(".schema.json"));
  if (file === undefined) return [];

  const keys = [];
  const walk = (value, prefix) => {
    for (const [name, child] of Object.entries(value)) {
      const key = prefix === "" ? name : `${prefix}.${name}`;
      const isGroup = typeof child === "object" && child !== null;
      const isPlural = isGroup && Object.keys(child).length > 0 && Object.keys(child).every((form) => PLURAL_FORMS.has(form));
      if (isGroup && !isPlural) walk(child, key);
      else keys.push(key);
    }
  };
  walk(readThemeJson(path.join(theme, "locales", file)), "");
  return keys.sort();
}

/** Mọi dòng của theme khớp `pattern`, trừ những dòng nằm trong file `skip`. */
function grep(theme, files, pattern, skip = null) {
  const hits = [];
  for (const file of files) {
    if (file === skip) continue;
    const lines = readFileSync(path.join(theme, file), "utf8").split("\n");
    lines.forEach((text, index) => {
      if (pattern.test(text)) hits.push({ file, line: index + 1, text: text.trim().slice(0, 160) });
    });
  }
  return hits;
}

// ---- pick: chọn mẫu ----

/** Bộ sinh số giả ngẫu nhiên mulberry32, gieo từ một chuỗi. Cùng hạt giống thì cùng dãy số. */
function seeded(text) {
  let state = 2166136261;
  for (const char of text) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick() {
  const theme = path.resolve(options.theme);
  const random = seeded(`${options.seed}:${path.basename(theme)}`);
  const choose = (items) => (items.length === 0 ? null : items[Math.floor(random() * items.length)]);

  const snippets = listDir(theme, "snippets", /\.liquid$/);
  const sections = listDir(theme, "sections", /\.liquid$/);
  const blocks = listDir(theme, "blocks", /\.liquid$/);
  const assets = listDir(theme, "assets", /\./);
  const templates = textFiles(theme).filter((file) => file.startsWith("templates/") && file.endsWith(".json"));

  const cases = [];
  const add = (kind, target, extra = {}) => cases.push({ n: cases.length + 1, kind, target, ...extra });

  // Hai snippet khác nhau.
  const firstSnippet = choose(snippets);
  add("snippet", `snippets/${firstSnippet}`);
  add("snippet", `snippets/${choose(snippets.filter((name) => name !== firstSnippet))}`);
  add("section", `sections/${choose(sections)}`);
  // Theme không có thư mục blocks/ (Dawn) thì lấy thêm một snippet.
  if (blocks.length > 0) add("block", `blocks/${choose(blocks)}`);
  else add("snippet", `snippets/${choose(snippets.filter((name) => !cases.some((entry) => entry.target === `snippets/${name}`)))}`);
  add("asset", `assets/${choose(assets)}`);

  const key = choose(translationKeys(theme));
  add("translation", key, { nodeId: `t:${key}` });

  // Một setting khai ở mức cao nhất trong schema của một section hoặc block.
  const owners = [...sections.map((name) => `sections/${name}`), ...blocks.map((name) => `blocks/${name}`)]
    .map((file) => ({ file, ids: (schemaOf(theme, file)?.settings ?? []).map((setting) => setting.id).filter((id) => typeof id === "string") }))
    .filter((owner) => owner.ids.length > 0);
  const owner = choose(owners);
  const settingId = choose(owner.ids);
  const scope = owner.file.startsWith("blocks/") ? "block" : "section";
  add("setting", `${owner.file} › ${scope}.settings.${settingId}`, { file: owner.file, scope, id: settingId, nodeId: `setting:${owner.file}#${scope}.${settingId}` });

  add("template", choose(templates));

  // Hai loại cuối lấy mẫu từ chính LỜI KHẲNG ĐỊNH của công cụ, để kiểm xem nó có nói quá không.
  const dead = tool(theme, "dead-code");
  const certain = (dead.files ?? []).filter((entry) => entry.confidence === "certain").map((entry) => entry.id);
  add("dead", choose(certain), { population: certain.length });

  const analysis = spawnSync([quote(options.bin), "analyze", quote(theme), "--json"].join(" "), { shell: true, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const missing = JSON.parse(analysis.stdout).missing;
  const broken = choose(missing);
  add("broken", broken === null ? null : `${broken.from}:${broken.line} → ${broken.kind} ${broken.to}`, { ref: broken, population: missing.length });

  writeFileSync(options.out, `${JSON.stringify({ theme, seed: options.seed, cases }, null, 2)}\n`);
  for (const entry of cases) console.log(`${String(entry.n).padStart(2)}  ${entry.kind.padEnd(11)} ${entry.target}`);
}

// ---- run: lấy câu trả lời của công cụ và của phép dò, rồi so ----

/** Mẫu tìm tên của một đối tượng, viết trong dấu nháy. */
function tokenPattern(entry) {
  if (entry.kind === "asset") {
    // Tên file kèm đuôi đủ đặc trưng để tìm cả khi không có dấu nháy (ví dụ trong url() của CSS).
    return new RegExp(`(?<![\\w./-])${escapeRegExp(path.basename(entry.target))}(?![\\w-])`);
  }
  if (entry.kind === "translation") return new RegExp(`['"]${escapeRegExp(entry.target)}['"]`);
  if (entry.kind === "setting") {
    // settings.<id>, settings['<id>'], và biến tự đặt kiểu block_settings.<id>.
    const id = escapeRegExp(entry.id);
    return new RegExp(`settings\\.${id}\\b|settings\\[['"]${id}['"]\\]`);
  }
  const name = escapeRegExp(path.basename(entry.target, ".liquid"));
  const dir = entry.target.split("/")[0];
  return new RegExp(`(?<![\\w/-])['"]${name}(\\.liquid)?['"]|${dir}/${name}\\.liquid`);
}

/** Các chỗ công cụ nói là "nhắc tới đối tượng": mỗi dòng một mục; quan hệ không có số dòng thì line = 0. */
function toolItems(theme, entry) {
  const id = entry.nodeId ?? entry.target;
  const context = tool(theme, "context", id);
  if (context.failed !== undefined) return { failed: context.failed, items: [] };

  const items = [];
  for (const link of context.usedBy) {
    if (link.lines.length === 0) items.push({ file: link.id, line: 0, type: link.type, sources: link.sources });
    for (const line of link.lines) items.push({ file: link.id, line, type: link.type, sources: link.sources });
  }
  return { items };
}

/**
 * So hai danh sách. Quan hệ đọc từ JSON (file template, hoặc khối schema trong
 * file Liquid) được so theo FILE chứ không theo dòng: JSON.parse không giữ vị
 * trí, nên công cụ không có số dòng cho quan hệ từ file JSON, và với quan hệ
 * từ schema nó ghi dòng mở đầu của khối schema chứ không phải dòng khai.
 */
function match(items, hits) {
  const matchedHits = new Set();
  const toolOnly = [];
  let matched = 0;

  for (const item of items) {
    const byFile = item.line === 0 || (item.sources ?? "").split(",").includes("schema");
    const found = hits.map((hit, index) => ({ hit, index })).filter(({ hit }) => hit.file === item.file && (byFile || hit.line === item.line));
    if (found.length === 0) toolOnly.push(item);
    else {
      matched++;
      for (const { index } of found) matchedHits.add(index);
    }
  }
  return { matched, toolOnly, grepOnly: hits.filter((_, index) => !matchedHits.has(index)) };
}

function run() {
  const theme = path.resolve(options.theme);
  const { cases, seed } = JSON.parse(readFileSync(options.cases, "utf8"));
  const files = textFiles(theme);
  const results = [];

  for (const entry of cases) {
    if (entry.target === null) {
      results.push({ ...entry, skipped: "công cụ không khẳng định gì thuộc loại này trên theme này" });
      continue;
    }

    if (entry.kind === "template") {
      // Phép dò: đọc thẳng file JSON và liệt kê type của từng section.
      const data = readThemeJson(path.join(theme, entry.target));
      const types = Object.values(data.sections ?? {}).map((section) => section.type);
      const expected = [...new Set(types)].map((type) => `sections/${type}.liquid`).filter((file) => existsSync(path.join(theme, file))).sort();
      const outside = [...new Set(types)].filter((type) => !existsSync(path.join(theme, `sections/${type}.liquid`)));
      const context = tool(theme, "context", entry.target);
      const claimed = (context.uses ?? []).filter((link) => link.kind === "section").map((link) => link.id).sort();
      results.push({
        ...entry,
        matched: expected.filter((file) => claimed.includes(file)).length,
        toolOnly: claimed.filter((file) => !expected.includes(file)).map((file) => ({ file, line: 0 })),
        grepOnly: expected.filter((file) => !claimed.includes(file)).map((file) => ({ file, line: 0, text: "khai trong file JSON của template" })),
        note: outside.length > 0 ? `type không ứng với file nào trong sections/: ${outside.join(", ")}` : "",
      });
      continue;
    }

    if (entry.kind === "dead") {
      // Công cụ nói file này không ai dùng: phép dò không được thấy tên nó ở file nào khác.
      const hits = grep(
        theme,
        files.filter((file) => !file.startsWith("locales/")),
        tokenPattern({ kind: entry.target.split("/")[0].replace(/s$/, ""), target: entry.target }),
        entry.target,
      );
      results.push({ ...entry, matched: hits.length === 0 ? 1 : 0, toolOnly: [], grepOnly: hits });
      continue;
    }

    if (entry.kind === "broken") {
      results.push({ ...entry, ...checkBroken(theme, entry.ref) });
      continue;
    }

    const answer = toolItems(theme, entry);
    // Phạm vi dò, tuỳ loại đối tượng:
    //   - setting: chỉ file khai nó mới đọc được nó trực tiếp; nơi khác cùng tên là setting khác.
    //     Bỏ các dòng của schema trỏ tới khoá dịch ("t:sections.x.settings.<id>.label"): đó là
    //     nhãn hiện trong theme editor, không phải lần đọc setting.
    //   - file (snippet, section, block, asset): không dò trong locales/. File dịch chỉ chứa
    //     khoá và câu chữ; một khoá trùng tên với một section không phải là lời gọi section đó.
    //   - khoá dịch: dò mọi file.
    const isFile = entry.kind !== "setting" && entry.kind !== "translation";
    const scope = entry.kind === "setting" ? [entry.file] : isFile ? files.filter((file) => !file.startsWith("locales/")) : files;
    const skip = isFile ? entry.target : null;
    const hits = grep(theme, scope, tokenPattern(entry), skip).filter((hit) => entry.kind !== "setting" || !hit.text.includes('"t:'));
    results.push({ ...entry, ...(answer.failed === undefined ? {} : { toolFailed: answer.failed }), ...match(answer.items, hits) });
  }

  writeFileSync(options.out, `${JSON.stringify({ theme, seed, results }, null, 2)}\n`);

  for (const result of results) {
    console.log(`\n#${result.n} ${result.kind}: ${result.target}`);
    if (result.skipped) {
      console.log(`   bỏ qua: ${result.skipped}`);
      continue;
    }
    if (result.toolFailed) console.log(`   CÔNG CỤ BÁO LỖI: ${result.toolFailed}`);
    console.log(`   khớp ${result.matched}; chỉ công cụ ${result.toolOnly.length}; chỉ phép dò ${result.grepOnly.length}${result.note ? `; ${result.note}` : ""}`);
    for (const item of result.toolOnly) console.log(`   [chỉ công cụ] ${item.file}:${item.line} ${item.type ?? ""} ${item.sources ?? ""}`);
    for (const hit of result.grepOnly) console.log(`   [chỉ phép dò] ${hit.file}:${hit.line}  ${hit.text}`);
  }
}

/** Công cụ nói một tham chiếu trỏ tới thứ không có: tự kiểm xem thứ đó có thật không có không. */
function checkBroken(theme, ref) {
  let exists;
  let how;

  if (ref.kind === "asset") {
    exists = existsSync(path.join(theme, "assets", ref.to));
    how = `tìm file assets/${ref.to}`;
  } else if (ref.kind === "translation") {
    exists = translationKeys(theme).includes(ref.to);
    how = "tìm khoá trong file dịch mặc định";
  } else if (ref.kind === "setting") {
    const [scope, , id] = ref.to.split(".");
    if (scope === "settings") {
      const globalId = ref.to.split(".")[1];
      const schema = readThemeJson(path.join(theme, "config", "settings_schema.json"));
      exists = schema.some((group) => (group.settings ?? []).some((setting) => setting.id === globalId));
      how = `tìm "id": "${globalId}" trong config/settings_schema.json`;
    } else {
      // block.settings.<id> đọc trong một section có thể là setting của một block
      // cục bộ, khai trong "blocks" của schema chứ không ở "settings" cấp cao nhất.
      const schema = schemaOf(theme, ref.from);
      const declared = [
        ...(schema?.settings ?? []),
        ...(scope === "block" ? (schema?.blocks ?? []).flatMap((block) => block.settings ?? []) : []),
      ];
      exists = declared.some((setting) => setting.id === id);
      how = `tìm "id": "${id}" trong schema của ${ref.from}`;
    }
  } else {
    const dir = ref.kind === "section" ? "sections" : ref.kind === "block" ? "blocks" : "snippets";
    exists = existsSync(path.join(theme, dir, `${ref.to}.liquid`));
    how = `tìm file ${dir}/${ref.to}.liquid`;
  }

  const source = readFileSync(path.join(theme, ref.from), "utf8").split("\n")[ref.line - 1]?.trim().slice(0, 160) ?? "";
  return {
    matched: exists ? 0 : 1,
    toolOnly: exists ? [{ file: ref.from, line: ref.line, type: "tham chiếu bị báo hỏng nhưng đích có tồn tại" }] : [],
    grepOnly: [],
    note: `${how}: ${exists ? "CÓ" : "không có"}. Dòng nguồn: ${source}`,
  };
}

// ---- report: gộp kết quả với phần phân xử ----

function report() {
  const verdicts = options.verdicts === undefined ? [] : JSON.parse(readFileSync(options.verdicts, "utf8"));
  // Một mục phân xử áp cho đúng một chỗ (file + line), hoặc cho mọi chỗ của
  // trường hợp đó có đường dẫn khớp biểu thức `files` (khi cả nhóm cùng một lý do).
  const verdictOf = (theme, n, side, item) =>
    verdicts.find(
      (entry) =>
        entry.theme === theme &&
        entry.case === n &&
        entry.side === side &&
        (entry.files !== undefined ? new RegExp(entry.files).test(item.file) : entry.file === item.file && entry.line === item.line),
    );

  const total = { cases: 0, truePositive: 0, falsePositive: 0, falseNegative: 0, notReference: 0, open: 0 };
  const lines = [];

  for (const file of positionals) {
    const { theme, seed, results } = JSON.parse(readFileSync(file, "utf8"));
    const name = path.basename(theme);
    lines.push(`\n### ${name} (hạt giống "${seed}")\n`);
    lines.push("| # | Loại | Đối tượng | Khớp | Chỉ công cụ | Chỉ phép dò | Sau phân xử |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");

    for (const result of results) {
      if (result.skipped) {
        lines.push(`| ${result.n} | ${result.kind} | (không có) | | | | bỏ qua: ${result.skipped} |`);
        continue;
      }
      total.cases++;
      let truePositive = result.matched;
      let falsePositive = 0;
      let falseNegative = 0;
      let notReference = 0;
      let open = 0;

      for (const item of result.toolOnly) {
        const verdict = verdictOf(name, result.n, "tool", item)?.verdict;
        if (verdict === "đúng") truePositive++;
        else if (verdict === "sai") falsePositive++;
        else open++;
      }
      for (const hit of result.grepOnly) {
        const verdict = verdictOf(name, result.n, "grep", hit)?.verdict;
        if (verdict === "sót") falseNegative++;
        else if (verdict === "không phải lời gọi") notReference++;
        else open++;
      }

      total.truePositive += truePositive;
      total.falsePositive += falsePositive;
      total.falseNegative += falseNegative;
      total.notReference += notReference;
      total.open += open;

      const after = [`đúng ${truePositive}`, falsePositive > 0 ? `**bịa ${falsePositive}**` : "", falseNegative > 0 ? `**sót ${falseNegative}**` : "", notReference > 0 ? `phép dò bắt nhầm ${notReference}` : "", open > 0 ? `CHƯA PHÂN XỬ ${open}` : ""]
        .filter((text) => text !== "")
        .join(", ");
      lines.push(`| ${result.n} | ${result.kind} | \`${result.target}\` | ${result.matched} | ${result.toolOnly.length} | ${result.grepOnly.length} | ${after} |`);
    }
  }

  const precision = total.truePositive / (total.truePositive + total.falsePositive);
  const recall = total.truePositive / (total.truePositive + total.falseNegative);
  const percent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "không tính được");

  console.log(`Số trường hợp: ${total.cases}. Quan hệ đúng: ${total.truePositive}; công cụ bịa: ${total.falsePositive}; công cụ sót: ${total.falseNegative}; phép dò bắt nhầm: ${total.notReference}; chưa phân xử: ${total.open}.`);
  console.log(`Tỉ lệ đúng (precision): ${percent(precision)}. Tỉ lệ tìm đủ (recall): ${percent(recall)}.`);
  console.log(lines.join("\n"));
}

if (command === "pick") pick();
else if (command === "run") run();
else if (command === "report") report();
else {
  console.error("Dùng: node tools/accept/cross-check.mjs pick|run|report ... (xem chú thích ở đầu file)");
  process.exit(2);
}
