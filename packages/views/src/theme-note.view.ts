import path from "node:path";

import type { StatusResult } from "@themegraph/core";

import type { TextView } from "./text-view.js";

/** Số file đã đổi được nêu tên trong dòng cảnh báo đồ thị cũ. */
const MAX_CHANGED_SHOWN = 5;

/**
 * Phần mở đầu của một câu trả lời gửi cho agent: đang nói về theme nào, và
 * nếu đồ thị đã cũ thì một dòng cảnh báo.
 *
 * Người gõ lệnh trong terminal biết mình đang đứng ở đâu và tự chạy status
 * được; agent thì không, nên MCP server gắn các dòng này vào mọi câu trả lời.
 */
export class ThemeNoteView implements TextView<StatusResult> {
  render(status: StatusResult): string[] {
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
}
