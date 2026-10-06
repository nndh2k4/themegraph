// Phá tạm (mutation testing) bằng tay: sửa một chỗ trong mã nguồn, chạy test,
// xem test có đỏ không, rồi trả mã nguồn về như cũ. Chỗ nào sửa xong mà test
// vẫn xanh là chỗ test chưa kiểm.
//
// Dùng (đứng ở gốc repo):
//   node tools/mutate/mutate.cjs <danh-sách.json> [đường dẫn test ...]
//
// danh-sách.json: [[file, tên, chuỗi cũ, chuỗi mới], ...]
//
// Mỗi chỗ phá rơi vào đúng một loại:
//   bat       test đỏ: có ít nhất một test thất bại
//   bien-dich chỗ phá làm mã không biên dịch hay không nạp được (cũng coi là bị bắt)
//   LOT       test vẫn xanh: test chưa kiểm chỗ này
//   QUA-GIO   lượt chạy bị dừng vì quá giờ. KHÔNG phải là bị bắt: có thể chỗ
//             phá gây vòng lặp vô hạn, cũng có thể chỉ là máy đang bận.
//   KHONG-THAY chuỗi cũ không còn trong file (mã đã đổi từ khi viết danh sách)
//
// Bản đầu của công cụ này gộp QUA-GIO vào "bị bắt", nên con số của nó có thể
// đẹp hơn thật. Bản này tách riêng và ghi báo cáo ra file.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const [listPath, ...testPaths] = process.argv.slice(2);
if (!listPath) {
  console.error("Thiếu đường dẫn danh sách. Xem cách dùng ở đầu file.");
  process.exit(2);
}

const TIMEOUT_MS = Number(process.env.MUTATE_TIMEOUT_MS ?? 180_000);
const VITEST = path.join("node_modules", "vitest", "vitest.mjs");

const mutants = JSON.parse(fs.readFileSync(listPath, "utf8"));
const original = {};
for (const [file] of mutants) original[file] ??= fs.readFileSync(file, "utf8");

function restoreAll() {
  for (const file of Object.keys(original)) fs.writeFileSync(file, original[file]);
}
// Bị dừng giữa chừng (Ctrl+C) cũng phải trả mã nguồn về như cũ.
process.on("SIGINT", () => {
  restoreAll();
  process.exit(130);
});

/** Chạy test một lượt; trả về mã thoát, có quá giờ không, và dòng tổng kết. */
function runTests() {
  // Gọi thẳng vitest bằng node, không qua pnpm: pnpm có thể tự cài lại gói.
  const run = spawnSync(process.execPath, [VITEST, "run", ...testPaths], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  const summary = /^\s*Tests\s+(.*)$/m.exec(output)?.[1]?.trim() ?? "";
  const timedOut = run.error?.code === "ETIMEDOUT" || run.signal !== null;
  return { status: run.status, timedOut, summary };
}

const baseline = runTests();
if (baseline.timedOut || baseline.status !== 0) {
  console.error(`Test đang đỏ hoặc quá giờ TRƯỚC khi phá (${baseline.summary}); dừng lại.`);
  process.exit(1);
}
console.log(`Trước khi phá: ${baseline.summary}`);

const results = [];
try {
  for (const [file, name, from, to] of mutants) {
    let outcome;
    let summary = "";

    if (!original[file].includes(from)) {
      outcome = "KHONG-THAY";
    } else {
      fs.writeFileSync(file, original[file].replace(from, () => to));
      const run = runTests();
      fs.writeFileSync(file, original[file]);

      summary = run.summary;
      if (run.timedOut) outcome = "QUA-GIO";
      else if (run.status === 0) outcome = "LOT";
      else if (/failed/.test(run.summary)) outcome = "bat";
      else outcome = "bien-dich";
    }

    results.push({ file, name, outcome, summary });
    console.log(`${outcome.padEnd(10)} ${file} :: ${name}${summary ? ` | ${summary}` : ""}`);
  }
} finally {
  restoreAll();
}

const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
const totals = {
  tong: results.length,
  bat: count("bat"),
  bienDich: count("bien-dich"),
  lot: count("LOT"),
  quaGio: count("QUA-GIO"),
  khongThay: count("KHONG-THAY"),
};

const reportDir = path.join(path.dirname(listPath), "..", "reports");
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, path.basename(listPath));
fs.writeFileSync(reportPath, `${JSON.stringify({ tests: testPaths, timeoutMs: TIMEOUT_MS, totals, results }, null, 2)}\n`);

console.log(
  `TỔNG ${totals.tong}: bị bắt ${totals.bat}, không biên dịch ${totals.bienDich}, LỌT ${totals.lot}, QUÁ GIỜ ${totals.quaGio}, không thấy chuỗi ${totals.khongThay}`,
);
console.log(`Báo cáo: ${reportPath}`);
// Mã thoát khác 0 khi còn chỗ chưa rõ, để dùng được trong script.
process.exit(totals.lot + totals.quaGio + totals.khongThay > 0 ? 1 : 0);
