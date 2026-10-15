import type { CallContext, Extraction, ThemeFile } from "../../models/index.js";
import { emptyExtraction } from "./file-parser.js";
import type { FileParser } from "./file-parser.js";

/**
 * Phân tích một file của theme: quan hệ thô và dữ kiện schema.
 *
 * Đây là cửa vào duy nhất của tầng parse: nơi gọi không cần biết file là
 * Liquid hay JSON, chỉ cần đưa file (kết quả của ThemeScanner) và nội dung.
 * Việc chọn cách phân tích được giao cho danh sách FileParser (mẫu Strategy):
 * bộ ĐẦU TIÊN nhận file được dùng, nên thứ tự của danh sách là thứ tự ưu tiên.
 * Không bộ nào nhận thì file không có gì để trích (css, ảnh).
 *
 * Ném lỗi có tên file nếu nội dung không phân tích được; nơi gọi quyết định
 * dừng lại hay bỏ qua file đó.
 */
export class ThemeFileParser {
  constructor(private readonly parsers: readonly FileParser[]) {}

  parse(file: ThemeFile, content: string, context?: CallContext): Extraction {
    const parser = this.parsers.find((candidate) => candidate.supports(file));
    return parser === undefined ? emptyExtraction() : parser.parse(file, content, context);
  }
}
