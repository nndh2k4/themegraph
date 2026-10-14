/** Tình trạng đồ thị của một theme so với các file hiện có trên đĩa. */
export interface StatusResult {
  themeRoot: string;
  dbPath: string;
  analyzedAt: string; // thời điểm phân tích, dạng ISO 8601
  toolVersion: string; // phiên bản ThemeGraph đã ghi ra đồ thị
  nodes: number;
  edges: number;
  // true khi theme đã đổi từ lần phân tích, tức ít nhất một trong ba danh
  // sách dưới đây không rỗng. Khi đó kết quả truy vấn có thể không còn đúng.
  stale: boolean;
  modified: string[]; // file có trong đồ thị mà nội dung đã khác lúc phân tích
  added: string[]; // file có trên đĩa nhưng chưa có trong đồ thị
  removed: string[]; // file có trong đồ thị nhưng không còn trên đĩa
}

/** Những gì ThemeService.clean() đã làm với một theme. */
export interface CleanResult {
  themeRoot: string; // đường dẫn tuyệt đối của theme
  removedFiles: string[]; // đường dẫn tuyệt đối của các file đã xoá
  removedDir: boolean; // thư mục .themegraph có được xoá hay không
  unregistered: boolean; // theme có bị gỡ khỏi sổ đăng ký hay không
}
