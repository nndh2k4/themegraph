import { BadRequestError } from "../http.errors.js";

/**
 * Đọc và kiểm tra tham số query của một request (giống ValidationPipe của
 * NestJS). Giá trị không hợp lệ thì ném BadRequestError, thành mã 400.
 */
export class QueryParams {
  constructor(private readonly query: URLSearchParams) {}

  /** Giá trị nguyên văn, hoặc null khi vắng mặt. */
  get(name: string): string | null {
    return this.query.get(name);
  }

  /** Một tham số bắt buộc; thiếu hoặc rỗng thì báo 400. */
  required(name: string): string {
    const value = this.query.get(name);
    if (value === null || value.trim() === "") throw new BadRequestError(`Thiếu tham số "${name}".`);
    return value;
  }

  /** Một tham số là số nguyên từ `min` trở lên; vắng mặt thì trả undefined. */
  optionalInt(name: string, min: number): number | undefined {
    const value = this.query.get(name);
    if (value === null) return undefined;
    // Chỉ nhận chuỗi toàn chữ số: Number() còn hiểu cả "1e3", " 5 " và "".
    if (!/^\d+$/.test(value) || Number(value) < min) {
      throw new BadRequestError(`Tham số "${name}" phải là số nguyên từ ${min} trở lên.`);
    }
    return Number(value);
  }

  /** Một tham số dạng danh sách cách nhau bằng dấu phẩy, mỗi mục phải thuộc `allowed`. */
  optionalList<T extends string>(name: string, allowed: readonly T[]): T[] {
    const value = this.query.get(name);
    if (value === null || value === "") return [];

    const items = value.split(",").map((item) => item.trim());
    const unknown = items.find((item) => !(allowed as readonly string[]).includes(item));
    if (unknown !== undefined) {
      throw new BadRequestError(`Tham số "${name}" không nhận giá trị "${unknown}". Các giá trị: ${allowed.join(", ")}.`);
    }
    return items as T[];
  }
}
