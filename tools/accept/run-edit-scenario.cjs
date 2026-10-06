// Kịch bản "agent sửa file rồi hỏi lại": đồ thị cũ đi ngay sau khi agent sửa,
// và MCP server chỉ CẢNH BÁO chứ không tự phân tích lại. Câu hỏi cần trả lời:
// agent có tự chạy `themegraph analyze` trước khi tin kết quả không?
//
// Chạy trên một BẢN SAO của theme (không bao giờ sửa theme thật), mỗi lượt một
// bản sao mới. Bản sao được phân tích trước, và gỡ khỏi sổ đăng ký khi xong.
//
// Dùng: node tools/accept/run-edit-scenario.cjs <thư mục Dawn> [skill|khong-skill ...]
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const [source, ...armArgs] = process.argv.slice(2);
const arms = armArgs.length > 0 ? armArgs : ["skill", "khong-skill"];
const MODEL = process.env.ACCEPT_MODEL ?? "claude-opus-5-5";
const outDir = path.resolve(process.env.ACCEPT_OUT ?? "accept-out");
const cli = path.join(__dirname, "..", "..", "packages", "cli", "dist", "cli.js");
fs.mkdirSync(outDir, { recursive: true });

const mcpConfig = path.join(outDir, "mcp-themegraph.json");
fs.writeFileSync(
  mcpConfig,
  JSON.stringify({ mcpServers: { themegraph: { command: process.execPath, args: [cli, "mcp"] } } }),
);

const PROMPT =
  "Trong sections/main-cart-footer.liquid, thêm dòng {% render 'card-product', card_product: cart.items.first.product %} " +
  "ngay trước thẻ {% schema %}. Sau khi sửa xong, cho tôi biết: với thay đổi đó, sửa snippets/card-product.liquid " +
  "sẽ ảnh hưởng những loại trang nào?";

// Trước khi sửa: collection, index, product, search. Sau khi sửa có thêm cart.
const BEFORE = ["collection", "index", "product", "search"];

const themegraph = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });

for (const arm of arms) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "themegraph-edit-"));
  const theme = path.join(copy, "dawn");
  for (const dir of ["assets", "config", "layout", "locales", "sections", "snippets", "templates"]) {
    fs.cpSync(path.join(source, dir), path.join(theme, dir), { recursive: true });
  }
  themegraph(["analyze", theme], copy);

  const started = Date.now();
  const run = spawnSync(
    "claude",
    [
      "-p",
      PROMPT,
      "--model",
      MODEL,
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
      "--mcp-config",
      mcpConfig,
      // Quyền để sửa file và chạy lại analyze; không phải gợi ý.
      "--allowedTools",
      "mcp__themegraph,Edit,Read,Bash(themegraph analyze:*),Bash(themegraph status:*)",
      ...(arm === "skill" ? [] : ["--disable-slash-commands"]),
    ],
    { cwd: theme, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000 },
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  fs.writeFileSync(path.join(outDir, `edit-${arm}.jsonl`), run.stdout ?? "");

  const calls = [];
  const models = new Set();
  let answer = "";
  let cost = 0;
  for (const line of (run.stdout ?? "").split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "assistant") {
      if (event.message?.model) models.add(event.message.model);
      for (const block of event.message?.content ?? []) {
        if (block.type !== "tool_use") continue;
        // Trên Windows agent có thể chạy lệnh bằng PowerShell thay cho Bash.
        const isShell = block.name === "Bash" || block.name === "PowerShell";
        const detail = isShell ? `: ${String(block.input?.command ?? "").slice(0, 80)}` : "";
        calls.push(block.name + detail);
      }
    }
    if (event.type === "result") {
      answer = event.result ?? "";
      cost = event.total_cost_usd ?? 0;
    }
  }

  const edited = fs.readFileSync(path.join(theme, "sections", "main-cart-footer.liquid"), "utf8").includes("render 'card-product'");
  const status = themegraph(["status", "--json", "-t", theme], copy);
  const stale = (() => {
    try {
      return JSON.parse(status.stdout).stale;
    } catch {
      return null;
    }
  })();
  const reanalyzed = calls.some((call) => /themegraph analyze/.test(call));
  const mentionsCart = /(`|\b)cart(`|\b)/i.test(answer);
  const firstImpact = calls.findIndex((call) => call.startsWith("mcp__themegraph__impact"));
  const analyzeAt = calls.findIndex((call) => /themegraph analyze/.test(call));

  const summary = [
    `## edit-${arm}`,
    `Model: ${[...models].join(", ")}`,
    `Thời gian: ${seconds} giây; chi phí quy đổi $${cost.toFixed(3)}`,
    `Tool đã gọi (${calls.length}): ${calls.join(" | ")}`,
    `File đã được sửa: ${edited}`,
    `Agent chạy "themegraph analyze": ${reanalyzed}${reanalyzed && firstImpact >= 0 ? ` (${analyzeAt < firstImpact ? "trước" : "sau"} lần gọi impact đầu tiên)` : ""}`,
    `Đồ thị còn cũ khi agent trả lời: ${stale}`,
    `Câu trả lời có nêu trang cart: ${mentionsCart}; có đủ bốn trang cũ: ${BEFORE.every((page) => answer.includes(page))}`,
    "Câu trả lời:",
    answer,
  ].join("\n");
  fs.writeFileSync(path.join(outDir, `edit-${arm}.md`), summary);
  console.log(summary.split("\nCâu trả lời:")[0] + "\n");

  themegraph(["clean", "--theme", theme], copy);
  fs.rmSync(copy, { recursive: true, force: true });
}
