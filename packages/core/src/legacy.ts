import path from "node:path";

import type { GraphRepository } from "./graph/graph.repository.js";
import type { ThemeGraph } from "./models/index.js";
import { SqliteGraphStore } from "./infrastructure/sqlite/sqlite-graph.store.js";

/**
 * API dạng hàm của bản cũ, giữ TẠM trong lúc các lớp vỏ chuyển sang module
 * và controller. Mỗi hàm chỉ chuyển lời gọi sang class tương ứng.
 * File này bị xoá khi không còn ai dùng.
 */

export const legacyStore = new SqliteGraphStore();

export interface SaveGraphOptions {
  /** Thời điểm ghi vào bảng meta. Mặc định là lúc gọi hàm; test truyền giá trị cố định. */
  analyzedAt?: Date;
}

/** Mở đồ thị của một theme để đọc. Xem SqliteGraphStore.open(). */
export function openGraph(themeRoot: string): GraphRepository {
  return legacyStore.open(themeRoot);
}

/** Ghi đồ thị của một theme. Xem SqliteGraphStore.save(). */
export function saveGraph(themeRoot: string, graph: ThemeGraph, options: SaveGraphOptions = {}): void {
  legacyStore.save(themeRoot, graph, options.analyzedAt ?? new Date());
}

/**
 * Tìm thư mục theme chứa `startDir`: đi từ `startDir` ngược lên thư mục cha
 * cho tới khi gặp thư mục có .themegraph/graph.db, giống cách git tìm .git.
 *
 * Nhờ vậy người dùng đứng ở bất cứ đâu bên trong theme (ví dụ trong
 * sections/) vẫn gọi được lệnh truy vấn. Trả null nếu không tìm thấy.
 */
export function findThemeRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);

  for (;;) {
    if (legacyStore.hasGraph(dir)) return dir;

    // Ở gốc ổ đĩa, thư mục cha của một thư mục là chính nó: hết đường đi lên.
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
