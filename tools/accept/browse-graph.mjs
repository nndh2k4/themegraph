// Bấm thử giao diện của ThemeGraph trong một trình duyệt thật (Microsoft Edge
// chạy không cửa sổ), điều khiển qua cổng gỡ lỗi của nó. Khác với ảnh chụp,
// script này gửi sự kiện chuột và bàn phím thật, đi qua mọi vùng của màn làm
// việc: màn chọn theme, bộ lọc, vùng vẽ, ô tìm kiếm, cây file, các tab của
// panel phải, nút Back của trình duyệt.
//
// Không kiểm được: hình có đẹp không, kéo và lăn chuột có mượt không (Edge
// không cửa sổ vẽ WebGL bằng phần mềm), và rê chuột lên node.
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
const NODE_COLORS = ["#f43f5e", "#f59e0b", "#a855f7", "#14b8a6", "#3b82f6", "#10b981", "#ec4899"].map((hex) => [
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

  const key = async (name, code, text) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
  };
  const count = (selector) => page("document.querySelectorAll(" + JSON.stringify(selector) + ").length");
  const text = (selector) => page("document.querySelector(" + JSON.stringify(selector) + ")?.textContent ?? null");
  const param = async (name) => new URLSearchParams((await hash()).split("?")[1] ?? "").get(name);
  /** Số node đang vẽ, đọc từ thanh dưới ("đang vẽ 114 node, 149 cạnh"). */
  const drawn = async () => {
    const found = /đang vẽ (\d+) node, (\d+) cạnh/.exec((await text('[data-testid="counts"]')) ?? "");
    return found === null ? null : { nodes: Number(found[1]), edges: Number(found[2]) };
  };
  /** Chờ số node hoặc số cạnh đang vẽ khác với \`before\`, rồi trả về số mới. */
  const drawnChanged = (before, what) =>
    until(async () => {
      const now = await drawn();
      return now !== null && (now.nodes !== before.nodes || now.edges !== before.edges) ? now : null;
    }, what);
  /** Bấm phần tử đầu tiên khớp \`selector\` mà chữ của nó đúng bằng \`label\`. */
  const clickText = async (selector, label) => {
    const index = await page(
      "[...document.querySelectorAll(" + JSON.stringify(selector) + ")].findIndex((el) => el.textContent.trim() === " + JSON.stringify(label) + ")",
    );
    if (index < 0) throw new Error("Không thấy " + selector + ' có chữ "' + label + '"');
    await clickOn(selector, index);
  };
  const type = async (value) => {
    await clickOn(".search-field input");
    await send("Input.insertText", { text: value });
  };
  const hitCount = () => count(".search-hit");

  // ---- màn chọn theme ----
  await send("Page.navigate", { url: base + "/#/" });
  await until(async () => (await count(".landing-theme")) > 0, "màn chọn theme hiện ra");
  await snap("1-chon-theme");
  const themeLink = await page(
    "[...document.querySelectorAll('a.landing-theme')].findIndex((a) => a.getAttribute('href') === " + JSON.stringify("#/t/" + themeId) + ")",
  );
  check("Màn chọn theme liệt kê theme, có liên kết tới theme đang thử", themeLink >= 0);
  await clickOn("a.landing-theme", themeLink);
  await until(async () => (await hash()) === "#/t/" + themeId, "bấm thẻ theme mở màn làm việc");

  // ---- màn làm việc ----
  await until(async () => (await count(".canvas-stage canvas")) > 0, "vùng vẽ của đồ thị hiện ra");
  const start = await until(drawn, "thanh dưới ghi số node đang vẽ");
  check("Bấm thẻ theme: màn làm việc mở, có vùng vẽ WebGL và năm vùng", (await count(".topbar, .left, .workspace-canvas, .right, .statusbar")) === 5, start.nodes + " node, " + start.edges + " cạnh");
  await until(async () => ((await text('[data-testid="status"]')) ?? "").includes("Đồ thị"), "thanh dưới ghi trạng thái đồ thị");
  check("Thanh dưới báo trạng thái đồ thị so với file trên đĩa", true, ((await text('[data-testid="status"]')) ?? "").trim());
  await sleep(600);
  await snap("2-man-lam-viec");

  // ---- tab bộ lọc: loại node ----
  await clickText('.left [role="tab"]', "Bộ lọc");
  await until(async () => (await count(".toggle")) > 0, "tab bộ lọc hiện ra");
  await clickOn('.toggle[data-kind="asset"]');
  const withAsset = await drawnChanged(start, "hình vẽ lại với asset");
  check("Bật loại asset: địa chỉ đổi và số node tăng", withAsset.nodes > start.nodes && ((await param("kinds")) ?? "").includes("asset"), start.nodes + " -> " + withAsset.nodes + " node");

  await page("history.back()");
  await until(async () => (await param("kinds")) === null && (await drawn())?.nodes === start.nodes, "Back bỏ bộ lọc và vẽ lại");
  check("Back đưa về bộ lọc trước, hình vẽ lại", true);

  // ---- tab bộ lọc: loại quan hệ ----
  await clickOn('.toggle[data-edge="RENDERS"]');
  const noRenders = await drawnChanged(start, "hình vẽ lại không có quan hệ render");
  check("Tắt quan hệ render: số cạnh giảm, số node giữ nguyên", noRenders.edges < start.edges && noRenders.nodes === start.nodes && (await param("edges")) !== null, start.edges + " -> " + noRenders.edges + " cạnh");
  await clickOn('.toggle[data-edge="RENDERS"]');
  await until(async () => (await param("edges")) === null && (await drawn())?.edges === start.edges, "bật lại quan hệ render");

  // ---- bấm vào một node trên vùng vẽ ----
  // Vị trí của node không đọc được từ ngoài, nên script chụp màn hình, tìm một
  // vùng mang màu của node, rồi bấm đúng một lần vào đó. Không bấm dò theo
  // lưới điểm: Sigma coi hai lần bấm cách nhau dưới 300 ms là bấm đúp và phóng
  // to, nên bấm dò liên tiếp sẽ đẩy camera vào một góc trống của đồ thị.
  const stage = await page('(() => { const r = document.querySelector(".canvas-stage").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()');
  await sleep(600);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const spot = findNodeIn(decodePng(Buffer.from(shot.data, "base64")), {
    x: stage.x + 10,
    // Chừa phía trên (nút chuyển bố cục) và góc dưới phải (nút phóng to).
    y: stage.y + 110,
    w: stage.w - 70,
    h: stage.h - 130,
  });

  let clicked = null;
  if (spot !== null) {
    await click(spot.x, spot.y);
    await sleep(300);
    clicked = await param("node");
  }
  check("Bấm vào một node trên vùng vẽ: node được chọn, tab chi tiết mở", clicked !== null && (await param("tab")) === "detail", clicked ?? "không tìm thấy node trên ảnh chụp");

  if (clicked !== null) {
    const title = await until(() => text(".detail-title"), "tab chi tiết hiện tên node");
    check("Tab chi tiết và nhãn trên vùng vẽ hiện đúng node vừa bấm", clicked.endsWith(title) && ((await text(".canvas-pill .pill-name")) ?? "") === title, title);

    await sleep(400); // để Sigma không coi đây là lần thứ hai của một cú bấm đúp
    await click(stage.x + 8, stage.y + stage.h - 8);
    // Địa chỉ đổi trước, giao diện vẽ lại sau một nhịp.
    await until(async () => (await param("node")) === null && (await count(".canvas-pill:not(.hover)")) === 0, "bấm nền bỏ chọn");
    check("Bấm vào nền thì bỏ chọn node, nhãn trên vùng vẽ biến mất", true);
  }

  // ---- ô tìm kiếm ----
  await page("document.activeElement?.blur()");
  await key("/", 191, "/");
  check('Phím "/" đưa con trỏ vào ô tìm kiếm', (await page('document.activeElement === document.querySelector(".search-field input")')) === true);

  await type("card");
  const shownHits = await until(async () => {
    const found = await hitCount();
    return found > 0 ? found : null;
  }, "danh sách kết quả hiện ra");
  const firstHit = await text(".search-hit .node");
  check("Gõ vào ô tìm kiếm: danh sách kết quả hiện ra", shownHits > 0, shownHits + " kết quả, đầu tiên là " + firstHit);
  await sleep(300);
  await snap("3-tim-kiem-dang-go");

  await key("Enter", 13);
  await until(async () => (await param("node")) !== null, "Enter chọn một node");
  const byEnter = await param("node");
  check("Enter chọn kết quả đầu tiên, ô tìm kiếm được xoá", byEnter.includes(firstHit) && (await page('document.querySelector(".search-field input").value')) === "", byEnter);

  await type("card");
  await until(async () => (await hitCount()) > 1, "có ít nhất hai kết quả");
  const secondHit = await page('document.querySelectorAll(".search-hit .node")[1].textContent');
  await key("ArrowDown", 40);
  await key("Enter", 13);
  await until(async () => (await param("node")) !== byEnter, "mũi tên xuống rồi Enter đổi node");
  check("Mũi tên xuống rồi Enter chọn kết quả thứ hai", (await param("node")).includes(secondHit), await param("node"));

  // Gõ cả tên thư mục: nhiều theme có block và snippet trùng tên.
  await type(linkedNode.replace("/", " ").replace(/\.liquid$/, ""));
  await until(async () => (await hitCount()) > 0, "kết quả cho file có quan hệ");
  await clickOn(".search-hit");
  await until(async () => (await param("node")) === linkedNode, "bấm chuột chọn kết quả");
  check("Bấm chuột vào một kết quả thì node đó được chọn", true, linkedNode);
  await sleep(800); // chờ camera bay xong
  await snap("4-chi-tiet-node");

  await type(".css");
  await until(async () => (await hitCount()) > 0, "kết quả là asset");
  await key("Enter", 13);
  await until(async () => ((await param("node")) ?? "").endsWith(".css"), "chọn một asset");
  check("Chọn một asset khi loại asset đang tắt: loại đó tự bật", ((await param("kinds")) ?? "").includes("asset"), await param("node"));

  const beforeEscape = await param("node");
  await type("card");
  await until(async () => (await hitCount()) > 0, "kết quả trước khi Escape");
  await key("Escape", 27);
  await sleep(200);
  check("Escape xoá từ khoá và đóng danh sách, giữ nguyên node đang chọn", (await count(".search-results")) === 0 && (await param("node")) === beforeEscape);

  await type("zzz-khong-co-file-nao");
  await until(async () => ((await text(".search-results")) ?? "").includes("Không có gì khớp"), "thông báo không khớp");
  check("Từ khoá không khớp: báo không có gì khớp", true);
  await key("Escape", 27);

  // ---- độ sâu lân cận ----
  await page("location.hash = " + JSON.stringify("#/t/" + themeId + "?node=" + encodeURIComponent(linkedNode) + "&tab=detail"));
  await until(async () => (await count(".chip-button")) > 0 && (await drawn())?.nodes === start.nodes, "tab chi tiết của file có quan hệ");
  await clickOn(".chip-button");
  const near1 = await drawnChanged(start, "hình thu về lân cận một bước");
  check('Nút "Chỉ hiện lân cận": hình thu về quanh node, địa chỉ có depth=1', (await param("depth")) === "1" && near1.nodes < start.nodes, near1.nodes + " node, " + near1.edges + " cạnh");

  await clickText(".depths button", "2 bước");
  const near2 = await drawnChanged(near1, "hình mở rộng ra hai bước");
  check("Chọn 2 bước ở tab bộ lọc: lân cận rộng hơn", (await param("depth")) === "2" && near2.nodes > near1.nodes, near1.nodes + " -> " + near2.nodes + " node");

  // Bấm một file trong tab chi tiết: chuyển node, giữ nguyên độ sâu.
  const nextNode = await text(".right .section .plain .node");
  await clickOn(".right .section .plain .node");
  await until(async () => (await param("node")) !== linkedNode, "node đang chọn đổi");
  check("Bấm một file trong tab chi tiết: chuyển sang node đó, giữ nguyên độ sâu", (await param("depth")) === "2", nextNode);

  await clickText(".depths button", "Tất cả");
  await until(async () => (await param("depth")) === null && (await drawn())?.nodes === start.nodes, "về hiện cả đồ thị");

  // ---- chuyển bố cục ----
  await clickText(".canvas-modes button", "Tầng");
  await until(async () => (await param("layout")) === "tree", "địa chỉ ghi bố cục theo tầng");
  await sleep(700);
  check("Chuyển sang bố cục theo tầng: vùng vẽ còn nguyên, số node không đổi", (await count(".canvas-stage canvas")) > 0 && (await drawn()).nodes === start.nodes);
  await snap("5-bo-cuc-tang");
  await clickText(".canvas-modes button", "Lực");
  await until(async () => (await param("layout")) === null, "về bố cục lực");

  // ---- cây file ----
  await clickText('.left [role="tab"]', "Tệp");
  await until(async () => (await count(".tree-row")) > 0, "cây file hiện ra");
  const filesBefore = await count(".tree-row.file");
  await clickText(".tree-row .tree-name", "snippets");
  await until(async () => (await count(".tree-row.file")) > filesBefore, "mở thư mục snippets");
  check("Bấm một thư mục trong cây file thì nó mở ra", true, filesBefore + " -> " + (await count(".tree-row.file")) + " dòng file");

  const fileName = linkedNode.split("/").pop();
  await clickText(".tree-row.file .tree-name", fileName);
  await until(async () => (await param("node")) === linkedNode, "bấm file trong cây chọn node");
  check("Bấm một file trong cây: node đó được chọn, dòng của nó được tô", (await count(".tree-row.file.selected")) === 1, linkedNode);

  await clickOn(".panel-search input");
  await send("Input.insertText", { text: "theme" });
  await until(async () => {
    const names = await page('[...document.querySelectorAll(".tree-row.file .tree-name")].map((el) => el.textContent)');
    return names.length > 0 && names.every((name) => name.includes("theme")) ? names : null;
  }, "cây file lọc theo từ khoá");
  check("Lọc cây file: chỉ còn file có tên khớp", true, (await count(".tree-row.file")) + " file");

  // ---- thu gọn và mở lại hai panel ----
  await clickOn(".left .panel-tabs .icon-button");
  await until(async () => (await count(".left.rail")) === 1, "panel trái thu về dải icon");
  await clickOn(".left.rail .icon-button", 0);
  await until(async () => (await count(".left.rail")) === 0, "panel trái mở lại");
  await clickOn(".topbar-right .icon-button");
  await until(async () => (await count(".right")) === 0, "panel phải ẩn");
  await clickOn(".topbar-right .icon-button");
  await until(async () => (await count(".right")) === 1, "panel phải hiện lại");
  check("Thu gọn và mở lại panel trái, ẩn và hiện panel phải", true);

  // ---- tab luồng trang ----
  await clickOn('.right [data-tab="flow"]');
  await until(async () => (await param("tab")) === "flow" && (await count(".pages .page")) > 0, "tab luồng trang liệt kê các trang");
  await clickText(".pages .page", "product");
  await until(async () => (await param("page")) === "product" && (await count(".flow-tree")) === 1, "chọn trang product");
  const openBefore = await count(".flow-tree details[open]");
  const closedBefore = await count(".flow-tree details:not([open])");
  check("Chọn trang product: cây luồng hiện ra, mở sẵn các tầng trên", openBefore >= 2 && closedBefore > 0, openBefore + " mở, " + closedBefore + " gập");
  await sleep(500);
  await snap("6-luong-trang");

  // Bấm vào mũi tên ở đầu dòng: giữa dòng là tên file, bấm vào đó là chọn node.
  const arrow = await page('(() => { const el = document.querySelector(".flow-tree details:not([open]) > summary"); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + 5, y: r.y + r.height / 2 }; })()');
  await click(arrow.x, arrow.y);
  await until(async () => (await count(".flow-tree details[open]")) === openBefore + 1, "một nhánh mở ra");
  check("Bấm một nhánh đang gập thì nó mở ra", true, openBefore + " -> " + (openBefore + 1));

  await clickText(".pages .page", "product");
  await until(async () => (await param("page")) === null && (await count(".flow-tree")) === 0, "bấm lại trang đang chọn thì bỏ chọn");
  check("Bấm lại trang đang chọn thì bỏ chọn", true);

  // ---- tab tổng quan và nút đổi theme ----
  await clickOn('.right [data-tab="overview"]');
  await until(async () => (await count(".stat")) >= 6, "tab tổng quan hiện các con số");
  check("Tab tổng quan hiện số liệu của theme", true, ((await text(".stat")) ?? "").replace(/(\d)(\D)/, "$1 $2"));

  await clickOn(".switcher-button");
  await until(async () => (await count(".switcher-list li")) > 0, "danh sách theme mở ra");
  check("Nút đổi theme mở danh sách các theme đã phân tích", true, (await count(".switcher-list li")) + " theme");
  await clickOn(".switcher-button");

  // ---- nút phóng to ----
  await clickOn(".canvas-zoom button", 0);
  await clickOn(".canvas-zoom button", 2);
  await sleep(400);
  check("Nút phóng to và vừa khung: vùng vẽ còn nguyên", (await count(".canvas-stage canvas")) > 0);

  // ---- địa chỉ của giao diện cũ ----
  await page("location.hash = " + JSON.stringify("#/t/" + themeId + "/file?path=" + encodeURIComponent(linkedNode)));
  await until(async () => (await text(".detail-title")) === linkedNode, "địa chỉ cũ mở tab chi tiết");
  check("Địa chỉ của giao diện cũ (/file?path=) vẫn mở đúng node", true);

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
