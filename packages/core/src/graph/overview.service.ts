import { FILE_EDGE_TYPES } from "../models/index.js";
import type { NodeKind } from "../models/index.js";
import { deadCode } from "./dead-code.service.js";
import type { GraphMeta, GraphRepository } from "./graph.repository.js";

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
    notLoaded: number; // asset có nơi cần mà không trang nào nạp
    translationKeys: number;
    settings: number;
  };
  // Các file Liquid và section group được nhiều file khác gọi trực tiếp nhất:
  // sửa chúng thì ảnh hưởng rộng nhất. Không gồm asset. Nhiều nhất trước; bằng
  // nhau thì theo id.
  mostUsed: UsageCount[];
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
export function overview(graph: GraphRepository): OverviewResult {
  const { nodesByKind, edgesByType, refsByStatus } = graph.counts();

  const sum = (counts: Record<string, number>): number => Object.values(counts).reduce((total, n) => total + n, 0);

  // 'page:' dài 5 ký tự.
  const pages = graph.nodesOfKinds(["page_type"]).map((node) => node.id.slice("page:".length));

  // Chỉ đếm cạnh của luồng render (file gọi file). Loại trang và template bị
  // loại khỏi kết quả: template nào cũng "được dùng" bởi đúng một loại trang,
  // điều không nói lên gì. Asset cũng bị loại: trên theme thật, mười chỗ đầu
  // bảng toàn là icon SVG, che mất các file Liquid mà người sửa theme cần biết.
  const mostUsed = graph
    .mostReferenced({ edgeTypes: FILE_EDGE_TYPES, excludeKinds: ["page_type", "template", "asset"], limit: MOST_USED_LIMIT })
    .map(({ node, callers }) => ({ id: node.id, kind: node.kind, usedBy: callers }));

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
      notLoaded: dead.notLoaded.length,
      translationKeys: dead.unusedTranslationKeys.length,
      settings: dead.unusedSettings.length,
    },
    mostUsed,
  };
}
