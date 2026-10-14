// So hai thư mục kết quả của golden.mjs, từng mục "### <nhãn>". Chỉ bỏ qua thời
// gian (số mili giây, giờ địa phương); mọi khác biệt khác được in ra.
//
// Dùng: node tools/accept/golden-compare.mjs <thư-mục-A> <thư-mục-B> [số mục khác tối đa in ra]
// Mã thoát 0 khi trùng khớp hoàn toàn.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const [a, b, maxArg] = process.argv.slice(2);
const max = Number(maxArg ?? 10);

/** Những thứ đổi giữa hai lần chạy mà không phải hành vi: thời gian. */
function normalize(text) {
  return text
    .replace(/\(\d+ ms\)/g, "(<N> ms)")
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, "<LOCALTIME>");
}

function sections(file) {
  const map = new Map();
  const text = readFileSync(file, "utf8");
  const parts = text.split(/^### /m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const label = part.slice(0, newline);
    let key = label;
    for (let i = 2; map.has(key); i++) key = `${label} #${i}`;
    map.set(key, normalize(part.slice(newline + 1)));
  }
  return map;
}

let totalDiff = 0;
for (const name of readdirSync(a).filter((f) => f.endsWith(".txt")).sort()) {
  const left = sections(path.join(a, name));
  const right = sections(path.join(b, name));
  const labels = [...new Set([...left.keys(), ...right.keys()])];
  const diffs = labels.filter((label) => left.get(label) !== right.get(label));
  totalDiff += diffs.length;
  console.log(`${name}: ${labels.length} mục, ${diffs.length} khác`);

  for (const label of diffs.slice(0, max)) {
    console.log(`  --- ${label}`);
    const l = (left.get(label) ?? "<không có>").split("\n");
    const r = (right.get(label) ?? "<không có>").split("\n");
    for (let i = 0, shown = 0; i < Math.max(l.length, r.length) && shown < 4; i++) {
      if (l[i] !== r[i]) {
        console.log(`    A: ${(l[i] ?? "<hết>").slice(0, 200)}`);
        console.log(`    B: ${(r[i] ?? "<hết>").slice(0, 200)}`);
        shown++;
      }
    }
  }
}
console.log(totalDiff === 0 ? "TRÙNG KHỚP" : `TỔNG ${totalDiff} MỤC KHÁC`);
process.exit(totalDiff === 0 ? 0 : 1);
