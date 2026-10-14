import { FILE_EDGE_TYPES } from "../models/index.js";
import type { DeadCodeService } from "./dead-code.service.js";
import type { OverviewResult } from "./dto/overview.dto.js";
import type { GraphRepository } from "./graph.repository.js";

/** Số file được nêu trong mục "được dùng nhiều nhất". */
const MOST_USED_LIMIT = 10;

/**
 * Trả lời câu hỏi: "theme này gồm những gì, và có gì đáng để ý?"
 *
 * Mọi con số đọc từ đồ thị đã ghi, nên chúng mô tả theme ở LẦN PHÂN TÍCH GẦN
 * NHẤT; muốn biết đồ thị có còn khớp với đĩa không thì hỏi ThemeService.status().
 *
 * Số liệu ở đây trùng với phần thống kê lệnh analyze in ra, cộng thêm ba thứ
 * analyze không tính: tham chiếu hỏng, file không dùng, file được dùng nhiều.
 */
export class OverviewService {
  constructor(
    private readonly graph: GraphRepository,
    private readonly deadCode: DeadCodeService,
  ) {}

  summarize(): OverviewResult {
    const { nodesByKind, edgesByType, refsByStatus } = this.graph.counts();

    const sum = (counts: Record<string, number>): number => Object.values(counts).reduce((total, n) => total + n, 0);

    const pages = this.graph.nodesOfKinds(["page_type"]).map((node) => node.id.slice("page:".length));

    // Chỉ đếm cạnh của luồng render (file gọi file). Loại trang và template bị
    // loại khỏi kết quả: template nào cũng "được dùng" bởi đúng một loại trang,
    // điều không nói lên gì. Asset cũng bị loại: trên theme thật, mười chỗ đầu
    // bảng toàn là icon SVG, che mất các file Liquid mà người sửa theme cần biết.
    const mostUsed = this.graph
      .mostReferenced({ edgeTypes: FILE_EDGE_TYPES, excludeKinds: ["page_type", "template", "asset"], limit: MOST_USED_LIMIT })
      .map(({ node, callers }) => ({ id: node.id, kind: node.kind, usedBy: callers }));

    const dead = this.deadCode.findUnused();

    return {
      themeRoot: this.graph.themeRoot,
      meta: this.graph.meta,
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
}
