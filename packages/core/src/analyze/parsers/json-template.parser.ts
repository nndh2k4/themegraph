import { stripJsonComments } from "./json-comments.js";
import type { RawRef, RefKind, ThemeFile } from "./types.js";

/** Kiểu của một object JSON bất kỳ sau khi parse. */
type JsonObject = Record<string, unknown>;

/** Kiểm tra một giá trị có phải object thường (không phải null, không phải mảng). */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Trích quan hệ thô từ một file JSON template hoặc section group.
 *
 * Nhận nội dung file dưới dạng chuỗi thay vì tự đọc đĩa, để hàm không phụ
 * thuộc vào hệ thống file và test được bằng chuỗi viết ngay trong test.
 *
 * Mọi ref trả về đều có source 'json' và line 0 (JSON.parse không giữ số dòng).
 */
export function extractJsonRefs(file: ThemeFile, content: string): RawRef[] {
  // Chỉ hai loại file JSON này mô tả "trang gồm những section nào".
  // config/, locales/ cũng là JSON nhưng không chứa quan hệ render.
  if (file.kind !== "template" && file.kind !== "section_group") return [];

  // Template có thể là file .liquid (ví dụ gift_card.liquid): không phải JSON.
  if (file.ext !== "json") return [];

  let data: unknown;
  try {
    data = JSON.parse(stripJsonComments(content));
  } catch (error) {
    // Bọc lỗi lại để thông báo nói rõ file nào hỏng; lỗi gốc của JSON.parse
    // chỉ có vị trí ký tự, không có tên file. Giữ lỗi gốc trong `cause` để
    // khi cần vẫn xem được stack trace ban đầu.
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Không đọc được JSON của "${file.path}": ${reason}`, {
      cause: error,
    });
  }

  if (!isObject(data)) return [];

  const refs: RawRef[] = [];

  // Hàm con để mọi ref được tạo ở đúng một chỗ, cùng một khuôn.
  const addRef = (kind: RefKind, to: string, conditional: boolean): void => {
    refs.push({ from: file.path, to, kind, source: "json", conditional, line: 0 });
  };

  // "layout": "password" nghĩa là trang này dùng layout/password.liquid thay
  // cho layout/theme.liquid mặc định. "layout": false nghĩa là không có layout.
  // Không có khoá này thì dùng mặc định; việc đó để tầng dựng đồ thị xử lý.
  if (typeof data.layout === "string") {
    addRef("layout", data.layout, false);
  } else if (data.layout === false) {
    // Ghi lại lựa chọn "không layout" bằng một ref có đích rỗng.
    addRef("no_layout", "", false);
  }

  /**
   * Duyệt một object "blocks" và đi đệ quy vào block lồng bên trong.
   *
   * `parentDisabled` truyền trạng thái tắt từ trên xuống: block nằm trong một
   * section hoặc block đã bị tắt thì cũng không được render.
   */
  const collectBlocks = (blocks: unknown, parentDisabled: boolean): void => {
    if (!isObject(blocks)) return;

    for (const block of Object.values(blocks)) {
      if (!isObject(block) || typeof block.type !== "string") continue;

      // Block của app có type dạng 'shopify://apps/...': mã của nó nằm ở app,
      // không phải file trong theme, nên không có gì để trỏ tới.
      if (block.type.startsWith("shopify://")) continue;

      const disabled = parentDisabled || block.disabled === true;

      // Lưu ý: type ở đây có thể là block cục bộ khai trong {% schema %} của
      // section (kiểu Dawn) chứ không phải file trong blocks/. Tầng parse không
      // phân biệt được; resolver sẽ quyết định khi đối chiếu với danh sách file.
      addRef("block", block.type, disabled);

      collectBlocks(block.blocks, disabled);
    }
  };

  if (isObject(data.sections)) {
    for (const section of Object.values(data.sections)) {
      if (!isObject(section) || typeof section.type !== "string") continue;

      // Section bị tắt trong theme editor vẫn nằm trong JSON. Vẫn ghi nhận
      // quan hệ, nhưng đánh dấu conditional vì nó không chắc được render.
      const disabled = section.disabled === true;

      addRef("section", section.type, disabled);
      collectBlocks(section.blocks, disabled);
    }
  }

  return refs;
}
