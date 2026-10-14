import path from "node:path";

import type { FileKind, ScanResult, ThemeFile } from "../models/index.js";

/**
 * Quy ước thư mục của một Shopify theme: file nào thuộc loại nào, và thế nào
 * thì một thư mục là theme. Toàn hàm thuần trên đường dẫn, không đọc đĩa.
 */

/**
 * Đuôi của những file mà analyze đọc nội dung. Status dùng cùng danh sách này
 * để biết sửa file nào thì đồ thị cũ đi.
 */
export const READ_EXTENSIONS: ReadonlySet<string> = new Set(["liquid", "json", "js"]);

/**
 * Quyết định một file thuộc loại nào dựa trên vị trí và tên của nó.
 *
 * Trả `null` khi file không thuộc quy ước thư mục nào của Shopify —
 * nơi gọi sẽ đưa nó vào danh sách `skipped`.
 *
 * Không đọc nội dung file: mọi quyết định chỉ dựa trên đường dẫn.
 */
function classify(relPath: string, fileName: string, ext: string): FileKind | null {
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
 * Phân loại mọi file của một thư mục theme.
 *
 * `relPaths` là đường dẫn tương đối dùng "/", như ThemeFileRepository trả.
 * Ném lỗi nếu thư mục không phải theme. Kết quả đã sắp xếp.
 */
export function classifyFiles(themeRoot: string, relPaths: readonly string[]): ScanResult {
  const files: ThemeFile[] = [];
  const skipped: string[] = [];

  for (const relPath of relPaths) {
    // Tên file không kèm thư mục, ví dụ 'en.default.schema.json'.
    const fileName = path.posix.basename(relPath);

    // extname() trả về kèm dấu chấm ('.liquid') — cắt đi cho khớp spec.
    const ext = path.posix.extname(fileName).slice(1).toLowerCase();

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
    throw new Error(`"${themeRoot}" không phải thư mục Shopify theme: thiếu layout/*.liquid`);
  }

  // Sắp xếp để kết quả luôn giống nhau giữa các lần chạy và giữa các máy:
  // thứ tự đọc thư mục phụ thuộc hệ điều hành và hệ thống file.
  // So sánh chuỗi thường (theo mã ký tự), KHÔNG dùng localeCompare vì nó
  // phụ thuộc ngôn ngữ của máy, Windows và CI Linux có thể ra thứ tự khác nhau.
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // sort() không tham số trên mảng chuỗi cũng so sánh theo mã ký tự.
  skipped.sort();

  return { files, skipped };
}
