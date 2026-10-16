import path from "node:path";

import { PLURAL_FORMS } from "./parsers/default-locale.parser.js";
import type { RawRef, Resolution } from "../models/index.js";

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
    case "import":
      // Specifier của import không theo quy ước thư mục nào: nó đi qua import
      // map hoặc là đường dẫn tương đối. Xem resolveImport.
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

  // Khoá "shopify.*" thuộc không gian khoá do nền tảng cung cấp (ví dụ
  // shopify.online_store.spam_detection.disclaimer_html); theme không khai chúng
  // trong locale. Không thấy trong theme không có nghĩa là khoá hỏng.
  if (ref.kind === "translation" && ref.to.startsWith("shopify.")) return { status: "none" };

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

  // Tên tính ra từ một tên ghép có thể thừa (xem RawRef.computed).
  if (ref.computed === true) return { status: "none" };

  return { status: "missing", expected };
}

/**
 * Đổi specifier của một ref import thành file trong assets/.
 *
 * `importMap` là import map của theme: specifier -> tên file trong assets/.
 * Thứ tự thử:
 *   1. specifier có trong import map ('@theme/global' -> core.js)
 *   2. đường dẫn tương đối ('./core.js'), tính từ file đang import. Chỉ có
 *      nghĩa khi file đó nằm trong assets/: mọi asset được phục vụ chung một
 *      thư mục, nên './core.js' là assets/core.js. Phần ?v=... bị bỏ.
 *
 * Specifier không thuộc hai loại trên (URL đầy đủ, '/cdn/...', tên gói không
 * có trong import map) không trỏ tới file nào của theme: status "none".
 * Specifier đi tới được một tên file mà theme không có thì là import hỏng.
 */
export function resolveImport(
  ref: RawRef,
  importMap: ReadonlyMap<string, string>,
  knownPaths: ReadonlySet<string>,
): Resolution {
  const specifier = ref.to.replace(/[?#].*$/, "");
  let expected: string | undefined;

  const mapped = importMap.get(ref.to) ?? importMap.get(specifier);
  if (mapped !== undefined) {
    expected = `assets/${mapped}`;
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && ref.from.startsWith("assets/")) {
    const target = path.posix.join(path.posix.dirname(ref.from), specifier);
    if (target.startsWith("assets/")) expected = target;
  }

  if (expected === undefined) return { status: "none" };
  if (knownPaths.has(expected)) return { status: "resolved", path: expected };

  const liquidVariant = `${expected}.liquid`;
  if (knownPaths.has(liquidVariant)) return { status: "resolved", path: liquidVariant };

  return { status: "missing", expected };
}
