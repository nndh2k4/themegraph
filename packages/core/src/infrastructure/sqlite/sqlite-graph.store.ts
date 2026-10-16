import { existsSync, mkdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { GraphNotReadyError } from "../../common/errors.js";
import { VERSION } from "../../common/version.js";
import type { GraphRepository } from "../../graph/graph.repository.js";
import type { GraphStore, RemovedData } from "../../graph/graph.store.js";
import type { ThemeGraph } from "../../models/index.js";
import { DATA_DIR, graphDbPath, OWN_FILES, SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";
import { SqliteGraphRepository } from "./sqlite-graph.repository.js";

/**
 * Bản hiện thực GraphStore bằng SQLite: đồ thị của mỗi theme là một file
 * <theme>/.themegraph/graph.db.
 */
export class SqliteGraphStore implements GraphStore {
  dbPath(themeRoot: string): string {
    return graphDbPath(path.resolve(themeRoot));
  }

  hasGraph(dir: string): boolean {
    return existsSync(this.dbPath(dir));
  }

  /**
   * Mở ở chế độ CHỈ ĐỌC: truy vấn không bao giờ sửa được đồ thị, và nếu file
   * không tồn tại thì SQLite không lặng lẽ tạo ra một database rỗng.
   */
  open(themeRoot: string): GraphRepository {
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

    return new SqliteGraphRepository(
      root,
      {
        schemaVersion,
        toolVersion: meta.get("tool_version") ?? "",
        analyzedAt: meta.get("analyzed_at") ?? "",
      },
      db,
    );
  }

  /**
   * Ghi vào một file tạm rồi mới đổi tên thành graph.db. Nhờ vậy graph.db luôn
   * là một database hoàn chỉnh: hoặc bản cũ, hoặc bản mới, không bao giờ là
   * bản đang ghi dở nếu tiến trình bị ngắt giữa chừng.
   */
  save(themeRoot: string, graph: ThemeGraph, analyzedAt: Date): void {
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
      const insertFileHash = db.prepare("INSERT INTO file_hashes (file, hash) VALUES (?, ?)");
      const insertFileError = db.prepare("INSERT INTO file_errors (file, message) VALUES (?, ?)");
      const insertSchema = db.prepare(
        "INSERT INTO schemas (file, presets, accepts_theme_blocks) VALUES (?, ?, ?)",
      );
      const insertElement = db.prepare("INSERT INTO elements (name, role, file, line) VALUES (?, ?, ?, ?)");

      // Một transaction cho toàn bộ: nhanh hơn nhiều so với để mỗi INSERT tự
      // commit, và nếu có lỗi giữa chừng thì không dòng nào được ghi.
      db.exec("BEGIN");
      try {
        insertMeta.run("schema_version", String(SCHEMA_VERSION));
        insertMeta.run("tool_version", VERSION);
        insertMeta.run("analyzed_at", analyzedAt.toISOString());

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

        for (const entry of graph.fileHashes) {
          insertFileHash.run(entry.file, entry.hash);
        }

        for (const entry of graph.fileErrors) {
          insertFileError.run(entry.file, entry.message);
        }

        for (const entry of graph.elements) {
          insertElement.run(entry.name, entry.role, entry.file, entry.line);
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

  remove(themeRoot: string): RemovedData {
    const dataDir = path.dirname(this.dbPath(themeRoot));

    const removedFiles: string[] = [];
    for (const name of OWN_FILES) {
      const file = path.join(dataDir, name);
      if (!existsSync(file)) continue;

      rmSync(file);
      removedFiles.push(file);
    }

    // rmdir chỉ xoá được thư mục RỖNG. Nếu còn file lạ thì nó ném lỗi, và thư
    // mục được giữ lại cùng những file đó.
    let removedDir = false;
    if (existsSync(dataDir)) {
      try {
        rmdirSync(dataDir);
        removedDir = true;
      } catch {
        removedDir = false;
      }
    }

    return { removedFiles, removedDir };
  }
}
