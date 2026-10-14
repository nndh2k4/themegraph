import type { ListedTheme } from "@themegraph/core";

import { formatTime, table } from "./text.js";
import type { TextView } from "./text-view.js";

/** Các theme đã phân tích trên máy này. */
export class ThemeListView implements TextView<readonly ListedTheme[]> {
  render(themes: readonly ListedTheme[]): string[] {
    if (themes.length === 0) {
      return ['Chưa có theme nào được phân tích. Chạy "themegraph analyze" trong thư mục một theme.'];
    }

    const lines = [
      `Theme đã phân tích (${themes.length}):`,
      ...table(
        themes.map((theme) => [
          theme.name,
          `${theme.nodes} node`,
          `${theme.edges} cạnh`,
          formatTime(theme.analyzedAt),
          theme.path,
          theme.present ? "" : "(không còn graph.db)",
        ]),
      ),
    ];

    if (themes.some((theme) => !theme.present)) {
      lines.push("", 'Theme không còn graph.db: chạy "themegraph clean --theme <đường dẫn>" để gỡ khỏi danh sách.');
    }
    return lines;
  }
}
