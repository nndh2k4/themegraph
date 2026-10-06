// Đối chứng có / không có ThemeGraph, bản lặp lại.
//
// Khác bản đầu (accept.cjs) ở ba điểm:
//   - Hai nhánh được dựng bằng cờ của `claude`, không đụng cấu hình thật:
//       co     --strict-mcp-config --mcp-config <chỉ themegraph>
//       khong  --strict-mcp-config (không MCP server nào)
//     Cả hai đều có --disable-slash-commands: không skill nào được nạp, kể cả
//     skill của công cụ khác trên máy (thứ đã làm nhiễu nhánh "không" ở bản đầu).
//     Vậy nhánh "co" đo MCP server cùng lời dặn lúc bắt tay, KHÔNG đo skill.
//   - Mỗi câu chạy nhiều lần.
//   - Điểm được chấm bằng máy theo thang viết sẵn trong questions.json: số mục
//     trong đáp án mà câu trả lời có nhắc tới.
//
// Dùng (đứng ở gốc repo):
//   node tools/accept/run-compare.cjs <số lần lặp> <dawn=đường dẫn> <purity=đường dẫn> [id câu hỏi ...]
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const [repeatArg, ...rest] = process.argv.slice(2);
const repeats = Number(repeatArg);
const themes = Object.fromEntries(rest.filter((arg) => arg.includes("=")).map((arg) => arg.split(/=(.*)/s).slice(0, 2)));
const only = rest.filter((arg) => !arg.includes("="));

const { questions } = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));
const outDir = path.resolve(process.env.ACCEPT_OUT ?? "accept-out");
fs.mkdirSync(outDir, { recursive: true });

// Cấu hình MCP chỉ có themegraph, trỏ tới bản đã build của repo này.
const mcpConfig = path.join(os.tmpdir(), "themegraph-only.mcp.json");
fs.writeFileSync(
  mcpConfig,
  JSON.stringify({
    mcpServers: {
      themegraph: {
        command: process.execPath,
        args: [path.join(__dirname, "..", "..", "packages", "cli", "dist", "cli.js"), "mcp"],
      },
    },
  }),
);

const ARMS = {
  co: ["--strict-mcp-config", "--mcp-config", mcpConfig, "--allowedTools", "mcp__themegraph"],
  khong: ["--strict-mcp-config"],
};

/** Mục `item` có được nhắc tới trong câu trả lời không. */
function mentioned(item, answer) {
  const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Mặc định: tên đứng trong dấu `, hoặc ngay sau một dấu / hay \ (đường dẫn), có
  // thể kèm đuôi .liquid. Tránh khớp nhầm các tên là từ thường như "page".
  const pattern = item.match ?? `\`${escaped}(\\.liquid)?\`|[/\\\\]${escaped}(\\.liquid)?(?![\\w-])`;
  return new RegExp(pattern, "i").test(answer);
}

// Model dùng cho MỌI lượt của một đợt. Ghim lại để tài khoản có đổi model mặc
// định giữa chừng thì lượt chạy thất bại rõ ràng, thay vì lặng lẽ chạy bằng
// model khác và cho ra số liệu không so được.
const MODEL = process.env.ACCEPT_MODEL ?? "claude-opus-5-5";

function runOnce(question, arm, repeat) {
  const label = `${question.id}-${arm}-${repeat}`;
  const cwd = themes[question.theme];
  const started = Date.now();
  const run = spawnSync(
    "claude",
    [
      "-p",
      question.question,
      "--model",
      MODEL,
      "--output-format",
      "stream-json",
      "--verbose",
      "--disable-slash-commands",
      ...ARMS[arm],
    ],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000 },
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  fs.writeFileSync(path.join(outDir, `${label}.jsonl`), run.stdout ?? "");

  const calls = [];
  let answer = "";
  let cost = null;
  let servers = "";
  const models = new Set();
  for (const line of (run.stdout ?? "").split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init") {
      servers = (event.mcp_servers ?? []).map((s) => `${s.name}:${s.status}`).join(", ");
    }
    if (event.type === "assistant") {
      if (event.message?.model) models.add(event.message.model);
      for (const block of event.message?.content ?? []) {
        if (block.type === "tool_use") calls.push(block.name);
      }
    }
    if (event.type === "result") {
      answer = event.result ?? "";
      cost = event.total_cost_usd ?? null;
    }
  }

  const hit = question.expected.filter((item) => mentioned(item, answer)).map((item) => item.name);
  const missed = question.expected.filter((item) => !hit.includes(item.name)).map((item) => item.name);
  const bonus = (question.bonus ?? []).filter((item) => mentioned(item, answer)).map((item) => item.name);

  const result = {
    label,
    id: question.id,
    arm,
    repeat,
    seconds,
    calls: calls.length,
    themegraphCalls: calls.filter((name) => name.startsWith("mcp__themegraph__")).length,
    cost,
    servers,
    models: [...models],
    score: hit.length,
    outOf: question.expected.length,
    missed,
    bonus,
    exit: run.status,
  };

  fs.writeFileSync(
    path.join(outDir, `${label}.md`),
    [
      `## ${label}`,
      `Câu hỏi: ${question.question}`,
      `MCP: ${servers || "(không có)"}`,
      `Model: ${[...models].join(", ") || "(không rõ)"}`,
      `Thời gian: ${seconds} giây; ${calls.length} lời gọi tool (${calls.join(", ")})`,
      `Điểm: ${hit.length}/${question.expected.length}; sót: ${missed.join(", ") || "không"}; điểm cộng: ${bonus.join(", ") || "không"}`,
      "Câu trả lời:",
      answer,
    ].join("\n"),
  );
  console.log(
    `${label.padEnd(26)} ${String(seconds).padStart(4)} s  ${String(calls.length).padStart(2)} lời gọi  ${hit.length}/${question.expected.length}${bonus.length ? ` +${bonus.length}` : ""}  $${(cost ?? 0).toFixed(3)}${run.status === 0 ? "" : `  [mã thoát ${run.status}]`}`,
  );
  return result;
}

const results = [];
for (const question of questions) {
  if (only.length > 0 && !only.includes(question.id)) continue;
  // Xen kẽ hai nhánh trong từng lần lặp, để tình trạng máy và mạng ảnh hưởng đều.
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const arm of Object.keys(ARMS)) results.push(runOnce(question, arm, repeat));
  }
}
fs.writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
