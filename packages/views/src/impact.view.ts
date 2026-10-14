import type { ImpactResult } from "@themegraph/core";

import { capped, CONDITIONAL, pageName, table } from "./text.js";
import type { TextView, ViewOptions } from "./text-view.js";

/** Số file tối đa nêu tên sau chữ "qua" ở mỗi trang; phần còn lại chỉ đếm. */
const MAX_VIA_SHOWN = 3;

/** Nhãn của trang chỉ đi tới target qua một section do JavaScript tải. */
const SCRIPT_ONLY = "[qua JavaScript]";

/** Ghi chú của file có dùng target nhưng không nằm trên trang nào. */
const OFF_PAGE = "[không trang nào dùng]";

/** "qua a, b, c và 2 file khác"; rỗng khi trang gọi thẳng target. */
function viaNote(via: readonly string[]): string {
  if (via.length === 0) return "";

  const shown = via.slice(0, MAX_VIA_SHOWN).join(", ");
  const more = via.length > MAX_VIA_SHOWN ? ` và ${via.length - MAX_VIA_SHOWN} file khác` : "";
  return `qua ${shown}${more}`;
}

/** Sửa một file thì trang nào, file nào bị ảnh hưởng. */
export class ImpactView implements TextView<ImpactResult> {
  render(result: ImpactResult, options: ViewOptions = {}): string[] {
    const { target, affected, pages } = result;

    if (affected.length === 0) {
      return [`Không file hay trang nào dùng tới ${target.id} (${target.kind}).`];
    }

    const files = affected.filter((node) => node.kind !== "page_type");
    const offPage = new Set(result.offPage);
    // Trang render target ngay khi tải đứng trước; trang chỉ dính qua một
    // section do JavaScript tải đứng sau. sort() giữ thứ tự cũ trong mỗi nhóm.
    const ordered = [...pages].sort((a, b) => Number(a.scriptOnly) - Number(b.scriptOnly));
    const scriptOnly = ordered.filter((page) => page.scriptOnly).length;

    const lines = [
      `Sửa ${target.id} (${target.kind}) ảnh hưởng ${files.length} file và ${pages.length} trên ${result.totalPages} trang` +
        (scriptOnly > 0 ? `, trong đó ${scriptOnly} trang chỉ ${SCRIPT_ONLY.slice(1, -1)}.` : "."),
    ];

    if (pages.length > 0) {
      lines.push("", `Trang (${pages.length}):`);
      lines.push(
        ...table(
          ordered.map((page) => [
            pageName(page.id),
            `cách ${page.depth} tầng`,
            // Nhãn [qua JavaScript] đã hàm ý có điều kiện.
            page.scriptOnly ? SCRIPT_ONLY : page.certain ? "" : CONDITIONAL,
            viaNote(page.via),
          ]),
        ),
      );

      if (scriptOnly > 0) {
        lines.push(
          `Trang ghi ${SCRIPT_ONLY}: ${target.id} chỉ lên trang đó khi JavaScript tải riêng một section (Section Rendering API), ví dụ lúc mở giỏ hàng hoặc gõ vào ô tìm kiếm.`,
        );
      }
    }

    if (files.length > 0) {
      // Danh sách trang ở trên không bao giờ bị cắt: nó chính là câu trả lời.
      lines.push("", `File (${files.length}), gần nhất trước:`);
      lines.push(
        ...capped(
          table(
            files.map((node) => [
              String(node.depth),
              node.id,
              node.kind,
              node.certain ? "" : CONDITIONAL,
              offPage.has(node.id) ? OFF_PAGE : "",
            ]),
          ),
          options,
          "file",
        ),
      );

      if (offPage.size > 0) {
        lines.push(
          "",
          `File ghi ${OFF_PAGE}: theo đồ thị, nó có dùng ${target.id} nhưng không template hay file nào trên một trang gọi tới nó. Nó vẫn có thể lên trang nếu merchant thêm nó từ theme editor, hoặc nếu JavaScript tải nó (Section Rendering API), hai cách mà đồ thị không thấy.`,
        );
      }
    }

    return lines;
  }
}
