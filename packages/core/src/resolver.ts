import type { RawRef, Resolution } from "./types.js";

/**
 * Đường dẫn mà một ref trỏ tới theo quy ước thư mục của Shopify.
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
    case "no_layout":
      return null;
  }
}

/**
 * Đổi một tham chiếu thô thành file thật, đối chiếu với danh sách file của theme.
 *
 * `knownPaths` là tập ThemeFile.path do scanThemeDir trả về. Hàm không đụng
 * tới đĩa: mọi câu hỏi "file có tồn tại không" đều trả lời từ tập này.
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

  // JSON template liệt kê mọi block của một section, gồm cả block cục bộ khai
  // trong {% schema %} của section đó (kiểu Dawn). Block cục bộ không có file
  // riêng, nên ở đây "không thấy file" được hiểu là block cục bộ.
  //
  // Giới hạn đã biết: ref thô không ghi block thuộc section nào, nên không
  // kiểm được type đó có thật sự được khai trong schema hay không. Một type
  // gõ sai trong JSON cũng sẽ rơi vào nhánh này.
  if (ref.kind === "block" && ref.source === "json") return { status: "local_block" };

  return { status: "missing", expected };
}
