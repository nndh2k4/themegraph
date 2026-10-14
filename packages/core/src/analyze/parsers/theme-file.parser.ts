import { extractElements } from "./extract-elements.js";
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
 * - file .js      -> các section nó tải qua Section Rendering API
 *                    (extractSectionLoads) và các custom element nó định nghĩa
 *                    hoặc dùng (extractElements); mã JavaScript không được
 *                    phân tích cú pháp
 * - loại khác     -> không có gì (css, ảnh: không chứa quan hệ nào cần trích)
 *
 * File .liquid cũng được quét thêm bằng extractSectionLoads, vì URL kiểu
 * ?section_id=ten nằm trong phần HTML, nơi bộ phân tích Liquid không trích gì.
 * File assets/*.js.liquid là JavaScript có chèn Liquid nên được quét như .js.
 * File .liquid cũng được quét bằng extractElements, vì thẻ custom element nằm
 * trong phần HTML.
 *
 * Ném lỗi có tên file nếu nội dung không phân tích được; nơi gọi quyết định
 * dừng lại hay bỏ qua file đó.
 */
export function extractFile(file: ThemeFile, content: string): Extraction {
  if (file.ext === "liquid") {
    const extraction = extractLiquid(file, content);
    const source = file.path.endsWith(".js.liquid") ? "js" : "liquid";

    return {
      ...extraction,
      refs: [...extraction.refs, ...extractSectionLoads(file.path, content, source)],
      elements: extractElements(content),
    };
  }

  const nothing: Extraction = { refs: [], schema: null, translationKeys: [], settings: [], elements: [] };

  if (file.ext === "js") {
    return { ...nothing, refs: extractSectionLoads(file.path, content, "js"), elements: extractElements(content) };
  }
  if (isDefaultLocale(file)) {
    return { ...nothing, translationKeys: collectTranslationKeys(file, content) };
  }
  if (isGlobalSettingsSchema(file)) {
    return { ...nothing, settings: collectGlobalSettings(file, content) };
  }
  if (file.ext === "json") {
    return { ...nothing, refs: extractJsonRefs(file, content) };
  }
  return nothing;
}

/** Trích mọi quan hệ thô từ một file của theme. Là extractFile() chỉ lấy phần refs. */
export function extractRefs(file: ThemeFile, content: string): RawRef[] {
  return extractFile(file, content).refs;
}
