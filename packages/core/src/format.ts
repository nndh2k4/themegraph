import path from "node:path";

import type { AnalyzeResult } from "./analyze.js";
import type { CleanResult } from "./clean.js";
import type { ContextLink, ContextResult } from "./context.js";
import type { DeadCodeResult, DeadFile } from "./dead-code.js";
import type { ImpactResult } from "./impact.js";
import type { OverviewResult } from "./overview.js";
import type { ListedTheme } from "./registry.js";
import type { FlowNode, RenderFlowResult } from "./render-flow.js";
import type { SearchResult } from "./search.js";
import type { StatusResult } from "./status.js";
import type { Reached } from "./traverse.js";
import type { VerifyResult } from "./verify.js";
import { VERSION } from "./version.js";

/**
 * Các hàm trong file này đổi kết quả của một truy vấn thành những dòng chữ cho
 * người (hoặc agent) đọc. Chúng không in gì ra và không truy vấn gì thêm: mỗi
 * hàm nhận một kết quả, trả về một mảng dòng, lớp vỏ quyết định gửi đi đâu.
 *
 * File này nằm ở lõi vì hai lớp vỏ cùng dùng nó: CLI in các dòng ra màn hình,
 * MCP server gửi chúng cho agent. Đặt ở một lớp vỏ thì lớp kia phải chép lại.
 * Các hàm truy vấn không gọi tới file này, và cờ --json bỏ qua nó hoàn toàn.
 */

/** Tuỳ chọn chung của các hàm trình bày. */
export interface FormatOptions {
  /**
   * Số dòng tối đa của MỖI danh sách trong kết quả. Phần bị cắt được thay
   * bằng một dòng đếm. Không nêu thì in hết.
   *
   * Sinh ra cho agent: đầu ra của một tool có giới hạn kích thước, và một
   * danh sách 500 dòng chiếm chỗ của những thứ đáng đọc hơn.
   */
  limit?: number;
}

/**
 * Cắt một danh sách các dòng theo limit, thêm một dòng cho biết còn bao nhiêu.
 * `what` là tên của thứ bị cắt, ví dụ "file".
 */
function capped(lines: readonly string[], options: FormatOptions, what: string): string[] {
  const { limit } = options;
  if (limit === undefined || lines.length <= limit) return [...lines];

  const hidden = lines.length - Math.max(0, limit);
  return [...lines.slice(0, Math.max(0, limit)), `  ... và ${hidden} ${what} nữa (tăng limit để xem hết)`];
}

/** Nhãn gắn sau một quan hệ chỉ xảy ra trong một điều kiện nào đó. */
const CONDITIONAL = "[có điều kiện]";

/** Số sai khác tối đa in ra khi verify thất bại; phần còn lại chỉ được đếm. */
const MAX_MISMATCHES_SHOWN = 20;

/**
 * Căn các cột của một bảng chữ: mỗi cột rộng bằng ô dài nhất của nó. Cột mà
 * mọi ô đều rỗng thì bỏ hẳn, và dấu cách ở cuối dòng bị cắt, để không có
 * khoảng trống thừa.
 */
function table(rows: readonly (readonly string[])[], indent = "  "): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, column) => {
      widths[column] = Math.max(widths[column] ?? 0, cell.length);
    });
  }

  return rows.map((row) => {
    const cells = row
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .filter((_, column) => (widths[column] ?? 0) > 0);
    return (indent + cells.join("  ")).trimEnd();
  });
}

/** Ghép một bảng đếm thành chuỗi "RENDERS 9, USES_ASSET 1". */
function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([name, count]) => `${name} ${count}`)
    .join(", ");
}

/** "t:general.cart.title" -> "general.cart.title": khoá dịch như mã Liquid viết. */
function translationKey(id: string): string {
  return id.startsWith("t:") ? id.slice("t:".length) : id;
}

/** Bỏ tiền tố "setting:" để còn lại đúng phần mô tả setting thuộc đâu. */
function settingName(id: string): string {
  return id.startsWith("setting:") ? id.slice("setting:".length) : id;
}

/** "page:product" -> "product": tên trang như người dùng gõ. */
function pageName(id: string): string {
  return id.startsWith("page:") ? id.slice("page:".length) : id;
}

/** Danh sách trang trên một dòng, trang có điều kiện được gắn nhãn. */
function pageList(pages: readonly Reached[]): string {
  return pages.map((page) => pageName(page.id) + (page.certain ? "" : ` ${CONDITIONAL}`)).join(", ");
}

// ---- analyze ----------------------------------------------------------------

export function formatAnalyze(result: AnalyzeResult): string[] {
  const { stats } = result;
  const lines = [
    `ThemeGraph ${VERSION} — đã phân tích ${result.themeRoot}`,
    "",
    `  File        ${stats.files}`,
    `  Node        ${stats.nodes}  (${formatCounts(stats.nodesByKind)})`,
    `  Cạnh        ${stats.edges}  (${formatCounts(stats.edgesByType)})`,
    `  Tham chiếu  ${stats.refs}  (${formatCounts(stats.refsByStatus)})`,
  ];

  if (result.missing.length > 0) {
    lines.push("", `Tham chiếu hỏng (${result.missing.length}):`);
    for (const ref of result.missing) {
      // Ref lấy từ file JSON có line 0, tức không có số dòng để in.
      const where = ref.line > 0 ? `${ref.from}:${ref.line}` : ref.from;
      lines.push(`  ${where}  ${ref.kind} -> ${ref.target ?? ref.to}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push("", `File lỗi (${result.errors.length}):`);
    for (const error of result.errors) {
      lines.push(`  ${error.path}  ${error.message}`);
    }
  }

  lines.push("", `Đã ghi ${result.dbPath} (${result.durationMs} ms)`);
  return lines;
}

// ---- impact -----------------------------------------------------------------

/** Số file tối đa nêu tên sau chữ "qua" ở mỗi trang; phần còn lại chỉ đếm. */
const MAX_VIA_SHOWN = 3;

/** Nhãn của trang chỉ đi tới target qua một section do JavaScript tải. */
const SCRIPT_ONLY = "[qua JavaScript]";

/** Ghi chú của file có dùng target nhưng không nằm trên trang nào. */
const OFF_PAGE = "[không trang nào dùng]";

/** "qua a, b, c và 2 file khác"; rỗng khi trang gọi thẳng target. */
function viaNote(via: readonly string[]): string {
  if (via.length === 0) return "";

  const shown = via.slice(0, MAX_VIA_SHOWN).join(", ");
  const more = via.length > MAX_VIA_SHOWN ? ` và ${via.length - MAX_VIA_SHOWN} file khác` : "";
  return `qua ${shown}${more}`;
}

export function formatImpact(result: ImpactResult, options: FormatOptions = {}): string[] {
  const { target, affected, pages } = result;

  if (affected.length === 0) {
    return [`Không file hay trang nào dùng tới ${target.id} (${target.kind}).`];
  }

  const files = affected.filter((node) => node.kind !== "page_type");
  const offPage = new Set(result.offPage);
  // Trang render target ngay khi tải đứng trước; trang chỉ dính qua một
  // section do JavaScript tải đứng sau. sort() giữ thứ tự cũ trong mỗi nhóm.
  const ordered = [...pages].sort((a, b) => Number(a.scriptOnly) - Number(b.scriptOnly));
  const scriptOnly = ordered.filter((page) => page.scriptOnly).length;

  const lines = [
    `Sửa ${target.id} (${target.kind}) ảnh hưởng ${files.length} file và ${pages.length} trên ${result.totalPages} trang` +
      (scriptOnly > 0 ? `, trong đó ${scriptOnly} trang chỉ ${SCRIPT_ONLY.slice(1, -1)}.` : "."),
  ];

  if (pages.length > 0) {
    lines.push("", `Trang (${pages.length}):`);
    lines.push(
      ...table(
        ordered.map((page) => [
          pageName(page.id),
          `cách ${page.depth} tầng`,
          // Nhãn [qua JavaScript] đã hàm ý có điều kiện.
          page.scriptOnly ? SCRIPT_ONLY : page.certain ? "" : CONDITIONAL,
          viaNote(page.via),
        ]),
      ),
    );

    if (scriptOnly > 0) {
      lines.push(
        `Trang ghi ${SCRIPT_ONLY}: ${target.id} chỉ lên trang đó khi JavaScript tải riêng một section (Section Rendering API), ví dụ lúc mở giỏ hàng hoặc gõ vào ô tìm kiếm.`,
      );
    }
  }

  if (files.length > 0) {
    // Danh sách trang ở trên không bao giờ bị cắt: nó chính là câu trả lời.
    lines.push("", `File (${files.length}), gần nhất trước:`);
    lines.push(
      ...capped(
        table(
          files.map((node) => [
            String(node.depth),
            node.id,
            node.kind,
            node.certain ? "" : CONDITIONAL,
            offPage.has(node.id) ? OFF_PAGE : "",
          ]),
        ),
        options,
        "file",
      ),
    );

    if (offPage.size > 0) {
      lines.push(
        "",
        `File ghi ${OFF_PAGE}: theo đồ thị, nó có dùng ${target.id} nhưng không template hay file nào trên một trang gọi tới nó. Nó vẫn có thể lên trang nếu merchant thêm nó từ theme editor, hoặc nếu JavaScript tải nó (Section Rendering API), hai cách mà đồ thị không thấy.`,
      );
    }
  }

  return lines;
}

// ---- render-flow --------------------------------------------------------------

/** Gom id của mọi node có con ở chỗ nó được mở ra trong cây. */
function collectParents(node: FlowNode, parents: Set<string>): Set<string> {
  if (node.children.length > 0) parents.add(node.id);
  for (const child of node.children) collectParents(child, parents);
  return parents;
}

/**
 * Vẽ một node của cây và mọi node con, mỗi tầng thụt vào hai dấu cách.
 *
 * `parents` là các node có con. Một node lặp lại chỉ được ghi chú khi nó thuộc
 * tập này, tức khi ở đây thật sự có các con bị giấu đi; một file lá (ví dụ một
 * icon) xuất hiện nhiều lần thì không mất thông tin gì nên không cần ghi chú.
 */
function drawTree(node: FlowNode, parents: ReadonlySet<string>, lines: string[]): void {
  const notes: string[] = [];
  if (node.count > 1) notes.push(`×${node.count}`);
  if (node.conditional) notes.push(CONDITIONAL);
  if (node.repeated && parents.has(node.id)) notes.push("(các file con: xem ở chỗ khác trong cây)");
  if (node.hidden > 0) notes.push(`(${node.hidden} file con chưa mở)`);

  lines.push(["  ".repeat(node.depth) + node.id, ...notes].join("  "));

  for (const child of node.children) drawTree(child, parents, lines);
}

/**
 * Thứ tự in các loại file trong dòng tổng hợp của render-flow: từ ngoài vào
 * trong theo cách một trang được dựng.
 */
const FLOW_KIND_ORDER = ["template", "layout", "section_group", "section", "block", "snippet", "asset"] as const;

/**
 * Hai dòng tổng hợp đặt trước cây: đếm file theo loại, và danh sách ĐẦY ĐỦ các
 * section của trang.
 *
 * Cây có thể bị cắt theo độ sâu hoặc số dòng, còn hai dòng này tính trên toàn
 * bộ `files`, nên câu hỏi hay gặp nhất, "trang này có những section nào",
 * luôn có câu trả lời đủ. Trong nghiệm thu, một agent chỉ đọc phần cây đã cắt
 * và bỏ sót bảy section nằm dưới một section group ở tầng 4.
 */
function flowSummary(files: readonly Reached[]): string[] {
  const counts = FLOW_KIND_ORDER.map((kind) => [kind, files.filter((node) => node.kind === kind).length] as const).filter(
    ([, count]) => count > 0,
  );

  const lines = [`Theo loại: ${counts.map(([kind, count]) => `${count} ${kind}`).join(", ")}.`];

  const sections = files.filter((node) => node.kind === "section");
  if (sections.length > 0) {
    // Xếp theo id cho dễ dò; `files` vốn xếp theo độ sâu.
    const names = sections
      .map((node) => node.id + (node.certain ? "" : ` ${CONDITIONAL}`))
      .sort()
      .join(", ");
    lines.push(`Section (${sections.length}): ${names}`);
  }
  return lines;
}

/** Có node nào trong cây bị cắt các con đi không. */
function hasHidden(node: FlowNode): boolean {
  return node.hidden > 0 || node.children.some(hasHidden);
}

export function formatRenderFlow(result: RenderFlowResult, options: FormatOptions = {}): string[] {
  const { root, files, tree } = result;

  if (files.length === 0) {
    return [`${root.id} (${root.kind}) không gọi tới file nào.`];
  }

  const deepest = Math.max(...files.map((node) => node.depth));
  const lines = [
    `${root.id} (${root.kind}) kéo theo ${files.length} file, sâu nhất ${deepest} tầng.`,
    ...flowSummary(files),
  ];

  // Chỉ nói về giới hạn khi nó thật sự giấu đi thứ gì.
  if (result.maxDepth !== null && hasHidden(tree)) {
    lines.push(
      `Cây dưới đây dừng ở tầng ${result.maxDepth}. Hỏi tiếp từ một file trong cây, hoặc tăng độ sâu, để xem phần bên dưới.`,
    );
  }
  lines.push("");

  const drawn: string[] = [];
  drawTree(tree, collectParents(tree, new Set()), drawn);
  lines.push(...capped(drawn, options, "dòng"));
  return lines;
}

// ---- context ------------------------------------------------------------------

/** Ghi chú đi sau một quan hệ: loại cạnh, số lời gọi, nhãn điều kiện. */
function linkNotes(link: ContextLink): string {
  return [link.type, link.count > 1 ? `×${link.count}` : "", link.conditional ? CONDITIONAL : ""]
    .filter((note) => note !== "")
    .join("  ");
}

export function formatContext(result: ContextResult, options: FormatOptions = {}): string[] {
  const { node, usedBy, uses, translations, settings, broken, pages } = result;
  const lines = [`${node.id} (${node.kind})`];

  // Với chính một loại trang thì câu "thuộc trang nào" không có nghĩa.
  if (node.kind !== "page_type") {
    lines.push(
      pages.length === 0
        ? "  Không trang nào dùng tới."
        : `  Thuộc ${pages.length} trên ${result.totalPages} trang: ${pageList(pages)}`,
    );
  }

  lines.push("", `Được gọi bởi (${usedBy.length}):`);
  // Số dòng ở đây là dòng trong file GỌI, nên viết liền sau tên file đó.
  lines.push(
    ...capped(
      table(
        usedBy.map((link) => [
          link.lines.length > 0 ? `${link.id}:${link.lines.join(",")}` : link.id,
          linkNotes(link),
        ]),
      ),
      options,
      "file",
    ),
  );

  lines.push("", `Gọi tới (${uses.length}):`);
  // Còn ở đây là dòng trong chính file đang hỏi.
  lines.push(
    ...capped(
      table(
        uses.map((link) => [
          link.id,
          link.lines.length > 0 ? `dòng ${link.lines.join(", ")}` : "",
          linkNotes(link),
        ]),
      ),
      options,
      "file",
    ),
  );

  if (translations.length > 0) {
    lines.push("", `Khoá dịch (${translations.length}):`);
    lines.push(
      ...capped(
        table(
          translations.map((link) => [
            translationKey(link.id),
            `dòng ${link.lines.join(", ")}`,
            link.conditional ? CONDITIONAL : "",
          ]),
        ),
        options,
        "khoá dịch",
      ),
    );
  }

  if (settings.length > 0) {
    lines.push("", `Setting được đọc (${settings.length}):`);
    lines.push(
      ...capped(
        table(
          settings.map((link) => [
            settingName(link.id),
            `dòng ${link.lines.join(", ")}`,
            link.conditional ? CONDITIONAL : "",
          ]),
        ),
        options,
        "setting",
      ),
    );
  }

  if (broken.length > 0) {
    lines.push("", `Tham chiếu hỏng (${broken.length}):`);
    lines.push(
      ...table(
        broken.map((ref) => [ref.line > 0 ? `dòng ${ref.line}` : "(JSON)", `${ref.kind} -> ${ref.expected}`]),
      ),
    );
  }

  return lines;
}

// ---- dead-code ----------------------------------------------------------------

/** Vì sao mỗi loại file chỉ ở mức "cần xem lại" chứ chưa chắc chắn. */
const REVIEW_NOTES: Record<string, string> = {
  section:
    "section: không có preset, không template nào dùng, và không file nào tải nó bằng tên viết sẵn; JavaScript của theme vẫn có thể tải nó qua Section Rendering API bằng tên là biến.",
  asset: "asset: có thể được gọi bằng tên ghép lúc chạy, hoặc từ bên trong một file CSS / JavaScript.",
  layout: "layout: có thể được chọn bằng {% layout %} với tên là biến.",
};

function deadRows(files: readonly DeadFile[], options: FormatOptions): string[] {
  return capped(
    table(
      files.map((entry) => [
        entry.id,
        entry.kind,
        entry.usedBy.length > 0 ? `chỉ được gọi bởi ${entry.usedBy.join(", ")}` : "",
      ]),
    ),
    options,
    "file",
  );
}

/** Mục khoá dịch không thấy dùng; rỗng khi không có khoá nào. */
function unusedKeyLines(keys: readonly string[], options: FormatOptions): string[] {
  if (keys.length === 0) return [];

  return [
    "",
    `Khoá dịch không file nào gọi bằng tên viết sẵn (${keys.length}), cần xem lại:`,
    ...capped(
      keys.map((key) => `  ${key}`),
      options,
      "khoá dịch",
    ),
    "  Khoá vẫn có thể được gọi bằng tên ghép lúc chạy, ví dụ 'products.' | append: handle | t.",
  ];
}

/** Mục setting không thấy đọc; rỗng khi không có setting nào. */
function unusedSettingLines(settings: readonly string[], options: FormatOptions): string[] {
  if (settings.length === 0) return [];

  return [
    "",
    `Setting không file nào đọc bằng tên viết sẵn (${settings.length}), cần xem lại:`,
    ...capped(
      settings.map((setting) => `  ${setting}`),
      options,
      "setting",
    ),
    "  Setting vẫn có thể đang được dùng theo cách công cụ không lần theo: snippet nhận cả bộ setting qua tham số (render 'x', settings: block.settings), tên là biến (section.settings[ten]), hoặc do chính Shopify đọc.",
  ];
}

/** Mục asset có nơi cần mà không trang nào nạp; rỗng khi không có. */
function notLoadedLines(assets: DeadCodeResult["notLoaded"], options: FormatOptions): string[] {
  if (assets.length === 0) return [];

  const rows = assets.flatMap((asset) =>
    asset.elements.map((element) => `  ${asset.id}  định nghĩa <${element.name}>, được viết ở ${element.usedBy.join(", ")}`),
  );

  return [
    "",
    `Có nơi dùng thẻ nhưng không trang nào nạp file (${assets.length}), KHÔNG xoá:`,
    ...capped(rows, options, "dòng"),
    "  File định nghĩa một custom element mà theme đang viết ra, nhưng không thẻ <script> nào nạp nó:",
    "  thẻ hiện trên trang mà JavaScript của nó không chạy. Cách chữa là nạp file, không phải xoá.",
  ];
}

export function formatDeadCode(result: DeadCodeResult, options: FormatOptions = {}): string[] {
  const extras = [
    ...notLoadedLines(result.notLoaded, options),
    ...unusedKeyLines(result.unusedTranslationKeys, options),
    ...unusedSettingLines(result.unusedSettings, options),
  ];

  if (result.files.length === 0) {
    return ["Không tìm thấy file nào không được dùng.", ...extras];
  }

  const certain = result.files.filter((entry) => entry.confidence === "certain");
  const review = result.files.filter((entry) => entry.confidence === "review");

  const lines = [
    `Không trang nào dùng tới ${result.files.length} file: ${result.certain} chắc chắn, ${result.review} cần xem lại.`,
  ];

  if (certain.length > 0) {
    lines.push("", `Chắc chắn không dùng (${certain.length}):`, ...deadRows(certain, options));
  }

  if (review.length > 0) {
    lines.push("", `Cần xem lại trước khi xoá (${review.length}):`, ...deadRows(review, options));

    // Chỉ in ghi chú cho những loại file thật sự có mặt trong danh sách.
    const kinds = new Set(review.map((entry) => entry.kind));
    const notes = Object.entries(REVIEW_NOTES).filter(([kind]) => kinds.has(kind as DeadFile["kind"]));

    lines.push("", "Vì sao cần xem lại:");
    for (const [, note] of notes) lines.push(`  ${note}`);
    lines.push("  File khác trong mục này: chỉ được gọi bởi một file cần xem lại.");
  }

  lines.push(...extras);
  return lines;
}

// ---- search -------------------------------------------------------------------

export function formatSearch(result: SearchResult): string[] {
  const { query, hits, total } = result;
  const about = query.trim() === "" ? "" : ` khớp "${query}"`;

  if (total === 0) {
    return [`Không có node nào${about}.`];
  }

  // Giới hạn của search do chính truy vấn áp (tham số limit), nên ở đây chỉ
  // việc nói rõ đang hiện bao nhiêu trên tổng số.
  const count = hits.length < total ? `${hits.length} trên ${total}` : String(total);

  return [`Node${about} (${count}), sát nhất trước:`, ...table(hits.map((hit) => [hit.id, hit.kind]))];
}

// ---- verify -------------------------------------------------------------------

export function formatVerify(result: VerifyResult): string[] {
  const lines = [
    `Đã đối chiếu ${result.traversals} phép duyệt (${result.nodes} node × 2 chiều), ${result.comparisons} cặp so sánh.`,
    "",
    ...table([
      ["Sai khác giữa SQL và BFS", String(result.mismatches.length)],
      ["Lỗi toàn vẹn của database", String(result.integrity.length)],
      ["Độ sâu lớn nhất", String(result.maxDepth)],
      ["Node nằm trên vòng", String(result.nodesOnCycles)],
    ]),
  ];

  if (result.mismatches.length > 0) {
    lines.push("", "Sai khác (SQL so với BFS):");
    for (const mismatch of result.mismatches.slice(0, MAX_MISMATCHES_SHOWN)) {
      const show = (reach: typeof mismatch.sql): string =>
        reach === null ? "không tới" : `sâu ${reach.depth}${reach.certain ? "" : ` ${CONDITIONAL}`}`;

      lines.push(
        `  từ ${mismatch.start} (${mismatch.direction}) tới ${mismatch.node}: SQL ${show(mismatch.sql)}, BFS ${show(mismatch.bfs)}`,
      );
    }

    const hidden = result.mismatches.length - MAX_MISMATCHES_SHOWN;
    if (hidden > 0) lines.push(`  ... và ${hidden} sai khác nữa (dùng --json để xem hết)`);
  }

  if (result.integrity.length > 0) {
    lines.push("", "Lỗi toàn vẹn:");
    for (const problem of result.integrity) lines.push(`  ${problem}`);
  }

  lines.push("", `Kết quả: ${result.ok ? "ĐẠT" : "KHÔNG ĐẠT"} (${result.durationMs} ms)`);
  return lines;
}

// ---- list, status, clean --------------------------------------------------------

/** Đổi thời điểm ISO thành "2026-10-05 17:20" theo giờ của máy đang chạy. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const two = (value: number): string => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function formatList(themes: readonly ListedTheme[]): string[] {
  if (themes.length === 0) {
    return ['Chưa có theme nào được phân tích. Chạy "themegraph analyze" trong thư mục một theme.'];
  }

  const lines = [
    `Theme đã phân tích (${themes.length}):`,
    ...table(
      themes.map((theme) => [
        theme.name,
        `${theme.nodes} node`,
        `${theme.edges} cạnh`,
        formatTime(theme.analyzedAt),
        theme.path,
        theme.present ? "" : "(không còn graph.db)",
      ]),
    ),
  ];

  if (themes.some((theme) => !theme.present)) {
    lines.push("", 'Theme không còn graph.db: chạy "themegraph clean --theme <đường dẫn>" để gỡ khỏi danh sách.');
  }
  return lines;
}

export function formatOverview(result: OverviewResult): string[] {
  const { unused } = result;

  const lines = [
    ...table(
      [
        ["Theme", result.themeRoot],
        ["Phân tích", `${formatTime(result.meta.analyzedAt)} bằng ThemeGraph ${result.meta.toolVersion}`],
        ["Node", `${result.nodes}  (${formatCounts(result.nodesByKind)})`],
        ["Cạnh", `${result.edges}  (${formatCounts(result.edgesByType)})`],
        ["Trang", `${result.pages.length}  (${result.pages.join(", ")})`],
        ["Tham chiếu hỏng", String(result.brokenRefs)],
        ["File không dùng", `${unused.certain} chắc chắn, ${unused.review} cần xem lại`],
        ...(unused.notLoaded > 0 ? [["Dùng mà không nạp", `${unused.notLoaded} file JavaScript`]] : []),
        ["Không thấy dùng", `${unused.translationKeys} khoá dịch, ${unused.settings} setting`],
      ],
      "",
    ),
  ];

  if (result.mostUsed.length > 0) {
    lines.push("", "File được nhiều nơi gọi nhất:");
    lines.push(...table(result.mostUsed.map((entry) => [String(entry.usedBy), entry.id, entry.kind])));
  }
  return lines;
}

export function formatStatus(result: StatusResult): string[] {
  const lines = [
    ...table(
      [
        ["Theme", result.themeRoot],
        ["Đồ thị", `${result.nodes} node, ${result.edges} cạnh`],
        ["Phân tích", `${formatTime(result.analyzedAt)} bằng ThemeGraph ${result.toolVersion}`],
      ],
      "",
    ),
    "",
  ];

  if (!result.stale) {
    lines.push("Trạng thái: MỚI. Không file nào đổi từ lần phân tích.");
    return lines;
  }

  const changes = result.modified.length + result.added.length + result.removed.length;
  lines.push(`Trạng thái: CŨ. ${changes} file đã đổi từ lần phân tích; chạy "themegraph analyze" để cập nhật.`);
  lines.push(
    ...table([
      ...result.modified.map((file) => ["sửa", file]),
      ...result.added.map((file) => ["thêm", file]),
      ...result.removed.map((file) => ["xoá", file]),
    ]),
  );
  return lines;
}

/** Số file đã đổi được nêu tên trong dòng cảnh báo đồ thị cũ. */
const MAX_CHANGED_SHOWN = 5;

/**
 * Phần mở đầu của một câu trả lời gửi cho agent: đang nói về theme nào, và
 * nếu đồ thị đã cũ thì một dòng cảnh báo.
 *
 * Người gõ lệnh trong terminal biết mình đang đứng ở đâu và tự chạy status
 * được; agent thì không, nên MCP server gắn các dòng này vào mọi câu trả lời.
 */
export function formatThemeNote(status: StatusResult): string[] {
  const lines = [`Theme: ${path.basename(status.themeRoot)} (${status.themeRoot})`];

  if (!status.stale) return lines;

  const changed = [...status.modified, ...status.added, ...status.removed];
  const shown = changed.slice(0, MAX_CHANGED_SHOWN).join(", ");
  const more = changed.length > MAX_CHANGED_SHOWN ? `, và ${changed.length - MAX_CHANGED_SHOWN} file khác` : "";

  lines.push(
    `ĐỒ THỊ ĐÃ CŨ: ${changed.length} file đã đổi từ lần phân tích (${shown}${more}). Kết quả dưới đây chưa tính các thay đổi đó; chạy "themegraph analyze" trong thư mục theme để cập nhật.`,
  );
  return lines;
}

export function formatClean(results: readonly CleanResult[]): string[] {
  if (results.length === 0) {
    return ["Sổ đăng ký trống, không có gì để xoá."];
  }

  const lines: string[] = [];
  for (const result of results) {
    const nothing = result.removedFiles.length === 0 && !result.removedDir && !result.unregistered;

    if (nothing) {
      lines.push(`Không có dữ liệu ThemeGraph nào của ${result.themeRoot}.`);
      continue;
    }

    lines.push(`Đã xoá dữ liệu ThemeGraph của ${result.themeRoot}:`);
    for (const file of result.removedFiles) lines.push(`  ${file}`);
    if (result.unregistered) lines.push("  mục của theme trong sổ đăng ký");
  }
  return lines;
}
