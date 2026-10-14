import type { ThemeGraph } from "../models/index.js";
import type { GraphRepository } from "./graph.repository.js";

/**
 * Nơi đồ thị của các theme được lưu: mở để đọc, ghi, xoá. Giống DataSource của
 * TypeORM: nó không trả lời câu hỏi nào về đồ thị, chỉ đưa ra một
 * GraphRepository cho đúng một theme.
 */
export interface GraphStore {
  /** Đường dẫn tuyệt đối của file dữ liệu của theme (có thể chưa tồn tại). */
  dbPath(themeRoot: string): string;
  /** Thư mục này có dữ liệu đồ thị hay không, dùng được hay chưa thì chưa biết. */
  hasGraph(dir: string): boolean;
  /**
   * Mở đồ thị của một theme để đọc. Ném GraphNotReadyError nếu theme chưa
   * được phân tích, dữ liệu hỏng, hoặc do một phiên bản lược đồ khác ghi.
   */
  open(themeRoot: string): GraphRepository;
  /** Ghi đồ thị của một theme, thay hẳn bản cũ nếu có. */
  save(themeRoot: string, graph: ThemeGraph, analyzedAt: Date): void;
  /** Xoá mọi thứ đã ghi cho một theme. Chạy lại trên theme đã sạch thì không làm gì. */
  remove(themeRoot: string): RemovedData;
}

/** Những gì GraphStore.remove() đã xoá. */
export interface RemovedData {
  removedFiles: string[]; // đường dẫn tuyệt đối của các file đã xoá
  removedDir: boolean; // thư mục dữ liệu có được xoá hay không
}
