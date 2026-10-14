import type { GraphNode } from "../../models/index.js";
import type { Reached } from "../graph.repository.js";

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

/** Kết quả của ImpactService: sửa một file thì những gì bị ảnh hưởng. */
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
