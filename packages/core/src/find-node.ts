import path from "node:path";

import type { GraphHandle } from "./open.js";
import type { GraphNode, NodeKind } from "./types.js";

/** Số gợi ý tối đa kèm theo lỗi không tìm thấy node. */
const MAX_SUGGESTIONS = 5;

/**
 * Lỗi ném ra khi tên người dùng đưa vào không ứng với node nào. `suggestions`
 * là id của các node có tên gần giống, để người (hoặc agent) gọi thử lại.
 */
export class NodeNotFoundError extends Error {
  readonly input: string;
  readonly suggestions: string[];

  constructor(input: string, suggestions: string[]) {
    const hint = suggestions.length > 0 ? ` Có phải ý bạn là: ${suggestions.join(", ")}?` : "";
    super(`Không có node "${input}" trong đồ thị.${hint}`);
    this.name = "NodeNotFoundError";
    this.input = input;
    this.suggestions = suggestions;
  }
}

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

/**
 * Tìm node ứng với một cái tên do người dùng gõ.
 *
 * Thử lần lượt các cách hiểu, lấy cách đầu tiên ra kết quả:
 *   1. id nguyên văn:            snippets/card.liquid, page:product
 *   2. đường dẫn trên đĩa:       C:\themes\dawn\snippets\card.liquid, hoặc
 *                                card.liquid khi đang đứng trong snippets/
 *   3. tên trang thiếu tiền tố:  product -> page:product
 *
 * Ném NodeNotFoundError (kèm gợi ý) nếu không cách nào ra kết quả.
 */
export function findNode(graph: GraphHandle, input: string, options: FindNodeOptions = {}): GraphNode {
  // Id luôn dùng gạch chéo xuôi, kể cả trên Windows.
  const normalized = toPosix(input);

  // Cách hiểu 2: coi input là đường dẫn trên đĩa rồi tính lại nó so với gốc
  // theme. path.resolve giữ nguyên đường dẫn tuyệt đối, nối đường dẫn tương
  // đối vào baseDir, và tự gỡ "./" lẫn "..". Đường dẫn trỏ ra ngoài theme cho
  // kết quả bắt đầu bằng "..", vốn không trùng với id nào.
  const absolute = path.resolve(options.baseDir ?? graph.themeRoot, input);
  const relative = toPosix(path.relative(graph.themeRoot, absolute));

  const candidates = [normalized, relative, `page:${normalized}`];

  const select = graph.db.prepare("SELECT id, kind FROM nodes WHERE id = ?");

  for (const candidate of candidates) {
    const row = select.get(candidate);
    if (row !== undefined) {
      return { id: String(row.id), kind: String(row.kind) as NodeKind };
    }
  }

  throw new NodeNotFoundError(input, suggest(graph, normalized));
}

/**
 * Tìm các node có id chứa tên file của input (bỏ thư mục và đuôi), để gợi ý
 * khi người dùng gõ thiếu đuôi hoặc nhầm thư mục.
 */
function suggest(graph: GraphHandle, normalized: string): string[] {
  const lastSegment = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = lastSegment.indexOf(".");
  const stem = dot > 0 ? lastSegment.slice(0, dot) : lastSegment;

  if (stem === "") return [];

  // instr() tìm chuỗi con nguyên văn. Không dùng LIKE vì LIKE coi % và _ là
  // ký tự đại diện, mà _ rất hay có trong tên file của theme.
  return graph.db
    .prepare("SELECT id FROM nodes WHERE instr(id, ?) > 0 ORDER BY id LIMIT ?")
    .all(stem, MAX_SUGGESTIONS)
    .map((row) => String(row.id));
}
