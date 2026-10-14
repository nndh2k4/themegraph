import path from "node:path";

/**
 * Dạng dùng để SO SÁNH hai đường dẫn thư mục. Trên Windows, C:\Themes\Dawn và
 * c:\themes\dawn là cùng một thư mục, nên so ở dạng chữ thường; trên các hệ
 * khác thì phân biệt hoa thường như hệ thống file.
 */
export function pathKey(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
