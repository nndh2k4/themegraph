/**
 * Gỡ chú thích khỏi một file JSON của theme, để JSON.parse đọc được.
 *
 * JSON chuẩn không có chú thích, nhưng Shopify chấp nhận chúng trong các file
 * JSON của theme, và chính nó cũng viết ra:
 *
 *   - Theme editor ghi một khối chú thích ở đầu mọi file nó sinh ra
 *     ("IMPORTANT: The contents of this file are auto-generated").
 *   - File dịch có thể có ghi chú cho người dịch ngay giữa file, dạng một dòng
 *     bắt đầu bằng hai dấu gạch chéo (theme Horizon của Shopify có).
 *
 * Hàm nhận cả hai kiểu chú thích, ở bất cứ đâu ngoài chuỗi: kiểu một dòng (từ
 * hai dấu gạch chéo tới hết dòng) và kiểu khối (giữa gạch chéo-sao và
 * sao-gạch chéo). Hai dấu gạch chéo nằm TRONG một chuỗi, như trong địa chỉ
 * "https://...", không phải chú thích; vì vậy không thể gỡ bằng một biểu thức
 * chính quy mà phải đi từng ký tự và biết mình đang ở trong chuỗi hay ngoài.
 *
 * Chú thích được thay bằng dấu cách chứ không cắt đi, và ký tự xuống dòng bên
 * trong được giữ lại. Nhờ vậy nội dung trả về dài đúng bằng nội dung gốc, và
 * khi file sai cú pháp thì số dòng trong thông báo của JSON.parse là số dòng
 * của file thật. (Riêng dấu BOM ở đầu file, nếu có, bị cắt hẳn: nó không nằm
 * trên dòng nào.)
 *
 * Hàm không kiểm tra JSON có hợp lệ không; đó là việc của JSON.parse.
 */
export function stripJsonComments(content: string): string {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  // Phần lớn file không có chú thích nào: trả luôn, khỏi dựng lại chuỗi.
  if (!text.includes("//") && !text.includes("/*")) return text;

  let out = "";
  let copiedTo = 0; // mọi ký tự trước vị trí này đã được đưa vào `out`
  let i = 0;

  /** Thay đoạn [from, to) bằng dấu cách, giữ lại các ký tự xuống dòng. */
  const blank = (from: number, to: number): void => {
    out += text.slice(copiedTo, from) + text.slice(from, to).replace(/[^\r\n]/g, " ");
    copiedTo = to;
  };

  while (i < text.length) {
    const char = text[i];

    if (char === '"') {
      // Nhảy qua cả chuỗi. Ký tự đứng sau một dấu \ luôn thuộc về chuỗi, kể
      // cả khi nó là dấu nháy.
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }

    if (char === "/" && text[i + 1] === "/") {
      let end = i;
      while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end++;
      blank(i, end);
      i = end;
      continue;
    }

    if (char === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      // Khối không đóng: coi như kéo tới hết file; JSON.parse sẽ báo lỗi.
      const end = close === -1 ? text.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }

    i++;
  }

  return out + text.slice(copiedTo);
}
