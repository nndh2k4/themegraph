import { VERSION } from "@themegraph/core";
import type { AnalyzeResult } from "@themegraph/core";

import { formatCounts } from "./text.js";
import type { TextView } from "./text-view.js";

/** Kết quả của lệnh analyze: số liệu, tham chiếu hỏng, file lỗi. */
export class AnalyzeView implements TextView<AnalyzeResult> {
  render(result: AnalyzeResult): string[] {
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
}
