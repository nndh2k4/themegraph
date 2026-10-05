import { extractJsonRefs } from "./extract-json.js";
import { extractLiquidRefs } from "./extract-liquid.js";
import type { RawRef, ThemeFile } from "./types.js";

/**
 * Trích mọi quan hệ thô từ một file của theme.
 *
 * Đây là cửa vào duy nhất của tầng parse: nơi gọi không cần biết file là
 * Liquid hay JSON, chỉ cần đưa file (kết quả của scanThemeDir) và nội dung.
 *
 * - file .liquid  -> extractLiquidRefs (render, section, block, asset, schema...)
 * - file .json    -> extractJsonRefs   (chỉ template và section group mới có ref)
 * - loại khác     -> mảng rỗng (css, js, ảnh: không chứa quan hệ nào cần trích)
 *
 * Ném lỗi có tên file nếu nội dung không phân tích được; nơi gọi quyết định
 * dừng lại hay bỏ qua file đó.
 */
export function extractRefs(file: ThemeFile, content: string): RawRef[] {
  if (file.ext === "liquid") return extractLiquidRefs(file, content);
  if (file.ext === "json") return extractJsonRefs(file, content);
  return [];
}
