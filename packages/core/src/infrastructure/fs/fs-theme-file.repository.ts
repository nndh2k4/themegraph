import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ThemeFileRepository } from "../../theme/theme-file.repository.js";

/**
 * Thư mục không bao giờ thuộc về theme, nên không đi vào.
 *
 * - Thư mục ẩn (tên bắt đầu bằng dấu chấm): .git, .github, và quan trọng nhất
 *   là .themegraph — nơi chính công cụ này ghi graph.db. Không chặn thì lần
 *   analyze thứ hai sẽ quét luôn output của lần thứ nhất.
 * - node_modules: một số theme có bước build riêng và để thư mục này ở gốc.
 */
function isIgnoredDir(dirName: string): boolean {
  return dirName.startsWith(".") || dirName === "node_modules";
}

/**
 * Duyệt đệ quy một thư mục, trả về đường dẫn tuyệt đối của mọi file bên trong.
 *
 * Tự viết đệ quy thay vì dùng readdir({ recursive: true }) vì tuỳ chọn đó
 * không cho chặn một thư mục TRƯỚC khi đi vào: nó vẫn đọc hết .git rồi mới
 * trả kết quả, vừa chậm vừa đổ hàng loạt đường dẫn rác ra ngoài.
 */
async function walk(dir: string): Promise<string[]> {
  // withFileTypes: mỗi entry là một Dirent, hỏi được isDirectory()/isFile()
  // mà không cần gọi stat() thêm một lần cho từng file.
  const entries = await readdir(dir, { withFileTypes: true });

  const found: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Chặn ngay tại đây: thư mục bị bỏ qua thì không đọc nội dung của nó.
      if (isIgnoredDir(entry.name)) continue;

      // Đi xuống một tầng rồi gộp kết quả của tầng dưới vào mảng chung.
      found.push(...(await walk(absolute)));
    } else if (entry.isFile()) {
      found.push(absolute);
    }
    // Loại còn lại (symlink, socket...) bị bỏ qua: theme Shopify không dùng,
    // và đi theo symlink có thể dẫn ra ngoài thư mục theme.
  }

  return found;
}

/** Bản hiện thực ThemeFileRepository trên hệ thống file thật. */
export class FsThemeFileRepository implements ThemeFileRepository {
  async listFiles(themeRoot: string): Promise<string[]> {
    // Đường dẫn tương đối so với gốc theme, luôn dùng '/'. Đây là điểm chuẩn
    // hoá DUY NHẤT — mọi chỗ khác tin vào kết quả của nó.
    return (await walk(themeRoot)).map((absolute) => path.relative(themeRoot, absolute).split(path.sep).join("/"));
  }

  readFile(themeRoot: string, filePath: string): Promise<string> {
    return readFile(path.join(themeRoot, filePath), "utf8");
  }
}
