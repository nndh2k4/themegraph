import type { StatusResult } from "@themegraph/core";

import { formatTime, table } from "./text.js";
import type { TextView } from "./text-view.js";

/** Đồ thị của một theme có còn khớp với các file trên đĩa không. */
export class StatusView implements TextView<StatusResult> {
  render(result: StatusResult): string[] {
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
}
