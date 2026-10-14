import type { SearchResult } from "@themegraph/core";

import { table } from "./text.js";
import type { TextView } from "./text-view.js";

/** Các node khớp một từ khoá, sát nhất trước. */
export class SearchView implements TextView<SearchResult> {
  render(result: SearchResult): string[] {
    const { query, hits, total } = result;
    const about = query.trim() === "" ? "" : ` khớp "${query}"`;

    if (total === 0) {
      return [`Không có node nào${about}.`];
    }

    // Giới hạn của search do chính truy vấn áp (tham số limit), nên ở đây chỉ
    // việc nói rõ đang hiện bao nhiêu trên tổng số.
    const count = hits.length < total ? `${hits.length} trên ${total}` : String(total);

    return [`Node${about} (${count}), sát nhất trước:`, ...table(hits.map((hit) => [hit.id, hit.kind]))];
  }
}
