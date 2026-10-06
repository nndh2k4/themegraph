import { findNode } from "./find-node.js";
import type { FindNodeOptions } from "./find-node.js";
import type { GraphHandle } from "./open.js";
import { traverse } from "./traverse.js";
import type { Reached } from "./traverse.js";
import { FILE_EDGE_TYPES } from "./types.js";
import type { EdgeType, GraphNode } from "./types.js";

/**
 * Các loại cạnh của luồng render "tĩnh": mọi cạnh nối file với file, trừ cạnh
 * tải section lúc chạy.
 */
const STATIC_EDGE_TYPES: readonly EdgeType[] = FILE_EDGE_TYPES.filter((type) => type !== "LOADS_SECTION");

/** Một loại trang bị ảnh hưởng, kèm lối mà nó đi tới target. */
export interface ImpactPage extends Reached {
  // Các file gọi target TRỰC TIẾP mà trang này đi tới được, xếp theo id. Đây
  // là câu trả lời cho "trang này dính qua file nào": trang product dùng
  // card-product qua main-product và related-products. Rỗng khi target là
  // template của chính trang đó: giữa hai bên không còn file nào.
  via: string[];
  // true: trang này CHỈ đi tới target qua ít nhất một section do JavaScript
  // tải lúc chạy (cạnh LOADS_SECTION); không có đường nào toàn lời gọi Liquid
  // và JSON. Ví dụ: sửa snippet price ảnh hưởng trang 404 chỉ vì ô tìm kiếm ở
  // header tải section gợi ý kết quả, nơi có in giá. Những trang như vậy là
  // thật nhưng xa hơn hẳn các trang render target ngay khi tải, nên được
  // tách ra để người đọc biết đâu là phần chính.
  scriptOnly: boolean;
}

/** Kết quả của impact(): sửa một file thì những gì bị ảnh hưởng. */
export interface ImpactResult {
  target: GraphNode; // node đang hỏi
  // Mọi node dùng tới target, trực tiếp hoặc qua trung gian, không kể chính
  // target. Xếp theo độ sâu (gần target trước) rồi theo id.
  affected: Reached[];
  pages: ImpactPage[]; // các loại trang trong `affected`
  // Các file trong `affected` mà KHÔNG trang nào đi tới: chúng có dùng target,
  // nhưng bản thân chúng không nằm trên trang nào (ví dụ một section không
  // template nào chứa). Sửa target không làm đổi trang nào qua các file này.
  offPage: string[];
  totalPages: number; // số loại trang của cả theme, để nói "4 trên 12 trang"
}

/**
 * Trả lời câu hỏi: "sửa file này thì những file nào và trang nào bị ảnh hưởng?"
 *
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
 * `name` được hiểu theo findNode(). Ném NodeNotFoundError nếu không có node.
 */
export function impact(graph: GraphHandle, name: string, options: FindNodeOptions = {}): ImpactResult {
  const target = findNode(graph, name, options);

  // Bỏ chính target: nó có độ sâu 0, và trong đồ thị có vòng nó còn tự "ảnh
  // hưởng" tới mình, điều không có ích gì cho người hỏi.
  const affected = traverse(graph, target.id, "backward").filter((node) => node.id !== target.id);

  const totalPages = graph.db.prepare("SELECT count(*) AS n FROM nodes WHERE kind = 'page_type'").get();

  // Các file gọi target trực tiếp: đúng những node ở độ sâu 1.
  const direct = new Set(affected.filter((node) => node.depth === 1).map((node) => node.id));

  // Những node đi tới target mà không cần cạnh LOADS_SECTION nào. Chỉ cần
  // thêm một phép duyệt ngược: target là khoá dịch hay setting thì bước đầu
  // tiên đi qua cạnh không thuộc luồng render, nên bắt đầu từ các file dùng
  // trực tiếp target thay vì từ chính target.
  const reachesStatically = new Set<string>(direct);
  for (const id of direct) {
    for (const node of traverse(graph, id, "backward", { edgeTypes: STATIC_EDGE_TYPES })) {
      reachesStatically.add(node.id);
    }
  }

  // Mọi node mà ít nhất một trang bị ảnh hưởng đi tới được.
  const onSomePage = new Set<string>();

  const pages: ImpactPage[] = affected
    .filter((node) => node.kind === "page_type")
    .map((page) => {
      const reachable = traverse(graph, page.id, "forward").map((node) => node.id);
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
    totalPages: Number(totalPages?.n ?? 0),
  };
}
