import path from "node:path";

import { readRegistry, unregisterTheme } from "../infrastructure/registry/json-theme-registry.repository.js";
import { legacyStore } from "../legacy.js";

/** Những gì cleanTheme() đã làm với một theme. */
export interface CleanResult {
  themeRoot: string; // đường dẫn tuyệt đối của theme
  removedFiles: string[]; // đường dẫn tuyệt đối của các file đã xoá
  removedDir: boolean; // thư mục .themegraph có được xoá hay không
  unregistered: boolean; // theme có bị gỡ khỏi sổ đăng ký hay không
}

/**
 * Xoá mọi thứ ThemeGraph đã ghi cho một theme: các file trong
 * <theme>/.themegraph và mục của theme trong sổ đăng ký toàn cục.
 *
 * Chạy lại trên một theme đã sạch thì không làm gì và không báo lỗi. Thứ bị
 * xoá chỉ là kết quả phân tích; chạy analyze là có lại.
 */
export function cleanTheme(themeRoot: string): CleanResult {
  const root = path.resolve(themeRoot);
  const { removedFiles, removedDir } = legacyStore.remove(root);

  return { themeRoot: root, removedFiles, removedDir, unregistered: unregisterTheme(root) };
}

/**
 * Xoá dữ liệu của MỌI theme trong sổ đăng ký. Theme đã bị xoá hoặc đổi chỗ
 * thì chỉ còn mục trong sổ để gỡ. Trả về kết quả của từng theme, theo thứ tự
 * của sổ đăng ký.
 */
export function cleanAllThemes(): CleanResult[] {
  return readRegistry().map((entry) => cleanTheme(entry.path));
}
