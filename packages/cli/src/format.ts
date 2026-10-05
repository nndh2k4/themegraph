import { VERSION } from "@themegraph/core";
import type {
  AnalyzeResult,
  ContextLink,
  ContextResult,
  DeadCodeResult,
  DeadFile,
  FlowNode,
  ImpactResult,
  Reached,
  RenderFlowResult,
  VerifyResult,
} from "@themegraph/core";

/**
 * Các hàm trong file này đổi kết quả của lõi thành những dòng chữ cho người
 * đọc. Chúng không in gì ra: mỗi hàm trả về một mảng dòng, run.ts quyết định
 * gửi đi đâu. Nhờ vậy lõi không biết gì về cách trình bày, và cờ --json chỉ
 * việc bỏ qua cả file này.
 */

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

export function formatImpact(result: ImpactResult): string[] {
  const { target, affected, pages } = result;

  if (affected.length === 0) {
    return [`Không file hay trang nào dùng tới ${target.id} (${target.kind}).`];
  }

  const files = affected.filter((node) => node.kind !== "page_type");
  const lines = [
    `Sửa ${target.id} (${target.kind}) ảnh hưởng ${files.length} file và ${pages.length} trên ${result.totalPages} trang.`,
  ];

  if (pages.length > 0) {
    lines.push("", `Trang (${pages.length}):`);
    lines.push(
      ...table(pages.map((page) => [pageName(page.id), `cách ${page.depth} tầng`, page.certain ? "" : CONDITIONAL])),
    );
  }

  if (files.length > 0) {
    lines.push("", `File (${files.length}), gần nhất trước:`);
    lines.push(
      ...table(files.map((node) => [String(node.depth), node.id, node.kind, node.certain ? "" : CONDITIONAL])),
    );
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

  lines.push(["  ".repeat(node.depth) + node.id, ...notes].join("  "));

  for (const child of node.children) drawTree(child, parents, lines);
}

export function formatRenderFlow(result: RenderFlowResult): string[] {
  const { root, files, tree } = result;

  if (files.length === 0) {
    return [`${root.id} (${root.kind}) không gọi tới file nào.`];
  }

  const maxDepth = Math.max(...files.map((node) => node.depth));
  const lines = [`${root.id} (${root.kind}) kéo theo ${files.length} file, sâu nhất ${maxDepth} tầng.`, ""];

  drawTree(tree, collectParents(tree, new Set()), lines);
  return lines;
}

// ---- context ------------------------------------------------------------------

/** Ghi chú đi sau một quan hệ: loại cạnh, số lời gọi, nhãn điều kiện. */
function linkNotes(link: ContextLink): string {
  return [link.type, link.count > 1 ? `×${link.count}` : "", link.conditional ? CONDITIONAL : ""]
    .filter((note) => note !== "")
    .join("  ");
}

export function formatContext(result: ContextResult): string[] {
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
    ...table(
      usedBy.map((link) => [link.lines.length > 0 ? `${link.id}:${link.lines.join(",")}` : link.id, linkNotes(link)]),
    ),
  );

  lines.push("", `Gọi tới (${uses.length}):`);
  // Còn ở đây là dòng trong chính file đang hỏi.
  lines.push(
    ...table(
      uses.map((link) => [
        link.id,
        link.lines.length > 0 ? `dòng ${link.lines.join(", ")}` : "",
        linkNotes(link),
      ]),
    ),
  );

  if (translations.length > 0) {
    lines.push("", `Khoá dịch (${translations.length}):`);
    lines.push(
      ...table(
        translations.map((link) => [
          translationKey(link.id),
          `dòng ${link.lines.join(", ")}`,
          link.conditional ? CONDITIONAL : "",
        ]),
      ),
    );
  }

  if (settings.length > 0) {
    lines.push("", `Setting được đọc (${settings.length}):`);
    lines.push(
      ...table(
        settings.map((link) => [
          settingName(link.id),
          `dòng ${link.lines.join(", ")}`,
          link.conditional ? CONDITIONAL : "",
        ]),
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
    "section: không có preset và không template nào dùng, nhưng JavaScript của theme có thể vẫn tải nó qua Section Rendering API.",
  asset: "asset: có thể được gọi bằng tên ghép lúc chạy, hoặc từ bên trong một file CSS / JavaScript.",
  layout: "layout: có thể được chọn bằng {% layout %} với tên là biến.",
};

function deadRows(files: readonly DeadFile[]): string[] {
  return table(
    files.map((entry) => [
      entry.id,
      entry.kind,
      entry.usedBy.length > 0 ? `chỉ được gọi bởi ${entry.usedBy.join(", ")}` : "",
    ]),
  );
}

/** Mục khoá dịch không thấy dùng; rỗng khi không có khoá nào. */
function unusedKeyLines(keys: readonly string[]): string[] {
  if (keys.length === 0) return [];

  return [
    "",
    `Khoá dịch không file nào gọi bằng tên viết sẵn (${keys.length}), cần xem lại:`,
    ...keys.map((key) => `  ${key}`),
    "  Khoá vẫn có thể được gọi bằng tên ghép lúc chạy, ví dụ 'products.' | append: handle | t.",
  ];
}

/** Mục setting không thấy đọc; rỗng khi không có setting nào. */
function unusedSettingLines(settings: readonly string[]): string[] {
  if (settings.length === 0) return [];

  return [
    "",
    `Setting không file nào đọc bằng tên viết sẵn (${settings.length}), cần xem lại:`,
    ...settings.map((setting) => `  ${setting}`),
    "  Setting vẫn có thể được đọc bằng tên là biến (section.settings[ten]), hoặc do chính Shopify đọc.",
  ];
}

export function formatDeadCode(result: DeadCodeResult): string[] {
  const extras = [...unusedKeyLines(result.unusedTranslationKeys), ...unusedSettingLines(result.unusedSettings)];

  if (result.files.length === 0) {
    return ["Không tìm thấy file nào không được dùng.", ...extras];
  }

  const certain = result.files.filter((entry) => entry.confidence === "certain");
  const review = result.files.filter((entry) => entry.confidence === "review");

  const lines = [
    `Không trang nào dùng tới ${result.files.length} file: ${result.certain} chắc chắn, ${result.review} cần xem lại.`,
  ];

  if (certain.length > 0) {
    lines.push("", `Chắc chắn không dùng (${certain.length}):`, ...deadRows(certain));
  }

  if (review.length > 0) {
    lines.push("", `Cần xem lại trước khi xoá (${review.length}):`, ...deadRows(review));

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
