/**
 * Cổng đọc các file của một theme trên đĩa. Service không đọc đĩa trực tiếp:
 * chúng hỏi qua interface này, nên test thay được bằng một bản trong bộ nhớ.
 */
export interface ThemeFileRepository {
  /**
   * Đường dẫn TƯƠNG ĐỐI (luôn dùng "/") của mọi file trong thư mục theme, bỏ
   * qua những thư mục không bao giờ thuộc về theme (thư mục ẩn, node_modules).
   * Thứ tự không được bảo đảm. Ném lỗi nếu thư mục không đọc được.
   */
  listFiles(themeRoot: string): Promise<string[]>;
  /** Nội dung của một file, theo đường dẫn tương đối như listFiles() trả. */
  readFile(themeRoot: string, filePath: string): Promise<string>;
}
