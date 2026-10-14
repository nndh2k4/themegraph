import type { Reached } from "@themegraph/core";

import type { ViewOptions } from "./text-view.js";

/**
 * Các hàm nhỏ mà nhiều view dùng chung: cắt danh sách, căn bảng, đổi id thành
 * tên người đọc quen.
 */

/** Nhãn gắn sau một quan hệ chỉ xảy ra trong một điều kiện nào đó. */
export const CONDITIONAL = "[có điều kiện]";

/**
 * Cắt một danh sách các dòng theo limit, thêm một dòng cho biết còn bao nhiêu.
 * `what` là tên của thứ bị cắt, ví dụ "file".
 */
export function capped(lines: readonly string[], options: ViewOptions, what: string): string[] {
  const { limit } = options;
  if (limit === undefined || lines.length <= limit) return [...lines];

  const hidden = lines.length - Math.max(0, limit);
  return [...lines.slice(0, Math.max(0, limit)), `  ... và ${hidden} ${what} nữa (tăng limit để xem hết)`];
}

/**
 * Căn các cột của một bảng chữ: mỗi cột rộng bằng ô dài nhất của nó. Cột mà
 * mọi ô đều rỗng thì bỏ hẳn, và dấu cách ở cuối dòng bị cắt, để không có
 * khoảng trống thừa.
 */
export function table(rows: readonly (readonly string[])[], indent = "  "): string[] {
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
export function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([name, count]) => `${name} ${count}`)
    .join(", ");
}

/** "t:general.cart.title" -> "general.cart.title": khoá dịch như mã Liquid viết. */
export function translationKey(id: string): string {
  return id.startsWith("t:") ? id.slice("t:".length) : id;
}

/** Bỏ tiền tố "setting:" để còn lại đúng phần mô tả setting thuộc đâu. */
export function settingName(id: string): string {
  return id.startsWith("setting:") ? id.slice("setting:".length) : id;
}

/** "page:product" -> "product": tên trang như người dùng gõ. */
export function pageName(id: string): string {
  return id.startsWith("page:") ? id.slice("page:".length) : id;
}

/** Danh sách trang trên một dòng, trang có điều kiện được gắn nhãn. */
export function pageList(pages: readonly Reached[]): string {
  return pages.map((page) => pageName(page.id) + (page.certain ? "" : ` ${CONDITIONAL}`)).join(", ");
}

/** Đổi thời điểm ISO thành "2026-10-05 17:20" theo giờ của máy đang chạy. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const two = (value: number): string => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
