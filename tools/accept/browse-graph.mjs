// Bấm thử màn đồ thị và màn cây render trong một trình duyệt thật (Microsoft
// Edge chạy không cửa sổ), điều khiển qua cổng gỡ lỗi của nó. Khác với ảnh
// chụp, script này gửi sự kiện chuột thật: bấm ô lọc, bấm vào node trên vùng
// vẽ, bấm nền, bấm liên kết, bấm Back.
//
// Không kiểm được bằng mắt: hình có đẹp không, kéo và lăn chuột có mượt không.
//
// Dùng: node tools/accept/browse-graph.mjs <địa chỉ server> <mã theme> [file có quan hệ]
//   ví dụ: node tools/accept/browse-graph.mjs http://localhost:7777 77b1beecdd07
// Tham số thứ ba là một file chắc chắn có nơi gọi, dùng để thử các liên kết
// trong panel; mặc định là snippets/card-product.liquid.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base, themeId, linkedNode = "snippets/card-product.liquid"] = process.argv.slice(2);
if (!base || !themeId) {
  console.error("Dùng: node tools/accept/browse-graph.mjs <địa chỉ server> <mã theme>");
  process.exit(2);
}

const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;
const profile = mkdtempSync(path.join(os.tmpdir(), "themegraph-edge-"));

const browser = spawn(
  EDGE,
  [
    "--headless=new",
    "--enable-unsafe-swiftshader", // WebGL bằng phần mềm, vì không có màn hình
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Chờ tới khi `check` trả giá trị khác false/null/undefined, hoặc hết giờ. */
async function until(check, what, timeout = 10000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value !== false && value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Hết giờ khi chờ: ${what}`);
    await sleep(100);
  }
}

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "ĐẠT " : "HỎNG"}  ${name}${detail === "" ? "" : `  (${detail})`}`);
}

let socket;
try {
  // Nối tới tab đầu tiên của trình duyệt.
  const target = await until(async () => {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      return tabs.find((tab) => tab.type === "page") ?? null;
    } catch {
      return null;
    }
  }, "trình duyệt mở cổng gỡ lỗi");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, failed) => {
    socket.addEventListener("open", done);
    socket.addEventListener("error", failed);
  });

  let nextId = 0;
  const waiting = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const handler = waiting.get(message.id);
    if (handler === undefined) return;
    waiting.delete(message.id);
    if (message.error) handler.failed(new Error(message.error.message));
    else handler.done(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((done, failed) => {
      const id = ++nextId;
      waiting.set(id, { done, failed });
      socket.send(JSON.stringify({ id, method, params }));
    });

  /** Chạy một biểu thức trong trang và trả về giá trị của nó. */
  const page = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const hash = () => page("location.hash");
  const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  const click = async (x, y) => {
    await mouse("mouseMoved", x, y, { button: "none" });
    await mouse("mousePressed", x, y);
    await mouse("mouseReleased", x, y);
  };
  /** Bấm vào giữa phần tử khớp `selector` (phần tử thứ `index`). */
  const clickOn = async (selector, index = 0) => {
    const box = await page(
      `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    if (box === null) throw new Error(`Không thấy phần tử ${selector}[${index}]`);
    await click(box.x, box.y);
  };

  await send("Page.enable");
  await send("Runtime.enable");

  // ---- màn đồ thị ----
  await send("Page.navigate", { url: `${base}/#/t/${themeId}/graph` });
  await until(() => page('document.querySelector(".graph-stage canvas") !== null'), "vùng vẽ của đồ thị hiện ra");
  check("Màn đồ thị tải và có vùng vẽ WebGL", true);

  const summary = () => page('document.querySelector(".graph-legend span:last-child").textContent');
  const before = await summary();

  // Bật asset: ô cuối cùng trong thanh lọc.
  const boxes = await page('document.querySelectorAll(".graph-kind input").length');
  await clickOn(".graph-kind input", boxes - 1);
  await until(async () => (await hash()).includes("kinds="), "địa chỉ ghi lại bộ lọc");
  const withAsset = await summary();
  check("Bấm ô asset: địa chỉ đổi và số node tăng", withAsset !== before && (await hash()).includes("asset"), `${before.trim()} -> ${withAsset.trim()}`);

  // Nút Back của trình duyệt đưa về bộ lọc trước.
  await page("history.back()");
  await until(async () => !(await hash()).includes("kinds="), "Back bỏ bộ lọc");
  check("Back đưa về bộ lọc trước, hình vẽ lại", (await summary()) === before);

  // Bấm vào một node trên vùng vẽ. Vị trí của node không đọc được từ ngoài,
  // nên bấm lần lượt theo một lưới điểm cho tới khi địa chỉ ghi một node.
  const stage = await page('(() => { const r = document.querySelector(".graph-stage").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');
  let hit = null;
  scan: for (let y = stage.y + 40; y < stage.y + stage.h - 60; y += 12) {
    for (let x = stage.x + 40; x < stage.x + stage.w - 40; x += 12) {
      await click(x, y);
      if ((await hash()).includes("node=")) {
        hit = { x, y };
        break scan;
      }
    }
  }
  check("Bấm vào một node trên vùng vẽ thì node đó được chọn", hit !== null, hit === null ? "" : decodeURIComponent(await hash()));

  if (hit !== null) {
    const selected = new URLSearchParams((await hash()).split("?")[1]).get("node");
    const title = await until(() => page('document.querySelector(".graph-panel-title")?.textContent ?? null'), "panel hiện ra");
    check("Panel bên cạnh hiện đúng node vừa bấm", selected.endsWith(title) || title.endsWith(selected.replace(/^page:/, "")), title);

    // Bấm nền (góc trên bên trái của vùng vẽ, nơi không có node) thì bỏ chọn.
    await click(stage.x + 6, stage.y + 6);
    await until(async () => !(await hash()).includes("node="), "bấm nền bỏ chọn");
    check("Bấm vào nền thì bỏ chọn node", true);

    // Node vừa bấm trúng có thể không có quan hệ nào đang hiện, nên các bước
    // sau dùng một file chắc chắn có nơi gọi.
    const linkedHash = `#/t/${themeId}/graph?node=${encodeURIComponent(linkedNode)}`;
    await page(`location.hash = ${JSON.stringify(linkedHash)}`);
    await until(() => page('document.querySelectorAll(".graph-links a").length > 0'), "panel của file có quan hệ");

    // Bật "chỉ hiện lân cận".
    await clickOn(".graph-near input");
    const near = await until(async () => {
      const text = await summary();
      return text.includes("lân cận") ? text : null;
    }, "hình thu về lân cận");
    check("Bật lân cận: hình thu về quanh node, địa chỉ có near=1", (await hash()).includes("near=1") && near !== before, near.trim());

    // Bấm một liên kết trong panel: chuyển node đang chọn mà vẫn ở màn đồ thị.
    const next = await page('document.querySelector(".graph-links a").textContent');
    await clickOn(".graph-links a");
    await until(async () => new URLSearchParams((await hash()).split("?")[1]).get("node") !== linkedNode, "node đang chọn đổi");
    check(
      "Bấm một file trong panel: chuyển sang node đó, vẫn ở chế độ lân cận",
      decodeURIComponent(await hash()).includes(next) && (await hash()).includes("near=1"),
      next,
    );

    // Đóng panel.
    await clickOn(".graph-panel-close");
    await until(async () => !(await hash()).includes("node="), "bỏ chọn");
    check("Nút đóng panel bỏ chọn node và thoát chế độ lân cận", !(await hash()).includes("near="));
  }

  // Nút phóng to không được làm hỏng trang.
  await clickOn(".graph-zoom button", 0);
  await clickOn(".graph-zoom button", 2);
  await sleep(400);
  check("Nút phóng to và vừa khung: trang không báo lỗi", (await page('document.querySelector(".graph-stage canvas") !== null')) === true);

  // ---- màn cây render ----
  await send("Page.navigate", { url: `${base}/#/t/${themeId}/flow?page=product` });
  await until(() => page('document.querySelector(".flow-tree") !== null'), "cây render hiện ra");
  const openBefore = await page('document.querySelectorAll(".flow-tree details[open]").length');
  const closed = await page('document.querySelectorAll(".flow-tree details:not([open])").length');
  check("Cây render của trang product hiện ra, mở sẵn các tầng trên", openBefore >= 2 && closed > 0, `${openBefore} mở, ${closed} gập`);

  await clickOn(".flow-tree details:not([open]) > summary");
  await sleep(200);
  const openAfter = await page('document.querySelectorAll(".flow-tree details[open]").length');
  check("Bấm một nhánh đang gập thì nó mở ra", openAfter === openBefore + 1, `${openBefore} -> ${openAfter}`);

  // Chuyển sang trang khác bằng danh sách trang.
  const other = await page('[...document.querySelectorAll(".flow-pages a")].find((a) => !a.classList.contains("current")).textContent');
  await page('[...document.querySelectorAll(".flow-pages a")].find((a) => !a.classList.contains("current")).click()');
  await until(async () => decodeURIComponent(await hash()).endsWith(`page=${other}`), "chuyển trang");
  await until(() => page(`document.querySelector(".flow-tree .node")?.textContent === ${JSON.stringify(other)}`), "cây của trang mới");
  check("Chọn trang khác: cây đổi theo", true, other);
} catch (error) {
  check("Script chạy hết", false, error instanceof Error ? error.message : String(error));
} finally {
  socket?.close();
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} đạt, ${failed} hỏng.`);
process.exit(failed === 0 ? 0 : 1);
