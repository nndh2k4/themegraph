import type { EdgeType } from "../models/index.js";
import type { ContextLink, ContextResult } from "./dto/context.dto.js";
import type { FindNodeOptions } from "./dto/find-node.dto.js";
import type { GraphRepository, NeighborEdge } from "./graph.repository.js";
import type { ImpactService } from "./impact.service.js";
import type { NodeFinder } from "./node-finder.service.js";

/** Hai loại cạnh không nối tới file, tách khỏi danh sách "file này gọi file nào". */
const TRANSLATION_EDGE: EdgeType = "USES_TRANSLATION";
const SETTING_EDGE: EdgeType = "READS_SETTING";

/**
 * Trả lời câu hỏi: "file này là gì, ai gọi nó, nó gọi ai?"
 *
 * Khác ImpactService và RenderFlowService ở chỗ chỉ nhìn MỘT bước về mỗi phía,
 * nhưng cho chi tiết hơn: số dòng của từng lời gọi và các tham chiếu hỏng. Đây
 * là thứ một người (hoặc agent) cần đọc trước khi sửa một file.
 */
export class ContextService {
  constructor(
    private readonly graph: GraphRepository,
    private readonly nodes: NodeFinder,
    private readonly impact: ImpactService,
  ) {}

  /** `name` được hiểu theo NodeFinder. Ném NodeNotFoundError nếu không có node. */
  describe(name: string, options: FindNodeOptions = {}): ContextResult {
    const node = this.nodes.find(name, options);

    // Không cần lọc trạng thái khi tìm số dòng: đích ở đây là một node có thật,
    // mà ref hỏng thì đích của nó là đường dẫn của một file không tồn tại.
    const broken = this.graph.missingRefsFrom(node.id).map((ref) => ({
      name: ref.to,
      kind: ref.kind,
      line: ref.line,
      conditional: ref.conditional,
      expected: String(ref.target),
    }));

    const errors = this.graph
      .fileErrors()
      .filter((error) => error.file === node.id)
      .map((error) => error.message);

    // "File này thuộc trang nào" chính là phần trang của câu hỏi impact.
    const { pages, totalPages } = this.impact.findImpact(node.id);

    // Một section dùng vài chục khoá dịch và setting là chuyện thường. Để lẫn
    // chúng vào danh sách file được gọi thì danh sách đó hết đọc nổi, nên tách riêng.
    const outgoing = this.graph.edgesFrom(node.id).map((edge) => this.toLink(edge, edge.to));

    return {
      node,
      usedBy: this.graph.edgesTo(node.id).map((edge) => this.toLink(edge, edge.from)),
      uses: outgoing.filter((link) => link.type !== TRANSLATION_EDGE && link.type !== SETTING_EDGE),
      translations: outgoing.filter((link) => link.type === TRANSLATION_EDGE),
      settings: outgoing.filter((link) => link.type === SETTING_EDGE),
      broken,
      errors,
      pages,
      totalPages,
    };
  }

  /** Đổi một cạnh kề thành một quan hệ, kèm các dòng có lời gọi trong file GỌI. */
  private toLink(edge: NeighborEdge, other: string): ContextLink {
    return {
      id: other,
      kind: edge.neighborKind,
      type: edge.type,
      conditional: edge.conditional,
      count: edge.count,
      sources: edge.sources,
      lines: this.graph.refLines(edge.from, edge.to),
    };
  }
}
