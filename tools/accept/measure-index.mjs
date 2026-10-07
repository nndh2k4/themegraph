// Đo thời gian phân tích và thời gian trả lời của lệnh `themegraph` trên một
// hoặc nhiều theme, đúng như người dùng thấy: mỗi lần đo là một lần chạy lệnh
// thật, trong một tiến trình riêng.
//
// Hai điều script này KHÔNG làm được, và báo cáo phải nói rõ:
//   - Nó không xoá được bộ nhớ đệm file của hệ điều hành. Lần phân tích đầu
//     tiên sau khi máy nghỉ lâu có thể chậm hơn nhiều so với các lần sau;
//     script ghi riêng lần đầu của loạt đo, nhưng lần đó chỉ "nguội" nếu trước
//     đó chưa ai đọc các file của theme.
//   - Thời gian của một lệnh gồm cả thời gian Node khởi động. Script đo thêm
//     `themegraph --version` làm mốc: đó là phần không liên quan tới theme.
//
// Dùng:
//   node tools/accept/measure-index.mjs [--runs 10] [--out kết-quả.json] <theme> [<theme> ...]
//
// Lệnh được đo là `themegraph` trên PATH; đặt --bin để đo lệnh khác.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: options, positionals: themes } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: "string", default: "10" },
    bin: { type: "string", default: "themegraph" },
    out: { type: "string" },
  },
});

if (themes.length === 0) {
  console.error("Dùng: node tools/accept/measure-index.mjs [--runs 10] [--out file.json] <theme> [<theme> ...]");
  process.exit(2);
}
const runs = Number(options.runs);
const QUERY_RUNS = 5;

const quote = (text) => (/[\s"&|<>^]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text);

/** Chạy lệnh một lần; trả thời gian của cả tiến trình (mili giây) và stdout. */
function time(...args) {
  const started = performance.now();
  const result = spawnSync([quote(options.bin), ...args.map(quote)].join(" "), { shell: true, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const ms = performance.now() - started;
  if (result.status !== 0) throw new Error(`"${args.join(" ")}" thoát với mã ${result.status}: ${result.stderr.trim().split("\n")[0]}`);
  return { ms, stdout: result.stdout };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value) => Math.round(value);

/** Số file và tổng dung lượng của các file mà analyze đọc nội dung (.liquid, .json, .js). */
function sourceSize(theme) {
  let files = 0;
  let bytes = 0;
  for (const item of readdirSync(theme, { recursive: true, withFileTypes: true })) {
    if (!item.isFile() || item.parentPath.split(path.sep).some((part) => part.startsWith("."))) continue;
    if (!/\.(liquid|json|js)$/.test(item.name)) continue;
    files++;
    bytes += statSync(path.join(item.parentPath, item.name)).size;
  }
  return { files, bytes };
}

const machine = {
  cpu: os.cpus()[0]?.model.trim() ?? "không rõ",
  cores: os.cpus().length,
  ramGb: Math.round(os.totalmem() / 1024 ** 3),
  os: `${os.type()} ${os.release()} ${os.arch()}`,
  node: process.version,
};

// Mốc: lệnh không đụng tới theme nào.
const baseline = median(Array.from({ length: QUERY_RUNS }, () => time("--version").ms));

const report = { measuredAt: new Date().toISOString(), machine, runs, baselineMs: round(baseline), themes: [] };

for (const themeArg of themes) {
  const theme = path.resolve(themeArg);
  const source = sourceSize(theme);

  // ---- analyze ----
  const processMs = [];
  const reportedMs = [];
  let stats;
  for (let i = 0; i < runs; i++) {
    const { ms, stdout } = time("analyze", theme, "--json");
    const result = JSON.parse(stdout);
    processMs.push(ms);
    reportedMs.push(result.durationMs);
    stats = result.stats;
  }

  // ---- truy vấn ----
  // File đại diện là file Liquid được nhiều nơi gọi nhất: đó là trường hợp
  // nặng nhất của impact và context.
  const overview = JSON.parse(time("overview", "-t", theme, "--json").stdout);
  const file = overview.mostUsed[0]?.id;
  const page = overview.pages.includes("product") ? "product" : overview.pages[0];

  const queries = {};
  const measure = (name, ...args) => {
    queries[name] = round(median(Array.from({ length: QUERY_RUNS }, () => time(...args, "-t", theme).ms)));
  };
  if (file !== undefined) {
    measure("impact", "impact", file);
    measure("context", "context", file);
  }
  if (page !== undefined) measure("render-flow", "render-flow", page);
  measure("search", "search", "card");
  measure("dead-code", "dead-code");
  measure("overview", "overview");
  measure("status", "status");
  measure("verify", "verify");

  report.themes.push({
    name: path.basename(theme),
    path: theme,
    sourceFiles: source.files,
    sourceKb: round(source.bytes / 1024),
    files: stats.files,
    nodes: stats.nodes,
    edges: stats.edges,
    graphDbKb: round(statSync(path.join(theme, ".themegraph", "graph.db")).size / 1024),
    analyze: {
      // Thời gian của cả tiến trình: thứ người dùng chờ.
      firstMs: round(processMs[0]),
      restMedianMs: round(median(processMs.slice(1))),
      restMinMs: round(Math.min(...processMs.slice(1))),
      restMaxMs: round(Math.max(...processMs.slice(1))),
      // Thời gian chính lệnh analyze tự báo (không gồm lúc Node khởi động).
      reportedFirstMs: reportedMs[0],
      reportedRestMedianMs: round(median(reportedMs.slice(1))),
    },
    queryFile: file ?? null,
    queryPage: page ?? null,
    queries,
  });
}

if (options.out !== undefined) writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);

// ---- in bảng ----
const table = (header, rows) => [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");

console.log(`Máy: ${machine.cpu}, ${machine.cores} luồng, ${machine.ramGb} GB RAM, ${machine.os}, Node ${machine.node}`);
console.log(`Mốc (themegraph --version): ${report.baselineMs} ms. Mỗi theme phân tích ${runs} lần; mỗi truy vấn chạy ${QUERY_RUNS} lần, lấy trung vị.\n`);

console.log(
  table(
    ["Theme", "File đọc", "Dung lượng", "Node", "Cạnh", "graph.db", "analyze lần đầu", "analyze các lần sau (trung vị, nhỏ nhất – lớn nhất)", "riêng phần phân tích"],
    report.themes.map((entry) => [
      entry.name,
      entry.sourceFiles,
      `${entry.sourceKb} KB`,
      entry.nodes,
      entry.edges,
      `${entry.graphDbKb} KB`,
      `${entry.analyze.firstMs} ms`,
      `${entry.analyze.restMedianMs} ms (${entry.analyze.restMinMs} – ${entry.analyze.restMaxMs})`,
      `${entry.analyze.reportedRestMedianMs} ms`,
    ]),
  ),
);

const names = [...new Set(report.themes.flatMap((entry) => Object.keys(entry.queries)))];
console.log(
  `\n${table(
    ["Truy vấn (ms, cả tiến trình)", ...report.themes.map((entry) => entry.name)],
    names.map((name) => [name, ...report.themes.map((entry) => entry.queries[name] ?? "")]),
  )}`,
);
console.log(`\nFile dùng cho impact và context: ${report.themes.map((entry) => `${entry.name}: ${entry.queryFile}`).join("; ")}`);
