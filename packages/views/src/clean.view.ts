import type { CleanResult } from "@themegraph/core";

import type { TextView } from "./text-view.js";

/** Những gì lệnh clean đã xoá, theme theo theme. */
export class CleanView implements TextView<readonly CleanResult[]> {
  render(results: readonly CleanResult[]): string[] {
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
}
