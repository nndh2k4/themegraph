// Bấm thử màn đồ thị và màn cây render trong một trình duyệt thật (Microsoft
// Edge chạy không cửa sổ), điều khiển qua cổng gỡ lỗi của nó. Khác với ảnh
// chụp, script này gửi sự kiện chuột thật: bấm ô lọc, bấm vào node trên vùng
// vẽ, bấm nền, bấm liên kết, bấm Back.
//
// Không kiểm được bằng mắt: hình có đẹp không, kéo và lăn chuột có mượt không.
//
// Đặt biến môi trường SHOT_DIR để script lưu ảnh chụp ở vài bước vào thư mục đó.
//
// Dùng: node tools/accept/browse-graph.mjs <địa chỉ server> <mã theme> [file có quan hệ]
//   ví dụ: node tools/accept/browse-graph.mjs http://localhost:7777 77b1beecdd07
// Tham số thứ ba là một file chắc chắn có nơi gọi, dùng để thử các liên kết
// trong panel; mặc định là snippets/card-product.liquid.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";

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

/**
 * Màu của các loại node trên hình (KIND_COLORS trong packages/web/src/graph-model.ts),
 * trừ asset: màu xám của nó gần với màu cạnh.
 */
const NODE_COLORS = ["#d9480f", "#e8a013", "#7048e8", "#0c8599", "#1c7ed6", "#37b24d", "#c2255c"].map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

/**
 * Giải mã một ảnh PNG 8 bit (RGB hoặc RGBA, không xen kẽ) thành các điểm ảnh.
 * Viết tay vì chỉ cần cho ảnh chụp màn hình của trình duyệt, không đáng thêm
 * một thư viện.
 */
function decodePng(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const channels = buffer[25] === 6 ? 4 : 3;
  if (buffer[24] !== 8 || (buffer[25] !== 6 && buffer[25] !== 2) || buffer[28] !== 0) {
    throw new Error("Ảnh PNG có định dạng script này không đọc được.");
  }

  // Gom các khối IDAT rồi giải nén.
  const parts = [];
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    if (buffer.toString("latin1", at + 4, at + 8) === "IDAT") parts.push(buffer.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));

  // Mỗi dòng bắt đầu bằng một byte cho biết cách nó được "lọc" so với dòng trên.
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i];
      const left = i >= channels ? pixels[y * stride + i - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dUpLeft = Math.abs(estimate - upLeft);
        predicted = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }
      pixels[y * stride + i] = (value + predicted) & 255;
    }
  }

  return { width, height, channels, pixels };
}

/**
 * Tìm tâm của một node trong ảnh chụp: một dải ngang ít nhất 5 điểm ảnh mang
 * đúng màu của một loại node, nằm trong khung `area`. Trả null nếu không thấy.
 */
function findNodeIn(image, area) {
  const { width, channels, pixels } = image;
  const isNode = (x, y) => {
    const at = (y * width + x) * channels;
    return NODE_COLORS.some(([r, g, b]) => pixels[at] === r && pixels[at + 1] === g && pixels[at + 2] === b);
  };

  for (let y = Math.ceil(area.y); y < area.y + area.h; y++) {
    for (let x = Math.ceil(area.x); x < area.x + area.w; x++) {
      if (!isNode(x, y)) continue;
      let end = x;
      while (end + 1 < area.x + area.w && isNode(end + 1, y)) end++;
      // Dải đủ rộng thì là thân của một node, không phải một điểm ảnh lẻ của nhãn hay chú giải.
      if (end - x >= 4) return { x: Math.round((x + end) / 2), y: y + 2 };
      x = end;
    }
  }
  return null;
}

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

  /** Chụp màn hình hiện tại vào SHOT_DIR, nếu biến đó được đặt. */
  const snap = async (name) => {
    if (!process.env.SHOT_DIR) return;
    mkdirSync(process.env.SHOT_DIR, { recursive: true });
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(process.env.SHOT_DIR, `${name}.png`), Buffer.from(data, "base64"));
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
  // Địa chỉ đổi trước, hình vẽ lại sau một nhịp: chờ tới khi dòng tóm tắt đổi.
  const withAsset = await until(async () => {
    const text = await summary();
    return text !== before ? text : null;
  }, "hình vẽ lại với asset");
  check("Bấm ô asset: địa chỉ đổi và số node tăng", withAsset !== before && (await hash()).includes("asset"), `${before.trim()} -> ${withAsset.trim()}`);

  // Nút Back của trình duyệt đưa về bộ lọc trước.
  await page("history.back()");
  await until(async () => !(await hash()).includes("kinds="), "Back bỏ bộ lọc");
  await until(async () => (await summary()) === before, "hình vẽ lại như trước");
  check("Back đưa về bộ lọc trước, hình vẽ lại", true);

  // Bấm vào một node trên vùng vẽ. Vị trí của node không đọc được từ ngoài,
  // nên script chụp màn hình, tìm một vùng mang màu của node, rồi bấm đúng
  // một lần vào đó.
  //
  // Không bấm dò theo lưới điểm: Sigma coi hai lần bấm cách nhau dưới 300 ms
  // là bấm đúp và phóng to, nên bấm dò liên tiếp sẽ đẩy camera vào một góc
  // trống của đồ thị.
  const stage = await page('(() => { const r = document.querySelector(".graph-stage").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');
  await sleep(600); // chờ hình vẽ xong sau lần đổi bộ lọc
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const spot = findNodeIn(decodePng(Buffer.from(shot.data, "base64")), {
    x: stage.x + 10,
    y: stage.y + 10,
    w: stage.w - 20,
    // Chừa góc dưới, nơi có các nút phóng to.
    h: stage.h - 70,
  });

  let hit = null;
  if (spot !== null) {
    await click(spot.x, spot.y);
    await sleep(200);
    if ((await hash()).includes("node=")) hit = spot;
  }
  if (hit === null) {
    await snap("khong-bam-trung-node");
    // Trạng thái của các canvas, để biết vùng vẽ trắng vì đâu.
    const canvases = await page(`[...document.querySelectorAll(".graph-stage canvas")].map((canvas) => {
      const box = canvas.getBoundingClientRect();
      let state = "2d";
      try {
        const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        if (gl !== null) state = gl.isContextLost() ? "webgl MAT CONTEXT" : "webgl";
      } catch (error) {
        state = String(error);
      }
      return canvas.className + " " + Math.round(box.width) + "x" + Math.round(box.height) + " " + state;
    })`);
    console.log("      canvas:", canvases.join(" | "));
  }
  check("Bấm vào một node trên vùng vẽ thì node đó được chọn", hit !== null, hit === null ? "" : decodeURIComponent(await hash()));

  if (hit !== null) {
    const selected = new URLSearchParams((await hash()).split("?")[1]).get("node");
    const title = await until(() => page('document.querySelector(".graph-panel-title")?.textContent ?? null'), "panel hiện ra");
    check("Panel bên cạnh hiện đúng node vừa bấm", selected.endsWith(title) || title.endsWith(selected.replace(/^page:/, "")), title);

    // Bấm nền (góc trên bên trái của vùng vẽ, nơi không có node) thì bỏ chọn.
    await sleep(400); // để Sigma không coi đây là lần thứ hai của một cú bấm đúp
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

  // ---- ô tìm kiếm trên đồ thị ----
  const key = async (name, code) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
  };
  const type = async (text) => {
    await clickOn(".graph-search input");
    await send("Input.insertText", { text });
  };
  const selectedNode = async () => new URLSearchParams((await hash()).split("?")[1] ?? "").get("node");

  await type("card");
  const shownHits = await until(async () => {
    const count = await page('document.querySelectorAll(".graph-hit").length');
    return count > 0 ? count : null;
  }, "danh sách kết quả hiện ra");
  const firstHit = await page('document.querySelector(".graph-hit .node").textContent');
  check("Gõ vào ô tìm kiếm: danh sách kết quả hiện ra", shownHits > 0, `${shownHits} kết quả, đầu tiên là ${firstHit}`);
  await sleep(300);
  await snap("tim-kiem-dang-go");

  // Enter chọn kết quả đầu tiên.
  await key("Enter", 13);
  await until(async () => (await selectedNode()) !== null, "Enter chọn một node");
  const byEnter = await selectedNode();
  check(
    "Enter chọn kết quả đầu tiên, ô tìm kiếm được xoá",
    byEnter.includes(firstHit) && (await page('document.querySelector(".graph-search input").value')) === "",
    byEnter,
  );

  // Mũi tên xuống rồi Enter chọn kết quả thứ hai.
  await type("card");
  await until(() => page('document.querySelectorAll(".graph-hit").length > 1'), "có ít nhất hai kết quả");
  const secondHit = await page('document.querySelectorAll(".graph-hit .node")[1].textContent');
  await key("ArrowDown", 40);
  await key("Enter", 13);
  await until(async () => (await selectedNode()) !== byEnter, "mũi tên xuống rồi Enter đổi node");
  check("Mũi tên xuống rồi Enter chọn kết quả thứ hai", (await selectedNode()).includes(secondHit), await selectedNode());

  // Bấm chuột vào một kết quả.
  // Gõ cả tên thư mục: nhiều theme có block và snippet trùng tên.
  await type(linkedNode.replace("/", " ").replace(/\.liquid$/, ""));
  await until(() => page('document.querySelectorAll(".graph-hit").length > 0'), "kết quả cho file có quan hệ");
  await clickOn(".graph-hit");
  await until(async () => (await selectedNode()) === linkedNode, "bấm chuột chọn kết quả");
  check("Bấm chuột vào một kết quả thì node đó được chọn", true, linkedNode);
  await sleep(800); // chờ camera bay xong
  await snap("tim-kiem-da-chon");

  // Tìm một asset trong khi ô asset đang tắt: loại đó tự bật.
  await type(".css");
  await until(() => page('document.querySelectorAll(".graph-hit").length > 0'), "kết quả là asset");
  await key("Enter", 13);
  await until(async () => ((await selectedNode()) ?? "").endsWith(".css"), "chọn một asset");
  check("Chọn một asset khi ô asset đang tắt: loại asset tự bật", (await hash()).includes("asset"), decodeURIComponent(await hash()));

  // Escape xoá từ khoá, không đổi node đang chọn.
  const beforeEscape = await selectedNode();
  await type("card");
  await until(() => page('document.querySelectorAll(".graph-hit").length > 0'), "kết quả trước khi Escape");
  await key("Escape", 27);
  await sleep(200);
  check(
    "Escape xoá từ khoá và đóng danh sách, giữ nguyên node đang chọn",
    (await page('document.querySelectorAll(".graph-hits").length')) === 0 && (await selectedNode()) === beforeEscape,
  );

  // Từ khoá không khớp gì.
  await type("zzz-khong-co-file-nao");
  await until(() => page('document.querySelector(".graph-hits")?.textContent.includes("Không có file nào khớp") ?? false'), "thông báo không khớp");
  check("Từ khoá không khớp: báo không có file nào", true);
  await key("Escape", 27);

  // Trả màn đồ thị về trạng thái ban đầu cho các bước sau.
  await page(`location.hash = "#/t/${themeId}/graph"`);
  await until(async () => (await selectedNode()) === null, "về trạng thái ban đầu");

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
