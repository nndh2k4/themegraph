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
  usedBy: string[]; // các file gọi trực tiếp tới nó (đều là file không dùng)
}

/** Một custom element mà file JavaScript định nghĩa, và những file đang dùng thẻ đó. */
export interface NeededElement {
  name: string; // tên thẻ, ví dụ 'disclosures-close'
  usedBy: string[]; // các file ĐANG DÙNG có viết thẻ này, xếp theo id
}

/**
 * Một asset không trang nào nạp, nhưng lại định nghĩa custom element mà một
 * file đang dùng viết ra. Đây không phải mã chết mà là một lỗi của theme:
 * thiếu thẻ <script> nạp file, nên thẻ hiện ra mà hành vi không chạy.
 */
export interface NotLoadedAsset {
  id: string;
  elements: NeededElement[]; // xếp theo tên thẻ
  usedBy: string[]; // các file gọi nó; đều là file không dùng, thường là rỗng
}

/** Kết quả của deadCode(). */
export interface DeadCodeResult {
  // Mức certain trước, rồi review; trong mỗi mức xếp theo id. Không gồm các
  // asset ở `notLoaded`.
  files: DeadFile[];
  certain: number;
  review: number;
  // Asset không trang nào nạp nhưng có nơi cần tới (xem NotLoadedAsset), xếp
  // theo id. Tách khỏi `files` vì lời khuyên ngược hẳn: không xoá, mà nạp nó.
  notLoaded: NotLoadedAsset[];
  // Theme có file ĐANG DÙNG nào nhận mọi theme block qua "@theme" hay không.
  // Nếu có, block công khai không bao giờ bị báo, vì merchant thêm được chúng
  // vào file đó. Một file nhận "@theme" mà chính nó không ai dùng thì không
  // tính: không có nó trên trang nào thì cũng không thêm được gì vào nó.
  acceptsThemeBlocks: boolean;
  // Khoá dịch có trong locale mặc định mà không file nào gọi bằng tên viết
  // sẵn. Luôn ở mức cần xem lại: khoá còn có thể được gọi bằng tên ghép lúc
  // chạy ('products.' | append: handle | t), thứ đồ thị không thấy.
  unusedTranslationKeys: string[];
  // Setting có trong schema mà không file nào đọc bằng tên viết sẵn, ghi ở
  // dạng id không có tiền tố 'setting:'. Cũng luôn ở mức cần xem lại, vì có ba
  // cách đọc mà đồ thị không thấy:
  //   - snippet nhận cả bộ setting qua tham số rồi mới đọc
  //     ({% render 'x', settings: block.settings %}). Theme Horizon của Shopify
  //     viết kiểu này ở 99 chỗ, nên gần một nửa số setting của nó (810 trên
  //     1637) nằm trong danh sách này dù đang được dùng;
  //   - tên là biến: section.settings[ten_bien];
  //   - vài setting toàn cục do chính Shopify đọc (ví dụ của trang thanh toán).
  unusedSettings: string[];
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
 *   (ví dụ giỏ hàng dạng ngăn kéo). Đồ thị chỉ thấy những lần tải có tên
 *   section viết sẵn (cạnh LOADS_SECTION); tên là biến thì không.
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
 *   3. Theme block công khai (tên không bắt đầu bằng "_"), khi có ít nhất
 *      một file ĐANG DÙNG nhận "@theme": merchant thêm được block vào file
 *      đó. Nhánh này tham chiếu chính tập `live`, nên nó chỉ mở ra sau khi
 *      một file nhận "@theme" đã lọt vào tập, và các block vừa được thêm lại
 *      có thể kéo theo file khác.
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
  SELECT b.id FROM live l
  JOIN schemas s ON s.file = l.id AND s.accepts_theme_blocks = 1
  JOIN nodes b ON b.kind = 'block' AND substr(b.id, 1, 8) <> 'blocks/_'
  UNION
  SELECT e.dst FROM edges e JOIN live l ON e.src = l.id
)
SELECT id, kind FROM nodes
WHERE kind IN (${CANDIDATE_KINDS.map((kind) => `'${kind}'`).join(", ")})
  AND id NOT IN (SELECT id FROM live)
ORDER BY id`;

/**
 * Mọi cặp (file định nghĩa một thẻ, file khác dùng thẻ đó). Câu này không lọc
 * theo việc file nào đang dùng; deadCode() lọc sau, khi đã có tập không dùng.
 */
const ELEMENT_PAIRS_SQL = `
SELECT d.file AS definer, d.name AS name, u.file AS user
FROM elements d
JOIN elements u ON u.name = d.name AND u.role = 'use' AND u.file <> d.file
WHERE d.role = 'define'
ORDER BY d.file, d.name, u.file`;

/**
 * Tìm các asset không dùng mà thật ra có nơi cần: nó định nghĩa một custom
 * element, và một file ĐANG DÙNG viết thẻ đó.
 *
 * Một thẻ không được tính nếu còn một file đang dùng khác cũng định nghĩa
 * nó: khi đó thẻ vẫn chạy nhờ file kia, và asset này đúng là bản thừa.
 *
 * Giới hạn: hàm chỉ xét asset mà KHÔNG trang nào nạp. Một asset được nạp ở
 * trang này nhưng thẻ của nó được viết ở trang khác thì không bị phát hiện.
 */
function findNotLoaded(graph: GraphHandle, unused: ReadonlyMap<string, NodeKind>): Map<string, NeededElement[]> {
  const definersOf = new Map<string, string[]>();
  for (const row of graph.db.prepare("SELECT name, file FROM elements WHERE role = 'define'").all()) {
    const name = String(row.name);
    definersOf.set(name, [...(definersOf.get(name) ?? []), String(row.file)]);
  }

  const result = new Map<string, NeededElement[]>();

  for (const row of graph.db.prepare(ELEMENT_PAIRS_SQL).all()) {
    const definer = String(row.definer);
    const name = String(row.name);
    const user = String(row.user);

    if (unused.get(definer) !== "asset") continue;
    // File dùng thẻ mà chính nó không trang nào dùng thì không ai thấy thẻ đó.
    if (unused.has(user)) continue;
    if ((definersOf.get(name) ?? []).some((file) => !unused.has(file))) continue;

    const elements = result.get(definer) ?? [];
    const last = elements.at(-1);

    // Các dòng đã xếp theo (definer, name, user), nên cùng một thẻ đi liền nhau.
    if (last !== undefined && last.name === name) last.usedBy.push(user);
    else elements.push({ name, usedBy: [user] });

    result.set(definer, elements);
  }

  return result;
}

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
 *   - Block công khai, khi file nhận "@theme" duy nhất là một file `review`:
 *     cũng `review`, cùng lý do. Nếu file đó hoá ra đang được dùng thì
 *     merchant thêm được block vào nó.
 *   - Còn lại là `certain`.
 *
 * Riêng asset định nghĩa một custom element mà file đang dùng có viết thì
 * không vào danh sách trên mà vào `notLoaded` (xem findNotLoaded).
 */
export function deadCode(graph: GraphHandle): DeadCodeResult {
  const unused = graph.db
    .prepare(UNUSED_SQL)
    .all()
    .map((row) => ({ id: String(row.id), kind: String(row.kind) as NodeKind }));

  const unusedIds = new Set(unused.map((node) => node.id));

  // Các file nhận "@theme". File nào không nằm trong `unused` là đang dùng.
  const acceptors = graph.db
    .prepare("SELECT s.file FROM schemas s JOIN nodes n ON n.id = s.file WHERE s.accepts_theme_blocks = 1")
    .all()
    .map((row) => String(row.file));

  const acceptsThemeBlocks = acceptors.some((id) => !unusedIds.has(id));

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

  // Các block công khai không dùng. Chúng không có cạnh nào từ file nhận
  // "@theme" (quan hệ đó là "merchant thêm được", không phải lời gọi), nên
  // mức `review` phải được lan sang chúng bằng tay, đúng một lần.
  const publicBlocks = unused
    .filter((node) => node.kind === "block" && !node.id.startsWith("blocks/_"))
    .map((node) => node.id);
  let publicBlocksReviewed = false;

  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const callees = [...(calleesOf.get(id) ?? [])];

    if (!publicBlocksReviewed && acceptors.includes(id)) {
      publicBlocksReviewed = true;
      callees.push(...publicBlocks);
    }

    for (const callee of callees) {
      if (needsReview.has(callee)) continue;
      needsReview.add(callee);
      queue.push(callee);
    }
  }

  const neededElements = findNotLoaded(graph, new Map(unused.map((node) => [node.id, node.kind])));

  const notLoaded: NotLoadedAsset[] = unused
    .filter((node) => neededElements.has(node.id))
    .map((node) => ({
      id: node.id,
      elements: neededElements.get(node.id) ?? [],
      usedBy: callersOf.get(node.id) ?? [],
    }));

  // Những gì một asset như vậy gọi (ví dụ section nó tải) vẫn ở lại danh
  // sách: chừng nào asset chưa được nạp thì chúng vẫn không được dùng.
  const files: DeadFile[] = unused
    .filter((node) => !neededElements.has(node.id))
    .map((node) => {
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

  // 'setting:' dài 8 ký tự; substr đếm từ 1 nên phần còn lại bắt đầu ở 9.
  const unusedSettings = graph.db
    .prepare(
      `SELECT substr(id, 9) AS name FROM nodes
       WHERE kind = 'setting' AND id NOT IN (SELECT dst FROM edges)
       ORDER BY id`,
    )
    .all()
    .map((row) => String(row.name));

  return {
    files,
    certain: files.length - review,
    review,
    notLoaded,
    acceptsThemeBlocks,
    unusedTranslationKeys,
    unusedSettings,
  };
}
