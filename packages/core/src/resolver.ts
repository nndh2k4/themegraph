import { PLURAL_FORMS } from "./extract-locale.js";
import type { RawRef, Resolution } from "./types.js";

/** Tiền tố của id node khoá dịch, để không trùng với đường dẫn file nào. */
export const TRANSLATION_PREFIX = "t:";

/**
 * Id của node mà một ref trỏ tới. Với ref tới file, đó là đường dẫn theo quy
 * ước thư mục của Shopify.
 *
 * Shopify không có lệnh import với đường dẫn: mã chỉ viết một cái tên, còn
 * thư mục và đuôi file do LOẠI lời gọi quyết định. Cùng tên "header" thì
 * {% render 'header' %} là snippets/header.liquid, còn {% section 'header' %}
 * là sections/header.liquid.
 *
 * Trả null cho no_layout vì ref đó không trỏ tới file nào.
 */
function conventionalPath(ref: RawRef): string | null {
  switch (ref.kind) {
    case "render":
    case "include":
      return `snippets/${ref.to}.liquid`;
    case "section":
    case "section_load":
      return `sections/${ref.to}.liquid`;
    case "section_group":
      return `sections/${ref.to}.json`;
    case "block":
      return `blocks/${ref.to}.liquid`;
    case "layout":
      return `layout/${ref.to}.liquid`;
    case "asset":
      // Tên asset trong mã đã gồm cả đuôi ('base.css'), không thêm gì.
      return `assets/${ref.to}`;
    case "translation":
      // Khoá dịch không phải file: đích là node 't:<khoá>'.
      return TRANSLATION_PREFIX + ref.to;
    case "no_layout":
      return null;
    case "setting":
      // Đích của một lần đọc setting còn tuỳ file nào render file đang đọc,
      // điều hàm này không biết. buildGraph xử lý loại ref này riêng, bằng
      // resolveSettingRef.
      return null;
  }
}

/**
 * Đổi một tham chiếu thô thành node đích, đối chiếu với những gì theme có.
 *
 * `knownPaths` là tập id của mọi thứ có thể làm đích: ThemeFile.path do
 * scanThemeDir trả về, cộng 't:<khoá>' cho mỗi khoá dịch. Hàm không đụng tới
 * đĩa: mọi câu hỏi "có tồn tại không" đều trả lời từ tập này.
 *
 * So khớp phân biệt chữ hoa chữ thường, giống Shopify.
 */
export function resolveRef(ref: RawRef, knownPaths: ReadonlySet<string>): Resolution {
  const expected = conventionalPath(ref);

  if (expected === null) return { status: "none" };

  if (knownPaths.has(expected)) return { status: "resolved", path: expected };

  // Asset có thể được lưu kèm đuôi .liquid (assets/theme.js.liquid) để Shopify
  // chạy Liquid bên trong, nhưng mã vẫn gọi nó bằng tên gốc 'theme.js'.
  if (ref.kind === "asset") {
    const liquidVariant = `${expected}.liquid`;
    if (knownPaths.has(liquidVariant)) return { status: "resolved", path: liquidVariant };
  }

  // Một khoá số nhiều là một node duy nhất (t:cart.items), nhưng mã có thể gọi
  // thẳng một dạng của nó: {{ 'cart.items.one' | t }}. Khi phần đuôi là tên
  // một dạng số nhiều, thử lại với khoá chứa nó.
  if (ref.kind === "translation") {
    const lastDot = expected.lastIndexOf(".");
    const parent = expected.slice(0, lastDot);

    if (lastDot > 0 && PLURAL_FORMS.has(expected.slice(lastDot + 1)) && knownPaths.has(parent)) {
      return { status: "resolved", path: parent };
    }
  }

  // JSON template liệt kê mọi block của một section, gồm cả block cục bộ khai
  // trong {% schema %} của section đó (kiểu Dawn). Block cục bộ không có file
  // riêng, nên ở đây "không thấy file" được hiểu là block cục bộ.
  //
  // Giới hạn đã biết: ref thô không ghi block thuộc section nào, nên không
  // kiểm được type đó có thật sự được khai trong schema hay không. Một type
  // gõ sai trong JSON cũng sẽ rơi vào nhánh này.
  if (ref.kind === "block" && ref.source === "json") return { status: "local_block" };

  // Tên lấy từ JavaScript bằng mẫu chữ (section: 'x', id: 'x') có thể không
  // phải tên section nào. Không thấy file thì coi như không phải tham chiếu,
  // chứ không báo là tham chiếu hỏng.
  if (ref.kind === "section_load") return { status: "none" };

  return { status: "missing", expected };
}
