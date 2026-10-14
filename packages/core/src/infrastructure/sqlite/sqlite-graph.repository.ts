import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite";

import type {
  Direction,
  ElementPair,
  GraphCounts,
  GraphMeta,
  GraphRepository,
  IntegrityReport,
  NeighborEdge,
  Reached,
  ReferenceCount,
} from "../../graph/graph.repository.js";
import type {
  EdgeType,
  ElementRole,
  FileElement,
  FileHash,
  FileSchema,
  GraphEdge,
  GraphNode,
  NodeKind,
  RefKind,
  RefSource,
  ResolvedRef,
} from "../../models/index.js";
import { REACHABLE_FROM_SQL, runTraverse, traverseSql } from "./traverse.sql.js";

type Row = Record<string, SQLOutputValue>;

const toNode = (row: Row): GraphNode => ({ id: String(row.id), kind: String(row.kind) as NodeKind });

const toEdge = (row: Row): GraphEdge => ({
  from: String(row.src),
  to: String(row.dst),
  type: String(row.type) as EdgeType,
  conditional: row.conditional === 1, // SQLite không có kiểu boolean
  sources: String(row.sources),
  count: Number(row.count),
});

/** Đổi các dòng (name, n) của một câu GROUP BY thành object, giữ thứ tự. */
const toCounts = (rows: Row[]): Record<string, number> =>
  Object.fromEntries(rows.map((row) => [String(row.name), Number(row.n)]));

/**
 * Hai câu lấy cạnh kề, chỉ khác nhau ở đầu nào của cạnh là node đang hỏi.
 * Cột neighbor_kind là loại của node ở đầu BÊN KIA.
 */
const neighborSql = (self: "src" | "dst", other: "src" | "dst"): string => `
SELECT e.src AS src, e.dst AS dst, e.type AS type, e.conditional AS conditional,
       e.sources AS sources, e.count AS count, n.kind AS neighbor_kind
FROM edges e JOIN nodes n ON n.id = e.${other}
WHERE e.${self} = ?
ORDER BY e.${other}, e.type`;

/**
 * Bản hiện thực GraphRepository trên một file graph.db đang mở ở chế độ chỉ
 * đọc. Đây là nơi DUY NHẤT trong chương trình viết câu SQL đọc đồ thị.
 *
 * Tạo bởi SqliteGraphStore.open(); không tự mở file.
 */
export class SqliteGraphRepository implements GraphRepository {
  /**
   * Câu lệnh đã chuẩn bị, theo chuỗi SQL. verify() duyệt đồ thị hàng nghìn
   * lần; chuẩn bị lại câu lệnh ở mỗi lần là phí.
   */
  private readonly statements = new Map<string, StatementSync>();

  constructor(
    readonly themeRoot: string,
    readonly meta: GraphMeta,
    private readonly db: DatabaseSync,
  ) {}

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  private prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  // ---- Node --------------------------------------------------------------

  getNode(id: string): GraphNode | null {
    const row = this.prepare("SELECT id, kind FROM nodes WHERE id = ?").get(id);
    return row === undefined ? null : toNode(row);
  }

  allNodes(): GraphNode[] {
    return this.prepare("SELECT id, kind FROM nodes ORDER BY id").all().map(toNode);
  }

  nodesOfKinds(kinds: readonly NodeKind[]): GraphNode[] {
    return this.prepare("SELECT id, kind FROM nodes WHERE kind IN (SELECT value FROM json_each(?)) ORDER BY id")
      .all(JSON.stringify(kinds))
      .map(toNode);
  }

  findNodes(text: string, options: { ignoreCase: boolean; limit?: number }): GraphNode[] {
    // instr() tìm chuỗi con nguyên văn. Không dùng LIKE vì LIKE coi % và _ là
    // ký tự đại diện, mà _ rất hay có trong tên file của theme.
    const column = options.ignoreCase ? "lower(id)" : "id";
    const sql = `SELECT id, kind FROM nodes WHERE instr(${column}, ?) > 0 ORDER BY id`;

    return options.limit === undefined
      ? this.prepare(sql).all(text).map(toNode)
      : this.prepare(`${sql} LIMIT ?`).all(text, options.limit).map(toNode);
  }

  nodesWithoutIncomingEdges(kind: NodeKind): GraphNode[] {
    return this.prepare("SELECT id, kind FROM nodes WHERE kind = ? AND id NOT IN (SELECT dst FROM edges) ORDER BY id")
      .all(kind)
      .map(toNode);
  }

  countNodes(kind?: NodeKind): number {
    const row =
      kind === undefined
        ? this.prepare("SELECT count(*) AS n FROM nodes").get()
        : this.prepare("SELECT count(*) AS n FROM nodes WHERE kind = ?").get(kind);
    return Number(row?.n ?? 0);
  }

  // ---- Cạnh --------------------------------------------------------------

  allEdges(): GraphEdge[] {
    return this.prepare("SELECT src, dst, type, conditional, sources, count FROM edges ORDER BY src, dst, type")
      .all()
      .map(toEdge);
  }

  edgesFrom(id: string): NeighborEdge[] {
    return this.prepare(neighborSql("src", "dst"))
      .all(id)
      .map((row) => ({ ...toEdge(row), neighborKind: String(row.neighbor_kind) as NodeKind }));
  }

  edgesTo(id: string): NeighborEdge[] {
    return this.prepare(neighborSql("dst", "src"))
      .all(id)
      .map((row) => ({ ...toEdge(row), neighborKind: String(row.neighbor_kind) as NodeKind }));
  }

  mostReferenced(options: { edgeTypes: readonly EdgeType[]; excludeKinds: readonly NodeKind[]; limit: number }): ReferenceCount[] {
    // Đếm số NƠI GỌI khác nhau chứ không cộng số lời gọi: một file gọi icon
    // mười lần vẫn là một nơi.
    return this.prepare(
      `SELECT e.dst AS id, n.kind AS kind, count(DISTINCT e.src) AS used_by
       FROM edges e JOIN nodes n ON n.id = e.dst
       WHERE e.type IN (SELECT value FROM json_each(?1))
         AND e.src <> e.dst
         AND n.kind NOT IN (SELECT value FROM json_each(?2))
       GROUP BY e.dst
       ORDER BY used_by DESC, e.dst
       LIMIT ?3`,
    )
      .all(JSON.stringify(options.edgeTypes), JSON.stringify(options.excludeKinds), options.limit)
      .map((row) => ({ node: toNode(row), callers: Number(row.used_by) }));
  }

  // ---- Duyệt -------------------------------------------------------------

  reach(startId: string, direction: Direction, edgeTypes?: readonly EdgeType[]): Reached[] {
    return runTraverse(this.prepare(traverseSql(direction, edgeTypes ?? null)), startId);
  }

  reachableFrom(startIds: readonly string[]): Set<string> {
    return new Set(
      this.prepare(REACHABLE_FROM_SQL)
        .all(JSON.stringify(startIds))
        .map((row) => String(row.id)),
    );
  }

  // ---- Tham chiếu ----------------------------------------------------------

  refLines(from: string, target: string): number[] {
    // Bảng edges đã gộp các lời gọi trùng nên không còn số dòng. Số dòng nằm ở
    // bảng refs, nơi giữ từng lời gọi riêng lẻ. line = 0 là ref lấy từ JSON.
    return this.prepare("SELECT DISTINCT line FROM refs WHERE src = ? AND target = ? AND line > 0 ORDER BY line")
      .all(from, target)
      .map((row) => Number(row.line));
  }

  missingRefsFrom(id: string): ResolvedRef[] {
    return this.prepare(
      `SELECT src, name, kind, source, conditional, line, status, target FROM refs
       WHERE src = ? AND status = 'missing'
       ORDER BY line, name`,
    )
      .all(id)
      .map((row) => ({
        from: String(row.src),
        to: String(row.name),
        kind: String(row.kind) as RefKind,
        source: String(row.source) as RefSource,
        conditional: row.conditional === 1,
        line: Number(row.line),
        status: "missing",
        target: row.target === null ? null : String(row.target),
      }));
  }

  // ---- Dữ kiện khác ---------------------------------------------------------

  schemas(): FileSchema[] {
    return this.prepare("SELECT file, presets, accepts_theme_blocks FROM schemas ORDER BY file")
      .all()
      .map((row) => ({ file: String(row.file), presets: Number(row.presets), acceptsThemeBlocks: row.accepts_theme_blocks === 1 }));
  }

  elements(): FileElement[] {
    return this.prepare("SELECT name, role, file, line FROM elements ORDER BY name, role, file")
      .all()
      .map((row) => ({ name: String(row.name), role: String(row.role) as ElementRole, file: String(row.file), line: Number(row.line) }));
  }

  elementPairs(): ElementPair[] {
    return this.prepare(
      `SELECT d.file AS definer, d.name AS name, u.file AS user
       FROM elements d
       JOIN elements u ON u.name = d.name AND u.role = 'use' AND u.file <> d.file
       WHERE d.role = 'define'
       ORDER BY d.file, d.name, u.file`,
    )
      .all()
      .map((row) => ({ definer: String(row.definer), name: String(row.name), user: String(row.user) }));
  }

  fileHashes(): FileHash[] {
    return this.prepare("SELECT file, hash FROM file_hashes ORDER BY file")
      .all()
      .map((row) => ({ file: String(row.file), hash: String(row.hash) }));
  }

  counts(): GraphCounts {
    return {
      nodesByKind: toCounts(this.prepare("SELECT kind AS name, count(*) AS n FROM nodes GROUP BY kind ORDER BY kind").all()),
      edgesByType: toCounts(this.prepare("SELECT type AS name, count(*) AS n FROM edges GROUP BY type ORDER BY type").all()),
      refsByStatus: toCounts(this.prepare("SELECT status AS name, count(*) AS n FROM refs GROUP BY status ORDER BY status").all()),
    };
  }

  checkIntegrity(): IntegrityReport {
    return {
      // integrity_check trả đúng một dòng "ok" khi file không hỏng.
      problems: this.db
        .prepare("PRAGMA integrity_check")
        .all()
        .map((row) => String(row.integrity_check))
        .filter((line) => line !== "ok"),
      // foreign_key_check trả một dòng cho mỗi dòng vi phạm khoá ngoại.
      brokenLinks: this.db
        .prepare("PRAGMA foreign_key_check")
        .all()
        .map((row) => ({ table: String(row.table), parent: String(row.parent) })),
    };
  }
}
