import path from "node:path";

import { NodeNotFoundError } from "../common/errors.js";
import type { GraphNode, NodeKind } from "../models/index.js";
import type { GraphRepository } from "./graph.repository.js";

/** Số gợi ý tối đa kèm theo lỗi không tìm thấy node. */
const MAX_SUGGESTIONS = 5;

export interface FindNodeOptions {
  /**
   * Thư mục dùng để hiểu đường dẫn tương đối, thường là thư mục đang đứng của
   * người gọi lệnh. Không có thì đường dẫn tương đối được tính từ gốc theme.
   */
  baseDir?: string;
}

/** Đổi dấu gạch chéo ngược của Windows thành dấu gạch chéo xuôi. */
function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

/** Các loại node không phải file; cách hiểu 4 không xét tới chúng. */
const NON_FILE_KINDS: readonly NodeKind[] = ["page_type", "translation_key", "setting"];

/**
 * Tìm node ứng với một cái tên do người dùng gõ.
 *
 * Thử lần lượt các cách hiểu, lấy cách đầu tiên ra kết quả:
 *   1. id nguyên văn:            snippets/card.liquid, page:product
 *   2. đường dẫn trên đĩa:       C:\themes\dawn\snippets\card.liquid, hoặc
 *                                card.liquid khi đang đứng trong snippets/
 *   3. tên trang thiếu tiền tố:  product -> page:product
 *   4. tên file không kèm thư mục: card-product hoặc card-product.liquid
 *                                -> snippets/card-product.liquid, với điều
 *                                kiện cả theme chỉ có MỘT file tên như vậy
 *
 * Cách 4 sinh ra cho agent và cho người gõ nhanh: họ nói "card-product" chứ
 * không nói "snippets/card-product.liquid". Khi có hai file trùng tên (ví dụ
 * sections/header.liquid và snippets/header.liquid) thì không đoán: lỗi trả
 * về liệt kê cả hai để người gọi chọn.
 *
 * Ném NodeNotFoundError (kèm gợi ý) nếu không cách nào ra kết quả.
 */
export function findNode(graph: GraphRepository, input: string, options: FindNodeOptions = {}): GraphNode {
  // Id luôn dùng gạch chéo xuôi, kể cả trên Windows.
  const normalized = toPosix(input);

  // Cách hiểu 2: coi input là đường dẫn trên đĩa rồi tính lại nó so với gốc
  // theme. path.resolve giữ nguyên đường dẫn tuyệt đối, nối đường dẫn tương
  // đối vào baseDir, và tự gỡ "./" lẫn "..". Đường dẫn trỏ ra ngoài theme cho
  // kết quả bắt đầu bằng "..", vốn không trùng với id nào.
  const absolute = path.resolve(options.baseDir ?? graph.themeRoot, input);
  const relative = toPosix(path.relative(graph.themeRoot, absolute));

  for (const candidate of [normalized, relative, `page:${normalized}`]) {
    const node = graph.getNode(candidate);
    if (node !== null) return node;
  }

  const sameName = filesNamed(graph, normalized);
  if (sameName.length === 1 && sameName[0] !== undefined) return sameName[0];
  if (sameName.length > 1) {
    throw new NodeNotFoundError(
      input,
      sameName.map((node) => node.id),
    );
  }

  throw new NodeNotFoundError(input, suggest(graph, normalized));
}

/**
 * Các node file có tên đúng bằng `name`, không phân biệt hoa thường. "Tên" của
 * snippets/card.liquid là "card.liquid", hoặc "card" khi bỏ đuôi cuối cùng.
 *
 * Chỉ áp dụng cho tên không có dấu "/": một cái tên đã kèm thư mục mà không
 * trùng id nào thì là gõ sai, không phải gõ tắt.
 */
function filesNamed(graph: GraphRepository, name: string): GraphNode[] {
  if (name === "" || name.includes("/")) return [];

  const wanted = name.toLowerCase();

  // Lọc sơ ở repository (id có chứa tên), rồi so chính xác ở đây.
  return graph.findNodes(wanted, { ignoreCase: true }).filter((node) => {
    if (NON_FILE_KINDS.includes(node.kind)) return false;

    const base = node.id.slice(node.id.lastIndexOf("/") + 1).toLowerCase();
    const dot = base.lastIndexOf(".");
    return base === wanted || (dot > 0 && base.slice(0, dot) === wanted);
  });
}

/**
 * Tìm các node có id chứa tên file của input (bỏ thư mục và đuôi), để gợi ý
 * khi người dùng gõ thiếu đuôi hoặc nhầm thư mục.
 */
function suggest(graph: GraphRepository, normalized: string): string[] {
  const lastSegment = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = lastSegment.indexOf(".");
  const stem = dot > 0 ? lastSegment.slice(0, dot) : lastSegment;

  if (stem === "") return [];

  return graph.findNodes(stem, { ignoreCase: false, limit: MAX_SUGGESTIONS }).map((node) => node.id);
}
