import type { NodeKind } from "../../models/index.js";

/**
 * Mức khớp của một kết quả, từ sát nhất tới lỏng nhất:
 *   - exact:    từ khoá trùng cả tên của node ("card" với snippets/card.liquid)
 *   - prefix:   tên của node bắt đầu bằng từ khoá ("card" với card-product)
 *   - name:     từ khoá nằm giữa tên ("product" với card-product)
 *   - path:     từ khoá chỉ nằm ở phần còn lại của id, ví dụ tên thư mục
 */
export type SearchMatch = "exact" | "prefix" | "name" | "path";

export interface SearchHit {
  id: string;
  kind: NodeKind;
  match: SearchMatch;
}

export interface SearchOptions {
  /** Chỉ lấy node thuộc các loại này. Không nêu, hoặc mảng rỗng: mọi loại. */
  kinds?: readonly NodeKind[];
  /** Số kết quả tối đa. Mặc định DEFAULT_SEARCH_LIMIT. */
  limit?: number;
}

/** Kết quả của search(). */
export interface SearchResult {
  query: string; // từ khoá như người gọi đưa vào
  hits: SearchHit[]; // các node khớp, sát nhất trước, đã cắt theo limit
  total: number; // số node khớp trước khi cắt, để nói "20 trên 57"
}
