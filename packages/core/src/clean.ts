import { existsSync, rmdirSync, rmSync } from "node:fs";
import path from "node:path";

import { readRegistry, unregisterTheme } from "./registry.js";
import { graphDbPath } from "./store.js";

/** Những gì cleanTheme() đã làm với một theme. */
export interface CleanResult {
  themeRoot: string; // đường dẫn tuyệt đối của theme
  removedFiles: string[]; // đường dẫn tuyệt đối của các file đã xoá
  removedDir: boolean; // thư mục .themegraph có được xoá hay không
  unregistered: boolean; // theme có bị gỡ khỏi sổ đăng ký hay không
}

/**
 * Tên các file ThemeGraph tự tạo trong <theme>/.themegraph. cleanTheme chỉ xoá
 * đúng các file này, không xoá đệ quy cả thư mục: nếu ai đó để thứ khác vào
 * đó thì nó được giữ nguyên.
 */
const OWN_FILES = ["graph.db", "graph.db-wal", "graph.db-shm", "graph.db.tmp", ".gitignore"];

/**
 * Xoá mọi thứ ThemeGraph đã ghi cho một theme: các file trong
 * <theme>/.themegraph và mục của theme trong sổ đăng ký toàn cục.
 *
 * Chạy lại trên một theme đã sạch thì không làm gì và không báo lỗi. Thứ bị
 * xoá chỉ là kết quả phân tích; chạy analyze là có lại.
 */
export function cleanTheme(themeRoot: string): CleanResult {
  const root = path.resolve(themeRoot);
  const dataDir = path.dirname(graphDbPath(root));

  const removedFiles: string[] = [];
  for (const name of OWN_FILES) {
    const file = path.join(dataDir, name);
    if (!existsSync(file)) continue;

    rmSync(file);
    removedFiles.push(file);
  }

  // rmdir chỉ xoá được thư mục RỖNG. Nếu còn file lạ thì nó ném lỗi, và thư
  // mục được giữ lại cùng những file đó.
  let removedDir = false;
  if (existsSync(dataDir)) {
    try {
      rmdirSync(dataDir);
      removedDir = true;
    } catch {
      removedDir = false;
    }
  }

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
