import type { ResolvedRef } from "../../models/index.js";

/** Một file không phân tích được, kèm lý do. */
export interface AnalyzeError {
  path: string; // cùng định dạng với ThemeFile.path
  message: string;
}

/** Các con số tóm tắt của một lần phân tích. */
export interface AnalyzeStats {
  files: number;
  nodes: number;
  edges: number;
  refs: number;
  nodesByKind: Record<string, number>;
  edgesByType: Record<string, number>;
  refsByStatus: Record<string, number>;
}

/** Kết quả của AnalyzeService: đủ để lớp vỏ (CLI, MCP, server) in ra hoặc trả về. */
export interface AnalyzeResult {
  themeRoot: string; // đường dẫn tuyệt đối của theme đã phân tích
  dbPath: string; // đường dẫn tuyệt đối của graph.db vừa ghi
  stats: AnalyzeStats;
  missing: ResolvedRef[]; // các tham chiếu hỏng, kèm file và dòng
  skipped: string[]; // file nằm trong theme nhưng ngoài quy ước thư mục
  // File không đọc hoặc không phân tích được (hỏng hẳn), và cảnh báo của file
  // chỉ đọc được một phần (ví dụ {% schema %} sai JSON). Xếp theo path rồi message.
  errors: AnalyzeError[];
  // false khi không ghi được theme vào sổ đăng ký toàn cục (ví dụ thư mục home
  // không cho ghi). Đồ thị vẫn được ghi đầy đủ; chỉ lệnh list là không thấy theme.
  registered: boolean;
  durationMs: number;
}
