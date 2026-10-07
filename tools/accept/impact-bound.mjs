// Kiểm kết quả của `themegraph impact` ở mức TRANG bằng một cận trên dựng độc
// lập với ThemeGraph.
//
// `cross-check.mjs` chỉ kiểm quan hệ trực tiếp (ai gọi file này). Câu hỏi chính
// của công cụ lại là quan hệ bắc cầu: sửa file này thì TRANG nào bị ảnh hưởng.
// Script này dựng một "đồ thị nhắc tên" hoàn toàn bằng tìm chuỗi:
//
//   file A nhắc tới file B  <=>  nội dung của A có tên của B viết trong dấu nháy
//
// rồi đi ngược từ file đang xét lên tới các template. Vì "nhắc tên" rộng hơn
// "gọi" (tên có thể nằm trong chú thích, hoặc là một chuỗi trùng tên), tập
// trang thu được là một CẬN TRÊN của đáp án đúng. Từ đó có hai phép kiểm:
//
//   - Trang nào công cụ báo mà cận trên không có: công cụ bịa ra một đường đi.
//     Phải bằng 0.
//   - Trang nào cận trên có mà công cụ không báo: in kèm đường nhắc tên ngắn
//     nhất, để một người xem đó là lời gọi thật (công cụ sót) hay chỉ là trùng
//     tên.
//
// Một đường nhắc tên bị bác (ví dụ "type": "header" trong schema là KIỂU của
// một setting, không phải lời gọi section header) chưa đủ để kết luận trang đó
// không dùng file: có thể còn đường khác. Vì vậy cách làm là lặp: ghi cạnh bị
// bác vào file --false kèm lý do, chạy lại, xem đường còn lại; tới khi trang
// biến mất khỏi cận trên, hoặc còn một đường mà mọi cạnh đều là lời gọi thật
// (khi đó công cụ đã sót).
//
// Không tính ở đây: trang mà công cụ ghi "qua JavaScript" (file JavaScript
// không nằm trong đồ thị nhắc tên).
//
// Dùng: node tools/accept/impact-bound.mjs --theme <thư mục> [--false <quy-tắc-bác.json>]... <file> [<file> ...]
// (--false lặp lại được: một file quy tắc chung và một file riêng của theme)
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: options, positionals: targets } = parseArgs({
  allowPositionals: true,
  options: { theme: { type: "string" }, bin: { type: "string", default: "themegraph" }, false: { type: "string", multiple: true } },
});
const theme = path.resolve(options.theme);
const quote = (text) => (/[\s"&|<>^]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- các file tham gia vào việc dựng một trang ----
const DIRS = ["layout", "templates", "sections", "snippets", "blocks"];
const files = readdirSync(theme, { recursive: true, withFileTypes: true })
  .filter((item) => item.isFile() && /\.(liquid|json)$/.test(item.name))
  .map((item) => path.relative(theme, path.join(item.parentPath, item.name)).replaceAll("\\", "/"))
  .filter((file) => DIRS.includes(file.split("/")[0]))
  .sort();
const content = new Map(files.map((file) => [file, readFileSync(path.join(theme, file), "utf8")]));

/** Tên dùng để gọi một file: tên file không có thư mục và đuôi. Template và layout không được gọi bằng tên kiểu này. */
const nameOf = (file) => path.basename(file).replace(/\.(liquid|json)$/, "");
const callable = files.filter((file) => !file.startsWith("templates/") && !file.startsWith("layout/"));

// Các lần nhắc tên đã được một người xem và bác, kèm lý do. Mỗi quy tắc bác
// những DÒNG khớp nó, không bác cả cạnh: một file có thể nhắc tên B ở dòng 5
// như một chuỗi vô can và ở dòng 90 bằng một lời gọi thật, và cạnh A → B chỉ
// mất khi mọi dòng của nó đều bị bác.
//
//   { "from": "<biểu thức khớp đường dẫn file nhắc>",
//     "to": "<file được nhắc>",            (bỏ trống: áp cho mọi file được nhắc)
//     "text": "<biểu thức khớp nội dung dòng>",
//     "reason": "..." }
//
// Trong "text", {name} được thay bằng tên của file được nhắc. Nhờ đó một quy
// tắc tả được một VỊ TRÍ CÚ PHÁP không bao giờ là lời gọi, ví dụ
// "== '{name}'" (so sánh với một chuỗi), cho mọi tên.
const ruleFiles = options.false ?? [];
const rules = ruleFiles.flatMap((file) => JSON.parse(readFileSync(file, "utf8"))).map((rule) => ({
  ...rule,
  fromPattern: new RegExp(rule.from),
  compiled: new Map(),
  used: 0,
}));
const textPattern = (rule, name) => {
  if (!rule.compiled.has(name)) rule.compiled.set(name, new RegExp(rule.text.replaceAll("{name}", escapeRegExp(name))));
  return rule.compiled.get(name);
};

// mentions.get("A\nB") = các dòng trong A nhắc tên B mà chưa bị bác.
const mentions = new Map();
const addMention = (from, to, line, text) => {
  const rule = rules.find((entry) => (entry.to === undefined || entry.to === to) && entry.fromPattern.test(from) && textPattern(entry, nameOf(to)).test(text));
  if (rule !== undefined) {
    rule.used++;
    return;
  }
  const key = `${from}\n${to}`;
  mentions.set(key, [...(mentions.get(key) ?? []), { line, text }]);
};

for (const target of callable) {
  const pattern = new RegExp(`(?<![\\w/-])['"]${escapeRegExp(nameOf(target))}(\\.liquid)?['"]`);
  for (const [file, text] of content) {
    if (file === target) continue;
    text.split("\n").forEach((line, index) => {
      // Quy tắc bác được thử trên CẢ dòng; chỉ lúc in ra mới cắt ngắn.
      if (pattern.test(line)) addMention(file, target, index + 1, line.trim());
    });
  }
}

// Layout của từng template, đọc thẳng từ file: template JSON khai "layout" ở
// cấp cao nhất (một tên, hoặc false là không dùng layout); template Liquid
// dùng tag layout; không khai gì thì là layout/theme.liquid.
for (const template of files.filter((file) => file.startsWith("templates/"))) {
  const text = content.get(template);
  let layout = "theme";
  if (template.endsWith(".json")) {
    // Bỏ khối chú thích ở đầu và các dòng chú thích, rồi đọc khoá "layout" ở cấp cao nhất.
    const declared = JSON.parse(text.replace(/^﻿/, "").replace(/^\s*\/\*[\s\S]*?\*\//, "").replace(/^\s*\/\/.*$/gm, "")).layout;
    if (declared === false) layout = null;
    else if (typeof declared === "string") layout = declared;
  } else {
    const tag = /\{%-?\s*layout\s+(none|['"]([^'"]+)['"])/.exec(text);
    if (tag !== null) layout = tag[1] === "none" ? null : tag[2];
  }
  const file = `layout/${layout}.liquid`;
  if (layout !== null && content.has(file)) addMention(template, file, 0, `layout "${layout}"`);
}

// mentionedBy.get(B) = các file còn ít nhất một dòng nhắc tên B.
const mentionedBy = new Map(files.map((file) => [file, []]));
const where = new Map();
for (const [key, lines] of mentions) {
  const [from, to] = key.split("\n");
  mentionedBy.get(to).push(from);
  where.set(key, `dòng ${lines[0].line}: ${lines[0].text.slice(0, 110)}${lines.length > 1 ? ` (và ${lines.length - 1} dòng khác)` : ""}`);
}

/** Tên loại trang của một template: templates/customers/login.json -> customers/login; product.alt.json -> product. */
function pageOf(template) {
  const relative = template.slice("templates/".length);
  const dir = relative.includes("/") ? `${relative.slice(0, relative.lastIndexOf("/"))}/` : "";
  return dir + path.basename(relative).split(".")[0];
}

/** Các trang mà theo đồ thị nhắc tên có thể đi tới `target`, kèm một đường đi ngắn nhất cho mỗi trang. */
function boundPages(target) {
  const cameFrom = new Map([[target, null]]);
  const queue = [target];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const mentioner of mentionedBy.get(file) ?? []) {
      if (cameFrom.has(mentioner)) continue;
      cameFrom.set(mentioner, file);
      queue.push(mentioner);
    }
  }

  const pages = new Map();
  for (const file of cameFrom.keys()) {
    if (!file.startsWith("templates/")) continue;
    const chain = [];
    for (let step = file; step !== null; step = cameFrom.get(step)) chain.push(step);
    const page = pageOf(file);
    if (!pages.has(page) || chain.length < pages.get(page).length) pages.set(page, chain);
  }
  return pages;
}

let invented = 0;
let unexplained = 0;
let agreed = 0;

for (const target of targets) {
  const result = spawnSync([quote(options.bin), "impact", quote(target), "-t", quote(theme), "--json"].join(" "), { shell: true, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    console.log(`\n${target}: công cụ báo lỗi: ${result.stderr.trim().split("\n")[0]}`);
    continue;
  }
  const impact = JSON.parse(result.stdout);
  const claimed = impact.pages.filter((page) => !page.scriptOnly).map((page) => page.id.replace("page:", "")).sort();
  const viaScript = impact.pages.filter((page) => page.scriptOnly).map((page) => page.id.replace("page:", ""));
  const bound = boundPages(target);

  const toolOnly = claimed.filter((page) => !bound.has(page));
  const boundOnly = [...bound.keys()].filter((page) => !claimed.includes(page)).sort();
  invented += toolOnly.length;
  unexplained += boundOnly.length;
  agreed += claimed.length - toolOnly.length;

  console.log(`\n${target}`);
  console.log(`  công cụ: ${claimed.length} trang${viaScript.length > 0 ? ` (và ${viaScript.length} trang chỉ qua JavaScript, không kiểm ở đây)` : ""}; cận trên: ${bound.size} trang; trùng nhau: ${claimed.length - toolOnly.length}`);
  for (const page of toolOnly) console.log(`  [CÔNG CỤ BÁO, CẬN TRÊN KHÔNG CÓ] ${page}`);
  for (const page of boundOnly) {
    const chain = bound.get(page);
    console.log(`  [chỉ cận trên có] ${page}`);
    // In từng cạnh của đường đi kèm dòng nhắc tên, để phân xử mà không phải mở file.
    for (let i = 0; i + 1 < chain.length; i++) console.log(`      ${chain[i]} → ${chain[i + 1]}   (${where.get(`${chain[i]}\n${chain[i + 1]}`)})`);
  }
}

console.log(`\nTổng: ${agreed} trang hai bên cùng có; ${invented} trang công cụ báo mà cận trên không có; ${unexplained} trang chỉ cận trên có (cần xem).`);
console.log(`Số dòng nhắc tên đã bị bác: ${rules.reduce((total, rule) => total + rule.used, 0)}, theo ${rules.length} quy tắc.`);
for (const rule of rules.filter((entry) => entry.used > 0)) console.log(`  ${String(rule.used).padStart(5)} dòng  ${rule.to ?? "(mọi file)"}  /${rule.text}/`);
