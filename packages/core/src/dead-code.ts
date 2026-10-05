import type { GraphHandle } from "./open.js";
import type { NodeKind } from "./types.js";

/**
 * Mức tin cậy của một kết luận "file này không được dùng".
 *
 * - certain: mọi cách dùng loại file này đều hiện ra trong đồ thị, và đồ thị
 *   không có cách nào. Xoá được.
 * - review:  đồ thị không thấy ai dùng, nhưng loại file này còn những cách
 *   dùng mà phân tích tĩnh mã Liquid không nhìn thấy (xem REVIEW_ROOT_KINDS).
 *   Phải có người kiểm tra trước khi xoá.
 */
export type DeadConfidence = "certain" | "review";

/**
 * Vì sao file bị coi là không được dùng.
 *
 * - unreferenced:        không file nào gọi nó
 * - only_used_by_unused: có file gọi nó, nhưng mọi file gọi đều nằm trong
 *                        chính danh sách này
 */
export type DeadReason = "unreferenced" | "only_used_by_unused";

/** Một file không trang nào dùng tới. */
export interface DeadFile {
  id: string;
  kind: NodeKind;
  confidence: DeadConfidence;
  reason: DeadReason;
  usedBy: string[]; // các file gọi trực tiếp tới nó (đều nằm trong danh sách)
}

/** Kết quả của deadCode(). */
export interface DeadCodeResult {
  files: DeadFile[]; // mức certain trước, rồi review; trong mỗi mức xếp theo id
  certain: number;
  review: number;
  // Theme có file nào nhận mọi theme block qua "@theme" hay không. Nếu có,
  // block công khai không bao giờ bị báo, vì merchant thêm được chúng.
  acceptsThemeBlocks: boolean;
  // Khoá dịch có trong locale mặc định mà không file nào gọi bằng tên viết
  // sẵn. Luôn ở mức cần xem lại: khoá còn có thể được gọi bằng tên ghép lúc
  // chạy ('products.' | append: handle | t), thứ đồ thị không thấy.
  unusedTranslationKeys: string[];
}

/**
 * Các loại file có thể là mã chết. Template, config và locale không có ở đây:
 * template là điểm vào của một trang, còn config và locale được Shopify đọc
 * trực tiếp chứ không qua lời gọi nào trong mã.
 */
const CANDIDATE_KINDS: readonly NodeKind[] = ["section", "section_group", "snippet", "block", "asset", "layout"];

/**
 * Các loại file mà "đồ thị không thấy ai dùng" chưa đủ để kết luận:
 *
 * - section: JavaScript của theme có thể tải nó qua Section Rendering API
 *   (ví dụ giỏ hàng dạng ngăn kéo), và mã JavaScript không được phân tích.
 * - asset: có thể được gọi bằng tên ghép lúc chạy ('icon-' | append: name),
 *   hoặc từ bên trong một file CSS / JavaScript.
 * - layout: có thể được chọn bằng {% layout ten_bien %}.
 *
 * Snippet, block và section group không có ở đây vì chúng chỉ dùng được qua
 * lời gọi có tên viết sẵn trong Liquid hoặc JSON, thứ đồ thị ghi lại đủ.
 */
const REVIEW_ROOT_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(["section", "asset", "layout"]);

/**
 * Tập node ĐANG DÙNG: mọi thứ tới được từ một điểm vào, đi xuôi qua mọi cạnh.
 *
 * Có ba loại điểm vào:
 *   1. Loại trang. Mọi template đều nằm dưới một loại trang.
 *   2. Section có preset: merchant thêm được vào template từ theme editor,
 *      dù hiện chưa template nào dùng.
 *   3. Theme block công khai (tên không bắt đầu bằng "_"), khi theme có ít
 *      nhất một file nhận "@theme" (tham số ?1 = 1). Lý do như trên.
 *
 * Câu SELECT cuối trả về các file thuộc loại có thể là mã chết mà KHÔNG nằm
 * trong tập đang dùng.
 */
const UNUSED_SQL = `
WITH RECURSIVE live(id) AS (
  SELECT id FROM nodes WHERE kind = 'page_type'
  UNION
  SELECT s.file FROM schemas s JOIN nodes n ON n.id = s.file
  WHERE n.kind = 'section' AND s.presets > 0
  UNION
  SELECT id FROM nodes
  WHERE kind = 'block' AND ?1 = 1 AND substr(id, 1, 8) <> 'blocks/_'
  UNION
  SELECT e.dst FROM edges e JOIN live l ON e.src = l.id
)
SELECT id, kind FROM nodes
WHERE kind IN (${CANDIDATE_KINDS.map((kind) => `'${kind}'`).join(", ")})
  AND id NOT IN (SELECT id FROM live)
ORDER BY id`;

/**
 * Trả lời câu hỏi: "file nào trong theme không còn được dùng?"
 *
 * Một file được coi là không dùng khi không điểm vào nào đi tới được nó (xem
 * UNUSED_SQL). Mỗi kết quả kèm mức tin cậy:
 *
 *   - Section không preset, asset, layout: `review`, vì chúng còn cách dùng
 *     nằm ngoài tầm nhìn của đồ thị.
 *   - Mọi thứ nằm DƯỚI một file `review` cũng là `review`: nếu file đó hoá ra
 *     đang được dùng thì những gì nó gọi cũng đang được dùng.
 *   - Còn lại là `certain`.
 */
export function deadCode(graph: GraphHandle): DeadCodeResult {
  const acceptsThemeBlocks =
    graph.db.prepare("SELECT 1 AS found FROM schemas WHERE accepts_theme_blocks = 1 LIMIT 1").get() !== undefined;

  const unused = graph.db
    .prepare(UNUSED_SQL)
    .all(acceptsThemeBlocks ? 1 : 0)
    .map((row) => ({ id: String(row.id), kind: String(row.kind) as NodeKind }));

  // Quan hệ gọi giữa các file không dùng với nhau, theo cả hai chiều. Một
  // file không dùng thì mọi file gọi nó cũng không dùng (nếu một file đang
  // dùng gọi nó thì nó đã là đang dùng), nên chỉ cần lọc theo đầu đích.
  const callersOf = new Map<string, string[]>();
  const calleesOf = new Map<string, string[]>();

  const incoming = graph.db.prepare("SELECT src FROM edges WHERE dst = ? AND src <> dst ORDER BY src");

  for (const node of unused) {
    const callers = incoming.all(node.id).map((row) => String(row.src));
    callersOf.set(node.id, callers);

    for (const caller of callers) {
      const callees = calleesOf.get(caller) ?? [];
      callees.push(node.id);
      calleesOf.set(caller, callees);
    }
  }

  // Lan mức `review` từ các file gốc xuống mọi thứ chúng gọi, trực tiếp hay
  // gián tiếp. Duyệt theo chiều rộng với một hàng đợi; tập needsReview vừa là
  // kết quả vừa là dấu "đã ghé qua" để dừng được khi có vòng.
  const needsReview = new Set(unused.filter((node) => REVIEW_ROOT_KINDS.has(node.kind)).map((node) => node.id));
  const queue = [...needsReview];

  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const callee of calleesOf.get(id) ?? []) {
      if (needsReview.has(callee)) continue;
      needsReview.add(callee);
      queue.push(callee);
    }
  }

  const files: DeadFile[] = unused.map((node) => {
    const usedBy = callersOf.get(node.id) ?? [];

    return {
      id: node.id,
      kind: node.kind,
      confidence: needsReview.has(node.id) ? "review" : "certain",
      reason: usedBy.length === 0 ? "unreferenced" : "only_used_by_unused",
      usedBy,
    };
  });

  // `unused` đã xếp theo id; sort của JavaScript giữ nguyên thứ tự đó giữa
  // các phần tử cùng mức.
  files.sort((a, b) => Number(a.confidence === "review") - Number(b.confidence === "review"));

  const review = files.filter((entry) => entry.confidence === "review").length;

  // Id của node khoá dịch là 't:<khoá>'; trả về phần khoá, như cách mã gọi nó.
  const unusedTranslationKeys = graph.db
    .prepare(
      `SELECT substr(id, 3) AS key FROM nodes
       WHERE kind = 'translation_key' AND id NOT IN (SELECT dst FROM edges)
       ORDER BY id`,
    )
    .all()
    .map((row) => String(row.key));

  return { files, certain: files.length - review, review, acceptsThemeBlocks, unusedTranslationKeys };
}
