import path from "node:path";

import { hashContent } from "@themegraph/core";

/**
 * Mã của một theme trong đường dẫn API: 12 ký tự đầu của hash đường dẫn.
 *
 * Không dùng tên theme vì hai theme ở hai nơi có thể trùng tên thư mục, và
 * không dùng thẳng đường dẫn vì nó chứa dấu gạch chéo và dấu cách. Mã chỉ phụ
 * thuộc đường dẫn, nên giữ nguyên qua các lần phân tích lại.
 */
export function themeId(themeRoot: string): string {
  const resolved = path.resolve(themeRoot);
  // Windows không phân biệt hoa thường trong đường dẫn.
  return hashContent(process.platform === "win32" ? resolved.toLowerCase() : resolved).slice(0, 12);
}
