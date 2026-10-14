/**
 * Lỗi do người dùng gõ sai cú pháp: thiếu tham số, cờ lạ, giá trị không hợp
 * lệ. CliExceptionFilter in thông báo kèm lời chỉ tới --help và trả mã thoát 2.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
