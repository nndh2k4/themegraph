import type { GraphNode, NodeKind } from "../models/index.js";
import type { DeadCodeResult, DeadFile, NeededElement, NotLoadedAsset } from "./dto/dead-code.dto.js";
import type { GraphRepository } from "./graph.repository.js";

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
 *   section viết sẵn, hoặc là biến được gán chữ viết sẵn (cạnh LOADS_SECTION);
 *   tên đọc từ DOM hay từ tham số thì không.
 * - asset: có thể được gọi bằng tên ghép từ dữ liệu lúc chạy
 *   ('icon-' | append: product.type), từ bên trong một file CSS, hoặc bằng
 *   import() với tên là biến. Import viết sẵn thì đồ thị đã thấy (USES_ASSET).
 * - layout: có thể được chọn bằng {% layout ten_bien %}.
 *
 * Snippet, block và section group không có ở đây vì chúng chỉ dùng được qua
 * lời gọi có tên viết sẵn trong Liquid hoặc JSON, thứ đồ thị ghi lại đủ.
 */
const REVIEW_ROOT_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(["section", "asset", "layout"]);

/**
 * File lỗi có thể che một lời gọi tới file mức `certain` hay không.
 *
 * Snippet, block và section group chỉ được gọi từ mã Liquid hoặc từ JSON
 * template / section group (xem REVIEW_ROOT_KINDS), nên chỉ lỗi ở các file đó
 * mới làm đồ thị thiếu một lời gọi như vậy. Không tính:
 *   - assets/*.css.liquid, *.js.liquid: Liquid trong đó chỉ in CSS/JS, không
 *     render snippet hay block nào
 *   - locales/*.json, config/*.json: Shopify đọc thẳng, không gọi file nào
 */
function canHideCalls(file: string): boolean {
  if (file.endsWith(".liquid")) return !file.endsWith(".css.liquid") && !file.endsWith(".js.liquid");
  return file.endsWith(".json") && (file.startsWith("templates/") || file.startsWith("sections/"));
}

/** Tên của theme block riêng tư bắt đầu bằng "_": merchant không thêm được chúng. */
const PRIVATE_BLOCK_PREFIX = "blocks/_";

/** Trả lời câu hỏi: "file nào trong theme không còn được dùng?" */
export class DeadCodeService {
  constructor(private readonly graph: GraphRepository) {}

  /**
   * Một file được coi là không dùng khi không điểm vào nào đi tới được nó (xem
   * liveNodes). Mỗi kết quả kèm mức tin cậy:
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
   * Nếu có file Liquid hay JSON template / section group không phân tích được
   * trọn vẹn thì mọi kết quả đều là `review`: file đó có thể là nơi gọi duy
   * nhất của một file khác mà đồ thị không thấy (xem canHideCalls). Lỗi ở file
   * khác, ví dụ locale, vẫn có trong `fileErrors` nhưng không hạ mức.
   *
   * Riêng asset định nghĩa một custom element mà file đang dùng có viết thì
   * không vào danh sách trên mà vào `notLoaded` (xem findNotLoaded).
   */
  findUnused(): DeadCodeResult {
    // Các file nhận "@theme". File nào không nằm trong `unused` là đang dùng.
    const acceptors = this.graph
      .schemas()
      .filter((schema) => schema.acceptsThemeBlocks)
      .map((schema) => schema.file);

    const live = this.liveNodes(acceptors);

    // Các file thuộc loại có thể là mã chết mà không nằm trong tập đang dùng,
    // xếp theo id.
    const unused: GraphNode[] = this.graph.nodesOfKinds(CANDIDATE_KINDS).filter((node) => !live.has(node.id));

    const unusedIds = new Set(unused.map((node) => node.id));

    const fileErrors = this.graph.fileErrors();
    const callsMayBeMissing = fileErrors.some((error) => canHideCalls(error.file));

    const acceptsThemeBlocks = acceptors.some((id) => !unusedIds.has(id));

    // Quan hệ gọi giữa các file không dùng với nhau, theo cả hai chiều. Một
    // file không dùng thì mọi file gọi nó cũng không dùng (nếu một file đang
    // dùng gọi nó thì nó đã là đang dùng), nên chỉ cần lọc theo đầu đích.
    const callersOf = new Map<string, string[]>();
    const calleesOf = new Map<string, string[]>();

    for (const node of unused) {
      const callers = this.graph
        .edgesTo(node.id)
        .filter((edge) => edge.from !== edge.to)
        .map((edge) => edge.from);
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
      .filter((node) => node.kind === "block" && !node.id.startsWith(PRIVATE_BLOCK_PREFIX))
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

    const neededElements = this.findNotLoaded(new Map(unused.map((node) => [node.id, node.kind])));

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
          confidence: needsReview.has(node.id) || callsMayBeMissing ? "review" : "certain",
          reason: usedBy.length === 0 ? "unreferenced" : "only_used_by_unused",
          usedBy,
        };
      });

    // `unused` đã xếp theo id; sort của JavaScript giữ nguyên thứ tự đó giữa
    // các phần tử cùng mức.
    files.sort((a, b) => Number(a.confidence === "review") - Number(b.confidence === "review"));

    const review = files.filter((entry) => entry.confidence === "review").length;

    // Id của node khoá dịch là 't:<khoá>'; trả về phần khoá, như cách mã gọi nó.
    const unusedTranslationKeys = this.graph
      .nodesWithoutIncomingEdges("translation_key")
      .map((node) => node.id.slice("t:".length));

    // Id của setting không kèm tiền tố 'setting:'.
    const unusedSettings = this.graph
      .nodesWithoutIncomingEdges("setting")
      .map((node) => node.id.slice("setting:".length));

    return {
      files,
      certain: files.length - review,
      review,
      notLoaded,
      fileErrors,
      acceptsThemeBlocks,
      unusedTranslationKeys,
      unusedSettings,
    };
  }

  /**
   * Tập node ĐANG DÙNG: mọi thứ tới được từ một điểm vào, đi xuôi qua mọi cạnh.
   *
   * Có ba loại điểm vào:
   *   1. Loại trang. Mọi template đều nằm dưới một loại trang.
   *   2. Section có preset: merchant thêm được vào template từ theme editor,
   *      dù hiện chưa template nào dùng.
   *   3. Theme block công khai (tên không bắt đầu bằng "_"), khi có ít nhất
   *      một file ĐANG DÙNG nhận "@theme": merchant thêm được block vào file
   *      đó. Loại này phụ thuộc chính tập đang dùng, nên tập được tính hai
   *      lượt: lượt đầu từ loại 1 và 2; nếu trong đó có file nhận "@theme" thì
   *      lượt hai thêm mọi block công khai. Không cần lượt thứ ba: lượt hai đã
   *      thêm HẾT block công khai, file nhận "@theme" mới lọt vào cũng không
   *      thêm được gì nữa.
   */
  private liveNodes(acceptors: readonly string[]): Set<string> {
    const sections = new Set(this.graph.nodesOfKinds(["section"]).map((node) => node.id));
    const presetSections = this.graph
      .schemas()
      .filter((schema) => schema.presets > 0 && sections.has(schema.file))
      .map((schema) => schema.file);

    const entryPoints = [...this.graph.nodesOfKinds(["page_type"]).map((node) => node.id), ...presetSections];
    const live = this.graph.reachableFrom(entryPoints);

    if (!acceptors.some((id) => live.has(id))) return live;

    const publicBlocks = this.graph
      .nodesOfKinds(["block"])
      .map((node) => node.id)
      .filter((id) => !id.startsWith(PRIVATE_BLOCK_PREFIX));

    return this.graph.reachableFrom([...entryPoints, ...publicBlocks]);
  }

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
  private findNotLoaded(unused: ReadonlyMap<string, NodeKind>): Map<string, NeededElement[]> {
    const definersOf = new Map<string, string[]>();
    for (const { name, role, file } of this.graph.elements()) {
      if (role === "define") definersOf.set(name, [...(definersOf.get(name) ?? []), file]);
    }

    const result = new Map<string, NeededElement[]>();

    for (const { definer, name, user } of this.graph.elementPairs()) {
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
}
