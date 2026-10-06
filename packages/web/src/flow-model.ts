import type { FlowNode } from "@themegraph/core";

/**
 * Phần tính toán của màn cây render, tách khỏi giao diện để test được.
 */

/** Cây mở sẵn tới tầng này (gốc là 0): trang, template, rồi layout và section. */
export const OPEN_DEPTH = 2;

/**
 * Trang hiện ra khi địa chỉ không nêu trang nào: trang chủ nếu theme có, không
 * thì trang đầu tiên trong danh sách. Theme không có trang nào thì trả null.
 */
export function defaultPage(pages: readonly string[]): string | null {
  if (pages.includes("index")) return "index";
  return pages[0] ?? null;
}

/** Một node của cây có được mở sẵn không. Node không có con thì không có gì để mở. */
export function opensByDefault(node: FlowNode): boolean {
  return node.children.length > 0 && node.depth < OPEN_DEPTH;
}

/**
 * Số tầng từ trang xuống tới file nằm sâu nhất, tính theo đường NGẮN NHẤT tới
 * mỗi file. Đây là con số lệnh `themegraph render-flow` in ra.
 *
 * Không lấy tầng sâu nhất của cây: một file đã liệt kê ở tầng 2 có thể hiện
 * lại (dạng dòng lặp) ở tầng 6, và cây khi đó sâu hơn con số này.
 */
export function deepestFile(files: readonly { depth: number }[]): number {
  return files.reduce((deepest, file) => Math.max(deepest, file.depth), 0);
}

/** Các con số tóm tắt của một cây. */
export interface FlowStats {
  rows: number; // số dòng của cây, kể cả gốc và các dòng lặp
  repeated: number; // số dòng là file đã được liệt kê ở chỗ khác
  conditional: number; // số dòng tới được qua một quan hệ có điều kiện
}

export function flowStats(tree: FlowNode): FlowStats {
  const stats: FlowStats = { rows: 0, repeated: 0, conditional: 0 };

  // Duyệt bằng ngăn xếp thay vì đệ quy: cây của một trang trên theme lớn có
  // hàng nghìn dòng.
  const stack = [tree];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    stats.rows++;
    if (node.repeated) stats.repeated++;
    if (node.conditional) stats.conditional++;
    stack.push(...node.children);
  }

  return stats;
}
