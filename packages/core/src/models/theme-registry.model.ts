/** Một theme đã được phân tích, như ghi trong sổ đăng ký. */
export interface RegistryEntry {
  path: string; // đường dẫn tuyệt đối của thư mục theme
  name: string; // tên thư mục theme, để hiển thị
  analyzedAt: string; // thời điểm phân tích gần nhất, dạng ISO 8601
  nodes: number;
  edges: number;
}

/** Một mục của sổ đăng ký kèm tình trạng hiện tại trên đĩa. */
export interface ListedTheme extends RegistryEntry {
  // false khi đồ thị của theme không còn: theme đã bị xoá, đổi chỗ, hoặc
  // thư mục .themegraph bị xoá tay mà không qua lệnh clean.
  present: boolean;
}
