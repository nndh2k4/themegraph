import { extractJsonRefs } from "./extract-json.js";
import { extractLiquid } from "./extract-liquid.js";
import type { Extraction, RawRef, ThemeFile } from "./types.js";

/**
 * Phân tích một file của theme: quan hệ thô và dữ kiện schema.
 *
 * Đây là cửa vào duy nhất của tầng parse: nơi gọi không cần biết file là
 * Liquid hay JSON, chỉ cần đưa file (kết quả của scanThemeDir) và nội dung.
 *
 * - file .liquid  -> extractLiquid   (render, section, block, asset, schema...)
 * - file .json    -> extractJsonRefs (chỉ template và section group mới có ref)
 * - loại khác     -> không có gì (css, js, ảnh: không chứa quan hệ nào cần trích)
 *
 * Ném lỗi có tên file nếu nội dung không phân tích được; nơi gọi quyết định
 * dừng lại hay bỏ qua file đó.
 */
export function extractFile(file: ThemeFile, content: string): Extraction {
  if (file.ext === "liquid") return extractLiquid(file, content);
  if (file.ext === "json") return { refs: extractJsonRefs(file, content), schema: null };
  return { refs: [], schema: null };
}

/** Trích mọi quan hệ thô từ một file của theme. Là extractFile() chỉ lấy phần refs. */
export function extractRefs(file: ThemeFile, content: string): RawRef[] {
  return extractFile(file, content).refs;
}
