import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { graphDbPath, SCHEMA_VERSION } from "./store.js";

/**
 * Vì sao không mở được đồ thị của một theme.
 *
 * - not_analyzed: theme chưa có .themegraph/graph.db
 * - unreadable:   có file graph.db nhưng không đọc được (không phải SQLite,
 *                 hoặc thiếu bảng)
 * - outdated:     graph.db do một phiên bản lược đồ khác ghi ra
 *
 * Cả ba đều có cùng cách chữa: chạy lại "themegraph analyze".
 */
export type GraphNotReadyReason = "not_analyzed" | "unreadable" | "outdated";

/**
 * Lỗi ném ra khi một theme chưa có đồ thị dùng được. Là một lớp riêng để lớp
 * gọi (CLI, MCP) phân biệt được "người dùng cần chạy analyze" với lỗi lập
 * trình, và đọc `reason` mà không phải dò chữ trong thông báo.
 */
export class GraphNotReadyError extends Error {
  readonly reason: GraphNotReadyReason;

  constructor(reason: GraphNotReadyReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GraphNotReadyError";
    this.reason = reason;
  }
}

/** Thông tin về lần phân tích đã ghi ra graph.db, đọc từ bảng meta. */
export interface GraphMeta {
  schemaVersion: number;
  toolVersion: string;
  analyzedAt: string; // thời điểm phân tích, dạng ISO 8601
}

/**
 * Một đồ thị đang mở để truy vấn. Mọi hàm truy vấn của lõi nhận đối tượng này.
 * Người mở phải gọi close() khi xong, nếu không file graph.db bị giữ.
 */
export interface GraphHandle {
  readonly themeRoot: string; // đường dẫn tuyệt đối của theme
  readonly dbPath: string; // đường dẫn tuyệt đối của graph.db
  readonly meta: GraphMeta;
  readonly db: DatabaseSync;
  close(): void;
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
    if (existsSync(graphDbPath(dir))) return dir;

    // Ở gốc ổ đĩa, thư mục cha của một thư mục là chính nó: hết đường đi lên.
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Mở đồ thị của một theme để truy vấn.
 *
 * Mở ở chế độ CHỈ ĐỌC: truy vấn không bao giờ sửa được đồ thị, và nếu file
 * không tồn tại thì SQLite không lặng lẽ tạo ra một database rỗng.
 *
 * Ném GraphNotReadyError nếu theme chưa được phân tích, graph.db hỏng, hoặc
 * graph.db thuộc một phiên bản lược đồ khác.
 */
export function openGraph(themeRoot: string): GraphHandle {
  const root = path.resolve(themeRoot);
  const dbPath = graphDbPath(root);

  if (!existsSync(dbPath)) {
    throw new GraphNotReadyError(
      "not_analyzed",
      `Chưa có đồ thị cho theme ở "${root}". Chạy "themegraph analyze" trong thư mục theme trước.`,
    );
  }

  let db: DatabaseSync | undefined;
  let meta: Map<string, string>;

  try {
    db = new DatabaseSync(dbPath, { readOnly: true });

    // SQLite chỉ thật sự đọc file ở câu truy vấn đầu tiên, nên một file không
    // phải database sẽ lộ ra ở đây chứ không phải ở dòng trên.
    meta = new Map(
      db
        .prepare("SELECT key, value FROM meta")
        .all()
        .map((row) => [String(row.key), String(row.value)]),
    );
  } catch (error) {
    // Đóng trước khi ném: không được giữ file khi mở thất bại.
    db?.close();
    throw new GraphNotReadyError(
      "unreadable",
      `Không đọc được "${dbPath}". Chạy lại "themegraph analyze" để ghi lại đồ thị.`,
      { cause: error },
    );
  }

  const schemaVersion = Number(meta.get("schema_version"));

  if (schemaVersion !== SCHEMA_VERSION) {
    db.close();
    throw new GraphNotReadyError(
      "outdated",
      `"${dbPath}" dùng lược đồ phiên bản ${meta.get("schema_version") ?? "không rõ"}, ` +
        `công cụ này cần phiên bản ${SCHEMA_VERSION}. Chạy lại "themegraph analyze".`,
    );
  }

  // Giữ một biến không thể undefined cho hàm close() bên dưới.
  const opened = db;

  return {
    themeRoot: root,
    dbPath,
    meta: {
      schemaVersion,
      toolVersion: meta.get("tool_version") ?? "",
      analyzedAt: meta.get("analyzed_at") ?? "",
    },
    db: opened,
    close: () => opened.close(),
  };
}
