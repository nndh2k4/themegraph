/**
 * Chữ hiển thị cho các giá trị mà API trả về ở dạng mã. Tách riêng khỏi phần
 * giao diện để test được mà không cần trình duyệt.
 */

/** Tên tiếng Việt của từng loại node. Loại lạ thì hiện nguyên mã. */
const KIND_LABELS: Record<string, string> = {
  page_type: "trang",
  layout: "layout",
  template: "template",
  section: "section",
  section_group: "nhóm section",
  block: "block",
  snippet: "snippet",
  asset: "asset",
  locale: "locale",
  locale_schema: "locale schema",
  config: "config",
  translation_key: "khoá dịch",
  setting: "setting",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/** Cách đọc từng loại cạnh, nhìn từ file ĐANG GỌI. */
const EDGE_LABELS: Record<string, string> = {
  USES_TEMPLATE: "dùng template",
  USES_LAYOUT: "dùng layout",
  RENDERS: "render",
  USES_ASSET: "dùng asset",
  USES_TRANSLATION: "dùng khoá dịch",
  READS_SETTING: "đọc setting",
  LOADS_SECTION: "tải bằng JavaScript",
};

export function edgeLabel(type: string): string {
  return EDGE_LABELS[type] ?? type;
}

/**
 * Tên ngắn để hiển thị một node: bỏ tiền tố kỹ thuật của id.
 *   page:product                              -> product
 *   t:general.cart.title                      -> general.cart.title
 *   setting:sections/a.liquid#section.title   -> sections/a.liquid#section.title
 *   snippets/card.liquid                      -> snippets/card.liquid
 */
export function displayName(id: string): string {
  for (const prefix of ["page:", "setting:", "t:"]) {
    if (id.startsWith(prefix)) return id.slice(prefix.length);
  }
  return id;
}

/** "2026-10-05T10:20:00.000Z" -> "2026-10-05 17:20" theo giờ của máy đang xem. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const two = (value: number): string => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Xếp một bảng đếm thành danh sách, nhiều nhất trước; bằng nhau thì theo tên. */
export function sortedCounts(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts).sort(([nameA, a], [nameB, b]) => b - a || (nameA < nameB ? -1 : 1));
}

/** "dòng 12, 30" từ danh sách số dòng; rỗng khi không có dòng nào. */
export function linesText(lines: readonly number[]): string {
  return lines.length === 0 ? "" : `dòng ${lines.join(", ")}`;
}
