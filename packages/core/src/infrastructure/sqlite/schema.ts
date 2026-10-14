import path from "node:path";

/**
 * Phiên bản của lược đồ bảng bên dưới. Tăng số này mỗi khi đổi cấu trúc bảng,
 * hoặc khi analyze bắt đầu ghi thêm một loại quan hệ (bản 5: cạnh
 * LOADS_SECTION và hash của file .js; bản 6: bảng elements), để công cụ đọc
 * biết một graph.db cũ có còn dùng được hay phải analyze lại.
 */
export const SCHEMA_VERSION = 6;

/** Thư mục công cụ ghi dữ liệu vào, nằm ngay trong thư mục theme. */
export const DATA_DIR = ".themegraph";

/**
 * Tên các file ThemeGraph tự tạo trong <theme>/.themegraph. Khi xoá dữ liệu
 * chỉ xoá đúng các file này, không xoá đệ quy cả thư mục: nếu ai đó để thứ
 * khác vào đó thì nó được giữ nguyên.
 */
export const OWN_FILES = ["graph.db", "graph.db-wal", "graph.db-shm", "graph.db.tmp", ".gitignore"];

/** Đường dẫn tới graph.db của một theme. */
export function graphDbPath(themeRoot: string): string {
  return path.join(themeRoot, DATA_DIR, "graph.db");
}

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
 *
 * file_hashes: hash nội dung của từng file analyze đã đọc. Lệnh status so nó
 * với nội dung hiện có trên đĩa để biết đồ thị còn khớp hay không.
 *
 * elements: file nào định nghĩa và file nào dùng mỗi custom element. Để ở
 * bảng riêng chứ không thành cạnh, vì "file này viết thẻ <cart-drawer>" không
 * phải là "file này gọi assets/cart-drawer.js": thẻ chỉ chạy khi có một thẻ
 * <script> nạp file kia, và chính chỗ lệch giữa hai điều đó là thứ dead-code
 * cần tìm.
 */
export const SCHEMA_SQL = `
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

CREATE TABLE file_hashes (
  file TEXT PRIMARY KEY REFERENCES nodes (id),
  hash TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE elements (
  name TEXT    NOT NULL,
  role TEXT    NOT NULL CHECK (role IN ('define', 'use')),
  file TEXT    NOT NULL REFERENCES nodes (id),
  line INTEGER NOT NULL,
  PRIMARY KEY (name, role, file)
) STRICT, WITHOUT ROWID;
`;
