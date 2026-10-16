import type { DeadCodeResult, DeadFile } from "@themegraph/core";

import { capped, table } from "./text.js";
import type { TextView, ViewOptions } from "./text-view.js";

/** Vì sao mỗi loại file chỉ ở mức "cần xem lại" chứ chưa chắc chắn. */
const REVIEW_NOTES: Record<string, string> = {
  section:
    "section: không có preset, không template nào dùng, và không file nào tải nó bằng tên viết sẵn; JavaScript của theme vẫn có thể tải nó qua Section Rendering API bằng tên là biến.",
  asset: "asset: có thể được gọi bằng tên ghép từ dữ liệu lúc chạy, từ bên trong một file CSS, hoặc bằng import() với tên là biến.",
  layout: "layout: có thể được chọn bằng {% layout %} với tên là biến.",
};

function deadRows(files: readonly DeadFile[], options: ViewOptions): string[] {
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
function unusedKeyLines(keys: readonly string[], options: ViewOptions): string[] {
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
function unusedSettingLines(settings: readonly string[], options: ViewOptions): string[] {
  if (settings.length === 0) return [];

  return [
    "",
    `Setting không file nào đọc bằng tên viết sẵn (${settings.length}), cần xem lại:`,
    ...capped(
      settings.map((setting) => `  ${setting}`),
      options,
      "setting",
    ),
    "  Setting vẫn có thể đang được dùng theo cách công cụ không lần theo: tên ghép từ dữ liệu lúc chạy (section.settings[block.id]), hoặc do chính Shopify đọc.",
  ];
}

/** Mục asset có nơi cần mà không trang nào nạp; rỗng khi không có. */
function notLoadedLines(assets: DeadCodeResult["notLoaded"], options: ViewOptions): string[] {
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

/** Cảnh báo ở đầu kết quả khi có file không đọc được trọn vẹn; rỗng khi không có. */
function fileErrorLines(errors: DeadCodeResult["fileErrors"], options: ViewOptions): string[] {
  if (errors.length === 0) return [];

  return [
    `Cảnh báo: ${errors.length} file không phân tích được trọn vẹn; kết quả có thể thiếu quan hệ của chúng:`,
    ...capped(
      errors.map((error) => `  ${error.file}  ${error.message}`),
      options,
      "file",
    ),
    "",
  ];
}

/** File, khoá dịch và setting không còn được dùng. */
export class DeadCodeView implements TextView<DeadCodeResult> {
  render(result: DeadCodeResult, options: ViewOptions = {}): string[] {
    const extras = [
      ...notLoadedLines(result.notLoaded, options),
      ...unusedKeyLines(result.unusedTranslationKeys, options),
      ...unusedSettingLines(result.unusedSettings, options),
    ];

    const warning = fileErrorLines(result.fileErrors, options);

    if (result.files.length === 0) {
      return [...warning, "Không tìm thấy file nào không được dùng.", ...extras];
    }

    const certain = result.files.filter((entry) => entry.confidence === "certain");
    const review = result.files.filter((entry) => entry.confidence === "review");

    const lines = [
      ...warning,
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
}
