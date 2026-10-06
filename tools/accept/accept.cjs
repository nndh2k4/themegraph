// Nghiệm thu: chạy `claude -p` với một câu hỏi trong thư mục theme, đọc luồng
// sự kiện để biết agent gọi tool nào, rồi in tóm tắt và ghi bản đầy đủ ra file.
//
// Dùng: node accept.cjs <nhãn> <thư mục theme> "<câu hỏi>"
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const [label, cwd, prompt] = process.argv.slice(2);
// Nơi ghi kết quả: biến ACCEPT_OUT, hoặc ./accept-out ở thư mục đang đứng.
const outDir = path.resolve(process.env.ACCEPT_OUT ?? "accept-out");
fs.mkdirSync(outDir, { recursive: true });

const started = Date.now();
const run = spawnSync(
  "claude",
  [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    // Chỉ cấp QUYỀN gọi tool của themegraph (ở chế độ -p không có ai bấm
    // "cho phép"). Đây không phải gợi ý: câu hỏi không nhắc tới tool nào, và
    // các tool đọc file có sẵn (Read, Grep, Glob) vẫn dùng được như thường.
    "--allowedTools",
    "mcp__themegraph",
  ],
  { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000 },
);
const seconds = Math.round((Date.now() - started) / 1000);

fs.writeFileSync(path.join(outDir, `${label}.jsonl`), run.stdout ?? "");

const calls = [];
let answer = "";
let cost = null;
let turns = null;
let mcpStatus = null;
let skills = null;

for (const line of (run.stdout ?? "").split("\n")) {
  if (line.trim() === "") continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }
  if (event.type === "system" && event.subtype === "init") {
    mcpStatus = (event.mcp_servers ?? []).map((s) => `${s.name}:${s.status}`).join(", ");
    skills = (event.skills ?? []).includes("themegraph");
  }
  if (event.type === "assistant") {
    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use") {
        const input = JSON.stringify(block.input);
        calls.push(`${block.name} ${input.length > 140 ? input.slice(0, 140) + "…" : input}`);
      }
    }
  }
  if (event.type === "result") {
    answer = event.result ?? "";
    cost = event.total_cost_usd ?? null;
    turns = event.num_turns ?? null;
  }
}

const summary = [
  `## ${label}`,
  `Thư mục: ${cwd}`,
  `Câu hỏi: ${prompt}`,
  `MCP: ${mcpStatus}`,
  `Skill themegraph được nạp: ${skills}`,
  `Thời gian: ${seconds} giây, ${turns} lượt, chi phí quy đổi ${cost === null ? "?" : "$" + cost.toFixed(3)}`,
  `Tool đã gọi (${calls.length}):`,
  ...calls.map((call, index) => `  ${index + 1}. ${call}`),
  "Câu trả lời:",
  answer,
  run.status === 0 ? "" : `[mã thoát ${run.status}] ${run.stderr ?? ""} ${run.error ?? ""}`,
].join("\n");

fs.writeFileSync(path.join(outDir, `${label}.md`), summary);
console.log(summary);
