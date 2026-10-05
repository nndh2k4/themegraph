import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ThemeGraph } from "./types.js";
import { VERSION } from "./version.js";

/**
 * Phiên bản của lược đồ bảng bên dưới. Tăng số này mỗi khi đổi cấu trúc bảng,
 * để công cụ đọc biết một graph.db cũ có còn dùng được hay phải analyze lại.
 */
export const SCHEMA_VERSION = 2;

/** Thư mục công cụ ghi dữ liệu vào, nằm ngay trong thư mục theme. */
const DATA_DIR = ".themegraph";

/**
 * Lược đồ của graph.db.
 *
 * STRICT: SQLite mặc định cho ghi chuỗi vào cột số; STRICT bắt đúng kiểu.
 *
 * WITHOUT ROWID: dữ liệu của bảng được xếp ngay theo khoá chính thay vì theo
 * một số thứ tự ẩn. Với `edges`, khoá chính bắt đầu bằng `src`, nên chính
 * bảng đã là một index cho câu hỏi "node này trỏ tới đâu" (đi XUÔI).
 *
 * edges_by_dst: index cho chiều ngược lại, "ai trỏ tới node này" (đi NGƯỢC).
 * Không có nó, mỗi bước của truy vấn ngược phải đọc toàn bộ bảng edges.
 *
 * schemas: dữ kiện đọc từ {% schema %} của section và block. Để ở bảng riêng
 * thay vì thêm cột vào nodes, vì phần lớn node (snippet, asset, loại trang...)
 * không có schema.
 */
const SCHEMA_SQL = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE nodes (
  id   TEXT PRIMARY KEY,
  kind TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE edges (
  src         TEXT    NOT NULL REFERENCES nodes (id),
  dst         TEXT    NOT NULL REFERENCES nodes (id),
  type        TEXT    NOT NULL,
  conditional INTEGER NOT NULL CHECK (conditional IN (0, 1)),
  sources     TEXT    NOT NULL,
  count       INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (src, dst, type)
) STRICT, WITHOUT ROWID;

CREATE INDEX edges_by_dst ON edges (dst, type);

CREATE TABLE refs (
  id          INTEGER PRIMARY KEY,
  src         TEXT    NOT NULL REFERENCES nodes (id),
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  source      TEXT    NOT NULL,
  conditional INTEGER NOT NULL CHECK (conditional IN (0, 1)),
  line        INTEGER NOT NULL,
  status      TEXT    NOT NULL,
  target      TEXT
) STRICT;

CREATE INDEX refs_by_src ON refs (src);
CREATE INDEX refs_by_target ON refs (target);

CREATE TABLE schemas (
  file                 TEXT    PRIMARY KEY REFERENCES nodes (id),
  presets              INTEGER NOT NULL CHECK (presets >= 0),
  accepts_theme_blocks INTEGER NOT NULL CHECK (accepts_theme_blocks IN (0, 1))
) STRICT, WITHOUT ROWID;
`;

/** Đường dẫn tới graph.db của một theme. */
export function graphDbPath(themeRoot: string): string {
  return path.join(themeRoot, DATA_DIR, "graph.db");
}

export interface SaveGraphOptions {
  /** Thời điểm ghi vào bảng meta. Mặc định là lúc gọi hàm; test truyền giá trị cố định. */
  analyzedAt?: Date;
}

/**
 * Ghi đồ thị của một theme vào <themeRoot>/.themegraph/graph.db, thay hẳn
 * database cũ nếu có.
 *
 * Ghi vào một file tạm rồi mới đổi tên thành graph.db. Nhờ vậy graph.db luôn
 * là một database hoàn chỉnh: hoặc bản cũ, hoặc bản mới, không bao giờ là
 * bản đang ghi dở nếu tiến trình bị ngắt giữa chừng.
 */
export function saveGraph(themeRoot: string, graph: ThemeGraph, options: SaveGraphOptions = {}): void {
  const dataDir = path.join(themeRoot, DATA_DIR);
  const finalPath = graphDbPath(themeRoot);
  const tempPath = `${finalPath}.tmp`;

  mkdirSync(dataDir, { recursive: true });

  // File .gitignore chứa "*" khiến git bỏ qua mọi thứ trong thư mục này, kể cả
  // chính nó. Theme không cần sửa .gitignore của mình để tránh commit graph.db.
  writeFileSync(path.join(dataDir, ".gitignore"), "*\n");

  // Dọn file tạm còn sót từ một lần chạy bị ngắt trước đó.
  rmSync(tempPath, { force: true });

  const db = new DatabaseSync(tempPath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(SCHEMA_SQL);

    // Câu lệnh được chuẩn bị một lần rồi chạy lại nhiều lần với giá trị khác
    // nhau; dấu ? giữ chỗ cho giá trị, nên không phải tự ghép chuỗi SQL.
    const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    const insertNode = db.prepare("INSERT INTO nodes (id, kind) VALUES (?, ?)");
    const insertEdge = db.prepare(
      "INSERT INTO edges (src, dst, type, conditional, sources, count) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertRef = db.prepare(
      `INSERT INTO refs (src, name, kind, source, conditional, line, status, target)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSchema = db.prepare(
      "INSERT INTO schemas (file, presets, accepts_theme_blocks) VALUES (?, ?, ?)",
    );

    // Một transaction cho toàn bộ: nhanh hơn nhiều so với để mỗi INSERT tự
    // commit, và nếu có lỗi giữa chừng thì không dòng nào được ghi.
    db.exec("BEGIN");
    try {
      insertMeta.run("schema_version", String(SCHEMA_VERSION));
      insertMeta.run("tool_version", VERSION);
      insertMeta.run("analyzed_at", (options.analyzedAt ?? new Date()).toISOString());

      // Node trước, cạnh sau: khoá ngoại đòi node phải có sẵn khi chèn cạnh.
      for (const node of graph.nodes) {
        insertNode.run(node.id, node.kind);
      }

      for (const edge of graph.edges) {
        insertEdge.run(
          edge.from,
          edge.to,
          edge.type,
          edge.conditional ? 1 : 0, // SQLite không có kiểu boolean
          edge.sources,
          edge.count,
        );
      }

      for (const ref of graph.refs) {
        insertRef.run(
          ref.from,
          ref.to,
          ref.kind,
          ref.source,
          ref.conditional ? 1 : 0,
          ref.line,
          ref.status,
          ref.target,
        );
      }

      for (const schema of graph.schemas) {
        insertSchema.run(schema.file, schema.presets, schema.acceptsThemeBlocks ? 1 : 0);
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    db.close();
    rmSync(tempPath, { force: true });
    throw error;
  }

  // Phải đóng trước khi đổi tên: Windows không cho đổi tên file đang mở.
  db.close();

  // Database cũ ở chế độ WAL để lại hai file phụ cạnh nó. Xoá chúng trước,
  // nếu không SQLite sẽ áp nhật ký của database cũ lên database mới.
  rmSync(`${finalPath}-wal`, { force: true });
  rmSync(`${finalPath}-shm`, { force: true });

  renameSync(tempPath, finalPath);
}
