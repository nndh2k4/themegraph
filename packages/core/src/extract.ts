import { extractJsonRefs } from "./extract-json.js";
import { extractLiquid } from "./extract-liquid.js";
import { collectTranslationKeys, isDefaultLocale } from "./extract-locale.js";
import { extractSectionLoads } from "./extract-section-loads.js";
import { collectGlobalSettings, isGlobalSettingsSchema } from "./extract-settings.js";
import type { Extraction, RawRef, ThemeFile } from "./types.js";

/**
 * Phân tích một file của theme: quan hệ thô và dữ kiện schema.
 *
 * Đây là cửa vào duy nhất của tầng parse: nơi gọi không cần biết file là
 * Liquid hay JSON, chỉ cần đưa file (kết quả của scanThemeDir) và nội dung.
 *
 * - file .liquid  -> extractLiquid   (render, section, block, asset, schema...)
 * - file .json    -> extractJsonRefs (chỉ template và section group mới có ref);
 *                    riêng locale mặc định thì trả các khoá dịch nó định nghĩa,
 *                    và config/settings_schema.json trả các setting toàn cục
 * - file .js      -> chỉ các section nó tải qua Section Rendering API
 *                    (extractSectionLoads); mã JavaScript không được phân tích
 * - loại khác     -> không có gì (css, ảnh: không chứa quan hệ nào cần trích)
 *
 * File .liquid cũng được quét thêm bằng extractSectionLoads, vì URL kiểu
 * ?section_id=ten nằm trong phần HTML, nơi bộ phân tích Liquid không trích gì.
 * File assets/*.js.liquid là JavaScript có chèn Liquid nên được quét như .js.
 *
 * Ném lỗi có tên file nếu nội dung không phân tích được; nơi gọi quyết định
 * dừng lại hay bỏ qua file đó.
 */
export function extractFile(file: ThemeFile, content: string): Extraction {
  if (file.ext === "liquid") {
    const extraction = extractLiquid(file, content);
    const source = file.path.endsWith(".js.liquid") ? "js" : "liquid";

    return { ...extraction, refs: [...extraction.refs, ...extractSectionLoads(file.path, content, source)] };
  }
  if (file.ext === "js") {
    return { refs: extractSectionLoads(file.path, content, "js"), schema: null, translationKeys: [], settings: [] };
  }
  if (isDefaultLocale(file)) {
    return { refs: [], schema: null, translationKeys: collectTranslationKeys(file, content), settings: [] };
  }
  if (isGlobalSettingsSchema(file)) {
    return { refs: [], schema: null, translationKeys: [], settings: collectGlobalSettings(file, content) };
  }
  if (file.ext === "json") {
    return { refs: extractJsonRefs(file, content), schema: null, translationKeys: [], settings: [] };
  }
  return { refs: [], schema: null, translationKeys: [], settings: [] };
}

/** Trích mọi quan hệ thô từ một file của theme. Là extractFile() chỉ lấy phần refs. */
export function extractRefs(file: ThemeFile, content: string): RawRef[] {
  return extractFile(file, content).refs;
}
