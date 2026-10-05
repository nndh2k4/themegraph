import { readdir } from "node:fs/promises";
import path from "node:path";

import type { FileKind, ScanResult, ThemeFile } from "./types.js";

/**
 * Quyết định một file thuộc loại nào dựa trên vị trí và tên của nó.
 *
 * Trả `null` khi file không thuộc quy ước thư mục nào của Shopify —
 * nơi gọi sẽ đưa nó vào danh sách `skipped`.
 *
 * Không đọc nội dung file: mọi quyết định chỉ dựa trên đường dẫn.
 */
function classify(
  relPath: string,
  fileName: string,
  ext: string,
): FileKind | null {
  if (relPath.startsWith("snippets/") && ext === "liquid") return "snippet";

  if (relPath.startsWith("sections/")) {
    // Phân biệt bằng ĐUÔI FILE, không bằng hậu tố '-group' trong tên:
    // '-group' chỉ là thói quen đặt tên của Dawn và Purity, không phải
    // quy ước của Shopify.
    if (ext === "liquid") return "section";
    if (ext === "json") return "section_group";
    return null;
  }

  if (relPath.startsWith("templates/") && (ext === "json" || ext === "liquid")) {
    return "template";
  }

  if (relPath.startsWith("locales/")) {
    // PHẢI hỏi '.schema.json' TRƯỚC: cả hai loại đều có ext === 'json',
    // đảo thứ tự thì mọi file *.schema.json bị nuốt thành 'locale'.
    if (fileName.endsWith(".schema.json")) return "locale_schema";
    if (ext === "json") return "locale";
    return null;
  }

  if (relPath.startsWith("layout/") && ext === "liquid") return "layout";
  if (relPath.startsWith("blocks/") && ext === "liquid") return "block";
  if (relPath.startsWith("config/") && ext === "json") return "config";

  // Không lọc theo đuôi: assets/ chứa css, js, svg, png, webp, gif, map...
  if (relPath.startsWith("assets/")) return "asset";

  return null;
}

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

/**
 * Quét một thư mục Shopify theme và phân loại từng file.
 *
 * Hàm chỉ biết đúng một thứ: tham số `themeRoot`. Không đọc process.cwd(),
 * không đọc nội dung file — chỉ đi thư mục và nhìn tên.
 */
export async function scanThemeDir(themeRoot: string): Promise<ScanResult> {
  // Danh sách đường dẫn tuyệt đối của mọi file trong theme, đã loại các
  // thư mục ẩn và node_modules.
  const absolutePaths = await walk(themeRoot);

  const files: ThemeFile[] = [];
  const skipped: string[] = [];

  for (const absolute of absolutePaths) {
    // Đường dẫn tương đối so với gốc theme, luôn dùng '/'.
    // Đây là điểm chuẩn hoá DUY NHẤT — mọi chỗ khác tin vào kết quả của nó.
    const relPath = path.relative(themeRoot, absolute).split(path.sep).join("/");

    // Tên file không kèm thư mục, ví dụ 'en.default.schema.json'.
    const fileName = path.basename(absolute);

    // extname() trả về kèm dấu chấm ('.liquid') — cắt đi cho khớp spec.
    const ext = path.extname(fileName).slice(1).toLowerCase();

    const kind = classify(relPath, fileName, ext);

    // null nghĩa là file nằm trong theme nhưng không thuộc quy ước thư mục
    // nào của Shopify (README.md, listings/...). Ghi lại thay vì bỏ im lặng.
    if (kind === null) {
      skipped.push(relPath);
    } else {
      files.push({ path: relPath, kind, ext });
    }
  }

  // Mọi Shopify theme đều phải có ít nhất một file layout/*.liquid. Không có
  // thì gần như chắc chắn người dùng trỏ nhầm thư mục, nên dừng lại với một
  // thông báo nói rõ đường dẫn và lý do, thay vì trả về một kết quả rỗng
  // trông như "theme không có gì".
  if (!files.some((file) => file.kind === "layout")) {
    throw new Error(
      `"${themeRoot}" không phải thư mục Shopify theme: thiếu layout/*.liquid`,
    );
  }

  // Sắp xếp để kết quả luôn giống nhau giữa các lần chạy và giữa các máy:
  // thứ tự readdir() trả về phụ thuộc hệ điều hành và hệ thống file.
  // So sánh chuỗi thường (theo mã ký tự), KHÔNG dùng localeCompare vì nó
  // phụ thuộc ngôn ngữ của máy, Windows và CI Linux có thể ra thứ tự khác nhau.
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // sort() không tham số trên mảng chuỗi cũng so sánh theo mã ký tự.
  skipped.sort();

  return { files, skipped };
}
