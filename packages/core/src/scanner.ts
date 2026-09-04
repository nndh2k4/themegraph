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

  return null;
}

/**
 * Quét một thư mục Shopify theme và phân loại từng file.
 *
 * Hàm chỉ biết đúng một thứ: tham số `themeRoot`. Không đọc process.cwd(),
 * không đọc nội dung file — chỉ đi thư mục và nhìn tên.
 */
export async function scanThemeDir(themeRoot: string): Promise<ScanResult> {
  const entries = await readdir(themeRoot, {
    recursive: true,
    withFileTypes: true,
  });

  const files: ThemeFile[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    // Đường dẫn tương đối so với gốc theme, luôn dùng '/'.
    // Đây là điểm chuẩn hoá DUY NHẤT — mọi chỗ khác tin vào kết quả của nó.
    const absolute = path.join(entry.parentPath, entry.name);
    const relPath = path.relative(themeRoot, absolute).split(path.sep).join("/");

    // extname() trả về kèm dấu chấm ('.liquid') — cắt đi cho khớp spec.
    const ext = path.extname(entry.name).slice(1).toLowerCase();

    const kind = classify(relPath, entry.name, ext);

    if (kind === null) {
      skipped.push(relPath);
    } else {
      files.push({ path: relPath, kind, ext });
    }
  }

  return { files, skipped };
}
