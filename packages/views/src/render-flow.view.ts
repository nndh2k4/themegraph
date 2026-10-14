import type { FlowNode, Reached, RenderFlowResult } from "@themegraph/core";

import { capped, CONDITIONAL } from "./text.js";
import type { TextView, ViewOptions } from "./text-view.js";

/** Gom id của mọi node có con ở chỗ nó được mở ra trong cây. */
function collectParents(node: FlowNode, parents: Set<string>): Set<string> {
  if (node.children.length > 0) parents.add(node.id);
  for (const child of node.children) collectParents(child, parents);
  return parents;
}

/**
 * Vẽ một node của cây và mọi node con, mỗi tầng thụt vào hai dấu cách.
 *
 * `parents` là các node có con. Một node lặp lại chỉ được ghi chú khi nó thuộc
 * tập này, tức khi ở đây thật sự có các con bị giấu đi; một file lá (ví dụ một
 * icon) xuất hiện nhiều lần thì không mất thông tin gì nên không cần ghi chú.
 */
function drawTree(node: FlowNode, parents: ReadonlySet<string>, lines: string[]): void {
  const notes: string[] = [];
  if (node.count > 1) notes.push(`×${node.count}`);
  if (node.conditional) notes.push(CONDITIONAL);
  if (node.repeated && parents.has(node.id)) notes.push("(các file con: xem ở chỗ khác trong cây)");
  if (node.hidden > 0) notes.push(`(${node.hidden} file con chưa mở)`);

  lines.push(["  ".repeat(node.depth) + node.id, ...notes].join("  "));

  for (const child of node.children) drawTree(child, parents, lines);
}

/**
 * Thứ tự in các loại file trong dòng tổng hợp của render-flow: từ ngoài vào
 * trong theo cách một trang được dựng.
 */
const FLOW_KIND_ORDER = ["template", "layout", "section_group", "section", "block", "snippet", "asset"] as const;

/**
 * Hai dòng tổng hợp đặt trước cây: đếm file theo loại, và danh sách ĐẦY ĐỦ các
 * section của trang.
 *
 * Cây có thể bị cắt theo độ sâu hoặc số dòng, còn hai dòng này tính trên toàn
 * bộ `files`, nên câu hỏi hay gặp nhất, "trang này có những section nào",
 * luôn có câu trả lời đủ. Trong nghiệm thu, một agent chỉ đọc phần cây đã cắt
 * và bỏ sót bảy section nằm dưới một section group ở tầng 4.
 */
function flowSummary(files: readonly Reached[]): string[] {
  const counts = FLOW_KIND_ORDER.map((kind) => [kind, files.filter((node) => node.kind === kind).length] as const).filter(
    ([, count]) => count > 0,
  );

  const lines = [`Theo loại: ${counts.map(([kind, count]) => `${count} ${kind}`).join(", ")}.`];

  const sections = files.filter((node) => node.kind === "section");
  if (sections.length > 0) {
    // Xếp theo id cho dễ dò; `files` vốn xếp theo độ sâu.
    const names = sections
      .map((node) => node.id + (node.certain ? "" : ` ${CONDITIONAL}`))
      .sort()
      .join(", ");
    lines.push(`Section (${sections.length}): ${names}`);
  }
  return lines;
}

/** Có node nào trong cây bị cắt các con đi không. */
function hasHidden(node: FlowNode): boolean {
  return node.hidden > 0 || node.children.some(hasHidden);
}

/** Một trang (hoặc một file) kéo theo những file nào, vẽ thành cây. */
export class RenderFlowView implements TextView<RenderFlowResult> {
  render(result: RenderFlowResult, options: ViewOptions = {}): string[] {
    const { root, files, tree } = result;

    if (files.length === 0) {
      return [`${root.id} (${root.kind}) không gọi tới file nào.`];
    }

    const deepest = Math.max(...files.map((node) => node.depth));
    const lines = [
      `${root.id} (${root.kind}) kéo theo ${files.length} file, sâu nhất ${deepest} tầng.`,
      ...flowSummary(files),
    ];

    // Chỉ nói về giới hạn khi nó thật sự giấu đi thứ gì.
    if (result.maxDepth !== null && hasHidden(tree)) {
      lines.push(
        `Cây dưới đây dừng ở tầng ${result.maxDepth}. Hỏi tiếp từ một file trong cây, hoặc tăng độ sâu, để xem phần bên dưới.`,
      );
    }
    lines.push("");

    const drawn: string[] = [];
    drawTree(tree, collectParents(tree, new Set()), drawn);
    lines.push(...capped(drawn, options, "dòng"));
    return lines;
  }
}
