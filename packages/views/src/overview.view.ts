import type { OverviewResult } from "@themegraph/core";

import { formatCounts, formatTime, table } from "./text.js";
import type { TextView } from "./text-view.js";

/** Cả theme trong một màn hình. */
export class OverviewView implements TextView<OverviewResult> {
  render(result: OverviewResult): string[] {
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
}
