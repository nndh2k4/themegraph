import { createHash } from "node:crypto";

/**
 * Dấu vân tay của nội dung một file: hai nội dung giống hệt nhau cho cùng một
 * chuỗi, khác nhau dù một ký tự cho chuỗi khác.
 *
 * analyze ghi hash của từng file nó đọc vào graph.db; status tính lại hash của
 * file hiện có trên đĩa rồi so. Cả hai phải dùng đúng hàm này.
 *
 * SHA-1 là đủ: ở đây chỉ cần phát hiện thay đổi, không phải chống giả mạo.
 */
export function hashContent(content: string): string {
  return createHash("sha1").update(content, "utf8").digest("hex");
}
