import type { VerifyResult } from "@themegraph/core";

import { CONDITIONAL, table } from "./text.js";
import type { TextView } from "./text-view.js";

/** Số sai khác tối đa in ra khi verify thất bại; phần còn lại chỉ được đếm. */
const MAX_MISMATCHES_SHOWN = 20;

/** Kết quả đối chiếu phép duyệt SQL với phép duyệt bằng JavaScript. */
export class VerifyView implements TextView<VerifyResult> {
  render(result: VerifyResult): string[] {
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
}
