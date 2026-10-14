import { FILE_EDGE_TYPES } from "../models/index.js";
import type { FlowNode, RenderFlowOptions, RenderFlowResult } from "./dto/render-flow.dto.js";
import type { GraphRepository, NeighborEdge } from "./graph.repository.js";
import type { NodeFinder } from "./node-finder.service.js";

/** Trả lời câu hỏi: "trang này render những file nào, theo thứ tự lồng nhau ra sao?" */
export class RenderFlowService {
  constructor(
    private readonly graph: GraphRepository,
    private readonly nodes: NodeFinder,
  ) {}

  /**
   * Đi XUÔI chiều mũi tên từ node đang hỏi: loại trang -> template -> layout và
   * section -> snippet, block, asset. Chỉ đi qua cạnh nối file với file
   * (FILE_EDGE_TYPES); khoá dịch mà các file đó dùng không thuộc luồng render.
   *
   * Kết quả có hai dạng của cùng một tập node:
   *   - `files`: danh sách phẳng, mỗi node một lần, kèm độ sâu nhỏ nhất
   *   - `tree`:  cây lồng nhau để in ra cho người đọc
   *
   * Một file thường được gọi từ nhiều nơi (một snippet dùng trong mười section).
   * Nếu mở nó ra ở mọi nơi nó xuất hiện thì cây phình to rất nhanh, và với đồ
   * thị có vòng thì không bao giờ xong. Vì vậy mỗi node chỉ được MỞ MỘT LẦN, ở
   * vị trí ứng với độ sâu nhỏ nhất của nó; ở các chỗ khác nó hiện ra với
   * `repeated: true` và không có con.
   *
   * Trên theme lớn cây của một trang dài hàng nghìn dòng; `maxDepth` cắt cây ở
   * một tầng để người (hoặc agent) đọc phần trên trước rồi hỏi tiếp từ một node
   * ở dưới.
   *
   * `name` được hiểu theo NodeFinder. Ném NodeNotFoundError nếu không có node,
   * RangeError nếu maxDepth không phải số nguyên từ 1 trở lên.
   */
  buildFlow(name: string, options: RenderFlowOptions = {}): RenderFlowResult {
    const { maxDepth } = options;
    if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1)) {
      throw new RangeError(`Độ sâu tối đa phải là số nguyên từ 1 trở lên, nhận được: ${String(maxDepth)}.`);
    }

    const root = this.nodes.find(name, options);

    const reached = this.graph.reach(root.id, "forward", FILE_EDGE_TYPES);

    // Tra nhanh độ sâu nhỏ nhất của từng node khi dựng cây.
    const depthOf = new Map(reached.map((node) => [node.id, node.depth]));

    // Các node đã được mở. Không cần ghi gốc vào đây: gốc có độ sâu 0, không
    // bao giờ khớp điều kiện về tầng bên dưới, nên vòng quay về gốc tự bị chặn.
    const expanded = new Set<string>();

    /** Dựng danh sách con của một node đang được mở ở tầng `depth`. */
    const childrenOf = (id: string, depth: number): FlowNode[] =>
      this.outgoing(id).map((edge) => {
        const childId = edge.to;

        const child: FlowNode = {
          id: childId,
          kind: edge.neighborKind,
          depth: depth + 1,
          edge: edge.type,
          conditional: edge.conditional,
          count: edge.count,
          repeated: true,
          hidden: 0,
          children: [],
        };

        // Chỉ mở node ở đúng tầng bằng độ sâu nhỏ nhất của nó, và chỉ một lần.
        // Mọi node tới được đều có ít nhất một cha nằm ngay trên tầng đó, nên
        // không node nào bị bỏ sót.
        if (depthOf.get(childId) === depth + 1 && !expanded.has(childId)) {
          expanded.add(childId);
          child.repeated = false;

          if (depth + 1 === maxDepth) {
            // Đây là chỗ đáng lẽ mở node ra, nhưng các con của nó nằm dưới tầng
            // bị cắt. Chỉ đếm chúng, để người đọc biết ở đây còn gì.
            child.hidden = this.outgoing(childId).length;
          } else {
            child.children = childrenOf(childId, depth + 1);
          }
        }

        return child;
      });

    return {
      root,
      files: reached.filter((node) => node.id !== root.id),
      tree: {
        id: root.id,
        kind: root.kind,
        depth: 0,
        edge: null,
        conditional: false,
        count: 0,
        repeated: false,
        hidden: 0,
        children: childrenOf(root.id, 0),
      },
      maxDepth: maxDepth ?? null,
    };
  }

  /**
   * Các cạnh nối file với file đi ra từ một node. Thứ tự các con: cạnh không
   * điều kiện trước (đó là luồng render chính), rồi theo tên để kết quả ổn
   * định. Repository đã xếp theo (đích, loại); sort() giữ thứ tự đó trong
   * từng nhóm.
   */
  private outgoing(id: string): NeighborEdge[] {
    return this.graph
      .edgesFrom(id)
      .filter((edge) => FILE_EDGE_TYPES.includes(edge.type))
      .sort((a, b) => Number(a.conditional) - Number(b.conditional));
  }
}
