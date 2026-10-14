/**
 * Một view đổi kết quả của một truy vấn thành những dòng chữ cho người (hoặc
 * agent) đọc. View không in gì ra và không truy vấn gì thêm: nó nhận một kết
 * quả, trả về một mảng dòng, controller quyết định gửi đi đâu.
 *
 * Tầng này đứng riêng một package vì hai lớp vỏ cùng dùng nó: CLI in các dòng
 * ra màn hình, MCP server gửi chúng cho agent. Cờ --json của CLI và API HTTP
 * bỏ qua nó hoàn toàn.
 */
export interface TextView<T> {
  render(result: T, options?: ViewOptions): string[];
}

/** Tuỳ chọn chung của các view. */
export interface ViewOptions {
  /**
   * Số dòng tối đa của MỖI danh sách trong kết quả. Phần bị cắt được thay
   * bằng một dòng đếm. Không nêu thì in hết.
   *
   * Sinh ra cho agent: đầu ra của một tool có giới hạn kích thước, và một
   * danh sách 500 dòng chiếm chỗ của những thứ đáng đọc hơn.
   */
  limit?: number;
}
