import type { ScanResult } from "../models/index.js";
import { classifyFiles } from "./theme-layout.js";
import type { ThemeFileRepository } from "./theme-file.repository.js";

/**
 * Quét một thư mục Shopify theme và phân loại từng file. Analyze và status
 * cùng dùng nó, nên hai lệnh luôn thấy cùng một danh sách file.
 */
export class ThemeScanner {
  constructor(private readonly files: ThemeFileRepository) {}

  /** Ném lỗi nếu thư mục không phải theme (thiếu layout/*.liquid). */
  async scan(themeRoot: string): Promise<ScanResult> {
    return classifyFiles(themeRoot, await this.files.listFiles(themeRoot));
  }
}
