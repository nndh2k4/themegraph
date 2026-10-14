/**
 * Các lỗi mà lõi ném ra cho lớp vỏ (CLI, MCP, HTTP).
 *
 * Mọi lỗi ở đây đều là lỗi "người dùng chữa được": thông báo đã viết cho người
 * đọc và nói luôn cách chữa. Chúng có lớp riêng để exception filter của từng
 * lớp vỏ đổi đúng thành mã thoát, isError hay mã HTTP, mà không phải dò chữ
 * trong thông báo. Lỗi không thuộc các lớp này là lỗi lập trình.
 */
export class ThemeGraphError extends Error {}

/**
 * Vì sao không mở được đồ thị của một theme.
 *
 * - not_analyzed: theme chưa có .themegraph/graph.db
 * - unreadable:   có file graph.db nhưng không đọc được (không phải SQLite,
 *                 hoặc thiếu bảng)
 * - outdated:     graph.db do một phiên bản lược đồ khác ghi ra
 *
 * Cả ba đều có cùng cách chữa: chạy lại "themegraph analyze".
 */
export type GraphNotReadyReason = "not_analyzed" | "unreadable" | "outdated";

/** Lỗi ném ra khi một theme chưa có đồ thị dùng được. */
export class GraphNotReadyError extends ThemeGraphError {
  readonly reason: GraphNotReadyReason;

  constructor(reason: GraphNotReadyReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GraphNotReadyError";
    this.reason = reason;
  }
}

/**
 * Lỗi ném ra khi tên người dùng đưa vào không ứng với node nào. `suggestions`
 * là id của các node có tên gần giống, để người (hoặc agent) gọi thử lại.
 */
export class NodeNotFoundError extends ThemeGraphError {
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
