export interface FindNodeOptions {
  /**
   * Thư mục dùng để hiểu đường dẫn tương đối, thường là thư mục đang đứng của
   * người gọi lệnh. Không có thì đường dẫn tương đối được tính từ gốc theme.
   */
  baseDir?: string;
}
