import type { ContextLink, ContextResult } from "@themegraph/core";

import { capped, CONDITIONAL, pageList, settingName, table, translationKey } from "./text.js";
import type { TextView, ViewOptions } from "./text-view.js";

/** Ghi chú đi sau một quan hệ: loại cạnh, số lời gọi, nhãn điều kiện. */
function linkNotes(link: ContextLink): string {
  return [link.type, link.count > 1 ? `×${link.count}` : "", link.conditional ? CONDITIONAL : ""]
    .filter((note) => note !== "")
    .join("  ");
}

/** Mọi thứ ở ngay quanh một file: ai gọi nó, nó gọi ai, đọc setting và khoá dịch nào. */
export class ContextView implements TextView<ContextResult> {
  render(result: ContextResult, options: ViewOptions = {}): string[] {
    const { node, usedBy, uses, translations, settings, broken, pages } = result;
    const lines = [`${node.id} (${node.kind})`];

    // Với chính một loại trang thì câu "thuộc trang nào" không có nghĩa.
    if (node.kind !== "page_type") {
      lines.push(
        pages.length === 0
          ? "  Không trang nào dùng tới."
          : `  Thuộc ${pages.length} trên ${result.totalPages} trang: ${pageList(pages)}`,
      );
    }

    lines.push("", `Được gọi bởi (${usedBy.length}):`);
    // Số dòng ở đây là dòng trong file GỌI, nên viết liền sau tên file đó.
    lines.push(
      ...capped(
        table(
          usedBy.map((link) => [
            link.lines.length > 0 ? `${link.id}:${link.lines.join(",")}` : link.id,
            linkNotes(link),
          ]),
        ),
        options,
        "file",
      ),
    );

    lines.push("", `Gọi tới (${uses.length}):`);
    // Còn ở đây là dòng trong chính file đang hỏi.
    lines.push(
      ...capped(
        table(
          uses.map((link) => [
            link.id,
            link.lines.length > 0 ? `dòng ${link.lines.join(", ")}` : "",
            linkNotes(link),
          ]),
        ),
        options,
        "file",
      ),
    );

    if (translations.length > 0) {
      lines.push("", `Khoá dịch (${translations.length}):`);
      lines.push(
        ...capped(
          table(
            translations.map((link) => [
              translationKey(link.id),
              `dòng ${link.lines.join(", ")}`,
              link.conditional ? CONDITIONAL : "",
            ]),
          ),
          options,
          "khoá dịch",
        ),
      );
    }

    if (settings.length > 0) {
      lines.push("", `Setting được đọc (${settings.length}):`);
      lines.push(
        ...capped(
          table(
            settings.map((link) => [
              settingName(link.id),
              `dòng ${link.lines.join(", ")}`,
              link.conditional ? CONDITIONAL : "",
            ]),
          ),
          options,
          "setting",
        ),
      );
    }

    if (broken.length > 0) {
      lines.push("", `Tham chiếu hỏng (${broken.length}):`);
      lines.push(
        ...table(
          broken.map((ref) => [ref.line > 0 ? `dòng ${ref.line}` : "(JSON)", `${ref.kind} -> ${ref.expected}`]),
        ),
      );
    }

    return lines;
  }
}
