import type { Extraction, ThemeFile } from "../../models/index.js";

/**
 * Một bộ phân tích cho một loại file của theme (mẫu Strategy). ThemeFileParser
 * giữ một danh sách các bộ này và dùng bộ ĐẦU TIÊN nhận file.
 */
export interface FileParser {
  /** Bộ này có phân tích file này không. Chỉ nhìn đường dẫn và đuôi, không đọc nội dung. */
  supports(file: ThemeFile): boolean;
  /** Mọi thứ rút ra được từ file. Ném lỗi có tên file nếu nội dung không phân tích được. */
  parse(file: ThemeFile, content: string): Extraction;
}

/** Kết quả của một file không có gì để trích. */
export function emptyExtraction(): Extraction {
  return { refs: [], schema: null, translationKeys: [], settings: [], elements: [], importMap: [] };
}
