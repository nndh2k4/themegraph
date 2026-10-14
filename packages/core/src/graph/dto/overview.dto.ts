import type { NodeKind } from "../../models/index.js";
import type { GraphMeta } from "../graph.repository.js";

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
