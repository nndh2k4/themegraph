/** Kiểu của một object JSON bất kỳ sau khi parse. */
type JsonObject = Record<string, unknown>;

/** Kiểm tra một giá trị có phải object thường (không phải null, không phải mảng). */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Đưa trường "blocks" về một mảng để duyệt theo một cách duy nhất.
 *
 * Shopify cho viết blocks theo hai dạng:
 *   - mảng:   "blocks": [ { "type": "_text" } ]
 *   - object: "blocks": { "id-1": { "type": "_text" } }  (kèm "block_order")
 */
function toBlockList(blocks: unknown): unknown[] {
  if (Array.isArray(blocks)) return blocks;
  if (isObject(blocks)) return Object.values(blocks);
  return [];
}

/**
 * Đọc phần thân JSON của một khối {% schema %} và trả về tên các theme block
 * (file trong blocks/) mà schema nhắc tới.
 *
 * Schema nhắc tới theme block ở ba chỗ:
 *   1. "blocks":  danh sách block mà section/block này chấp nhận
 *   2. "presets": cấu hình mẫu khi merchant thêm section trong theme editor
 *   3. "default": cấu hình mặc định khi section được gọi tĩnh bằng {% section %}
 *
 * Kết quả không trùng lặp, giữ thứ tự xuất hiện đầu tiên.
 * Ném lỗi của JSON.parse nếu thân schema không phải JSON hợp lệ.
 */
export function collectSchemaBlockTypes(schemaBody: string): string[] {
  const schema: unknown = JSON.parse(schemaBody);
  if (!isObject(schema)) return [];

  // Block CỤC BỘ: khai báo ngay trong schema, nhận ra nhờ có "name" (Shopify
  // bắt buộc block cục bộ phải có name; mục tham chiếu theme block thì chỉ có type).
  // Mã của nó nằm trong chính file này (trong vòng {% for block in section.blocks %}),
  // không phải một file trong blocks/. Đây là kiểu block của Dawn.
  const localTypes = new Set<string>();

  // Set giữ thứ tự chèn và tự loại trùng: một block được nhắc ở nhiều preset
  // vẫn chỉ là một quan hệ.
  const found = new Set<string>();

  const addType = (type: unknown): void => {
    if (typeof type !== "string") return;

    // '@theme' = chấp nhận mọi theme block, '@app' = chấp nhận block của app.
    // Cả hai là ký hiệu đại diện, không phải tên của một file cụ thể.
    if (type.startsWith("@")) return;

    if (localTypes.has(type)) return;

    found.add(type);
  };

  // Bước 1: đi qua "blocks" để biết type nào là cục bộ, type nào là tham chiếu.
  const declared = toBlockList(schema.blocks).filter(isObject);

  for (const block of declared) {
    if (typeof block.type === "string" && "name" in block) {
      localTypes.add(block.type);
    }
  }

  // Mục không có "name" là tham chiếu tới theme block.
  for (const block of declared) {
    addType(block.type);
  }

  // Bước 2: presets và default. Block trong đó có thể lồng nhau nhiều tầng.
  const collectNested = (blocks: unknown): void => {
    for (const block of toBlockList(blocks)) {
      if (!isObject(block)) continue;
      addType(block.type);
      collectNested(block.blocks);
    }
  };

  if (Array.isArray(schema.presets)) {
    for (const preset of schema.presets) {
      if (isObject(preset)) collectNested(preset.blocks);
    }
  }

  if (isObject(schema.default)) {
    collectNested(schema.default.blocks);
  }

  return [...found];
}
