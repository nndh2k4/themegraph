import { FILE_EDGE_TYPES } from "../models/index.js";
import type { EdgeType } from "../models/index.js";
import type { FindNodeOptions } from "./dto/find-node.dto.js";
import type { ImpactPage, ImpactResult } from "./dto/impact.dto.js";
import type { GraphRepository } from "./graph.repository.js";
import type { NodeFinder } from "./node-finder.service.js";

/**
 * Các loại cạnh của luồng render "tĩnh": mọi cạnh nối file với file, trừ cạnh
 * tải section lúc chạy.
 */
const STATIC_EDGE_TYPES: readonly EdgeType[] = FILE_EDGE_TYPES.filter((type) => type !== "LOADS_SECTION");

/** Trả lời câu hỏi: "sửa file này thì những file nào và trang nào bị ảnh hưởng?" */
export class ImpactService {
  constructor(
    private readonly graph: GraphRepository,
    private readonly nodes: NodeFinder,
  ) {}

  /**
   * Đi NGƯỢC chiều mũi tên từ node đang hỏi: ai gọi nó, ai gọi những file đó,
   * cứ thế lên tới loại trang. Đi qua mọi loại cạnh, nên sửa một asset hay một
   * layout cũng ra đúng các trang dùng nó.
   *
   * `certain` của mỗi node cho biết node đó LUÔN dùng tới target (true) hay chỉ
   * dùng trong một điều kiện nào đó (false).
   *
   * Hai danh sách "trang" và "file" đứng riêng thì chưa nói trang nào dính qua
   * file nào, và người đọc (nhất là agent) sẽ tự đoán phần nối đó. Vì vậy mỗi
   * trang ghi kèm `via`, và những file không nằm trên trang nào được gom vào
   * `offPage`. Cả hai được tính bằng cách đi XUÔI từ từng trang bị ảnh hưởng:
   * một file nằm trên đường từ trang tới target khi và chỉ khi trang đi tới
   * được nó và nó đi tới được target.
   *
   * `name` được hiểu theo NodeFinder. Ném NodeNotFoundError nếu không có node.
   */
  findImpact(name: string, options: FindNodeOptions = {}): ImpactResult {
    const target = this.nodes.find(name, options);

    // Bỏ chính target: nó có độ sâu 0, và trong đồ thị có vòng nó còn tự "ảnh
    // hưởng" tới mình, điều không có ích gì cho người hỏi.
    const affected = this.graph.reach(target.id, "backward").filter((node) => node.id !== target.id);

    // Các file gọi target trực tiếp: đúng những node ở độ sâu 1.
    const direct = new Set(affected.filter((node) => node.depth === 1).map((node) => node.id));

    // Những node đi tới target mà không cần cạnh LOADS_SECTION nào. Chỉ cần
    // thêm một phép duyệt ngược: target là khoá dịch hay setting thì bước đầu
    // tiên đi qua cạnh không thuộc luồng render, nên bắt đầu từ các file dùng
    // trực tiếp target thay vì từ chính target.
    const reachesStatically = new Set<string>(direct);
    for (const id of direct) {
      for (const node of this.graph.reach(id, "backward", STATIC_EDGE_TYPES)) {
        reachesStatically.add(node.id);
      }
    }

    // Mọi node mà ít nhất một trang bị ảnh hưởng đi tới được.
    const onSomePage = new Set<string>();

    const pages: ImpactPage[] = affected
      .filter((node) => node.kind === "page_type")
      .map((page) => {
        const reachable = this.graph.reach(page.id, "forward").map((node) => node.id);
        for (const id of reachable) onSomePage.add(id);

        return {
          ...page,
          via: reachable.filter((id) => id !== page.id && direct.has(id)).sort(),
          scriptOnly: !reachesStatically.has(page.id),
        };
      });

    return {
      target,
      affected,
      pages,
      offPage: affected
        .filter((node) => node.kind !== "page_type" && !onSomePage.has(node.id))
        .map((node) => node.id),
      totalPages: this.graph.countNodes("page_type"),
    };
  }
}
