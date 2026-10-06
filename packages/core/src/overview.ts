import { deadCode } from "./dead-code.js";
import type { GraphHandle, GraphMeta } from "./open.js";
import { FILE_EDGE_TYPES } from "./types.js";
import type { NodeKind } from "./types.js";

/** Số file được nêu trong mục "được dùng nhiều nhất". */
const MOST_USED_LIMIT = 10;

/** Một file kèm số file khác gọi trực tiếp tới nó. */
export interface UsageCount {
  id: string;
  kind: NodeKind;
  usedBy: number; // số file (hoặc loại trang) khác nhau có cạnh trỏ tới nó
}

/** Kết quả của overview(): cả theme trong một màn hình. */
export interface OverviewResult {
  themeRoot: string;
  meta: GraphMeta; // lần phân tích đã ghi ra đồ thị này
  nodes: number;
  edges: number;
  nodesByKind: Record<string, number>; // xếp theo tên loại
  edgesByType: Record<string, number>;
  refsByStatus: Record<string, number>;
  pages: string[]; // tên các loại trang, không có tiền tố "page:", xếp theo tên
  brokenRefs: number; // số tham chiếu trỏ tới thứ không có trong theme
  // Số liệu của deadCode(), chỉ phần đếm. Danh sách đầy đủ thì hỏi deadCode().
  unused: {
    certain: number;
    review: number;
    translationKeys: number;
    settings: number;
  };
  // Các file được nhiều file khác gọi trực tiếp nhất: sửa chúng thì ảnh hưởng
  // rộng nhất. Nhiều nhất trước; bằng nhau thì theo id.
  mostUsed: UsageCount[];
}

/** Đổi các dòng (name, n) của một câu GROUP BY thành object, giữ thứ tự. */
function toCounts(rows: Record<string, unknown>[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [String(row.name), Number(row.n)]));
}

/**
 * Trả lời câu hỏi: "theme này gồm những gì, và có gì đáng để ý?"
 *
 * Mọi con số đọc từ graph.db, nên chúng mô tả theme ở LẦN PHÂN TÍCH GẦN NHẤT;
 * muốn biết đồ thị có còn khớp với đĩa không thì hỏi themeStatus().
 *
 * Số liệu ở đây trùng với phần thống kê lệnh analyze in ra, cộng thêm ba thứ
 * analyze không tính: tham chiếu hỏng, file không dùng, file được dùng nhiều.
 */
export function overview(graph: GraphHandle): OverviewResult {
  const { db } = graph;

  const nodesByKind = toCounts(db.prepare("SELECT kind AS name, count(*) AS n FROM nodes GROUP BY kind ORDER BY kind").all());
  const edgesByType = toCounts(db.prepare("SELECT type AS name, count(*) AS n FROM edges GROUP BY type ORDER BY type").all());
  const refsByStatus = toCounts(
    db.prepare("SELECT status AS name, count(*) AS n FROM refs GROUP BY status ORDER BY status").all(),
  );

  const sum = (counts: Record<string, number>): number => Object.values(counts).reduce((total, n) => total + n, 0);

  // 'page:' dài 5 ký tự; substr đếm từ 1.
  const pages = db
    .prepare("SELECT substr(id, 6) AS name FROM nodes WHERE kind = 'page_type' ORDER BY name")
    .all()
    .map((row) => String(row.name));

  // Chỉ đếm cạnh của luồng render (file gọi file), và đếm số NƠI GỌI khác
  // nhau chứ không cộng số lời gọi: một file gọi icon mười lần vẫn là một nơi.
  // Loại trang và template bị loại khỏi kết quả: template nào cũng "được dùng"
  // bởi đúng một loại trang, điều không nói lên gì.
  const mostUsed = db
    .prepare(
      `SELECT e.dst AS id, n.kind AS kind, count(DISTINCT e.src) AS used_by
       FROM edges e JOIN nodes n ON n.id = e.dst
       WHERE e.type IN (${FILE_EDGE_TYPES.map((type) => `'${type}'`).join(", ")})
         AND e.src <> e.dst
         AND n.kind NOT IN ('page_type', 'template')
       GROUP BY e.dst
       ORDER BY used_by DESC, e.dst
       LIMIT ?`,
    )
    .all(MOST_USED_LIMIT)
    .map((row) => ({ id: String(row.id), kind: String(row.kind) as NodeKind, usedBy: Number(row.used_by) }));

  const dead = deadCode(graph);

  return {
    themeRoot: graph.themeRoot,
    meta: graph.meta,
    nodes: sum(nodesByKind),
    edges: sum(edgesByType),
    nodesByKind,
    edgesByType,
    refsByStatus,
    pages,
    brokenRefs: refsByStatus.missing ?? 0,
    unused: {
      certain: dead.certain,
      review: dead.review,
      translationKeys: dead.unusedTranslationKeys.length,
      settings: dead.unusedSettings.length,
    },
    mostUsed,
  };
}
