import { settingIdsOf } from "./extract-settings.js";

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

/** Kết quả đọc một khối {% schema %}. */
export interface ParsedSchema {
  blockTypes: string[]; // tên các theme block (file trong blocks/) được nhắc tới
  presets: number; // số mục trong "presets"
  acceptsThemeBlocks: boolean; // "blocks" có mục "@theme" hay không
  settings: string[]; // id của các setting khai ở tầng ngoài cùng của schema
  // Id của các setting khai trong block CỤC BỘ, gộp mọi loại block lại và bỏ
  // trùng. Gộp vì mã đọc chúng qua cùng một cách viết, block.settings.x, và
  // khi đọc mã không biết lúc đó block thuộc loại nào.
  blockSettings: string[];
}

/**
 * Đọc phần thân JSON của một khối {% schema %}: tên các theme block (file
 * trong blocks/) mà schema nhắc tới, số preset, và schema có nhận mọi theme
 * block hay không.
 *
 * Schema nhắc tới theme block ở ba chỗ:
 *   1. "blocks":  danh sách block mà section/block này chấp nhận
 *   2. "presets": cấu hình mẫu khi merchant thêm section trong theme editor
 *   3. "default": cấu hình mặc định khi section được gọi tĩnh bằng {% section %}
 *
 * blockTypes không trùng lặp, giữ thứ tự xuất hiện đầu tiên.
 * Ném lỗi của JSON.parse nếu thân schema không phải JSON hợp lệ.
 */
export function parseSchema(schemaBody: string): ParsedSchema {
  const schema: unknown = JSON.parse(schemaBody);
  if (!isObject(schema)) {
    return { blockTypes: [], presets: 0, acceptsThemeBlocks: false, settings: [], blockSettings: [] };
  }

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

  return {
    blockTypes: [...found],
    presets: Array.isArray(schema.presets) ? schema.presets.length : 0,
    // Chỉ xét "blocks" ở tầng ngoài cùng: đó là nơi schema khai nó nhận gì.
    // "@theme" nằm trong presets không có nghĩa này.
    acceptsThemeBlocks: declared.some((block) => block.type === "@theme"),
    settings: settingIdsOf(schema.settings),
    blockSettings: [...new Set(declared.flatMap((block) => settingIdsOf(block.settings)))],
  };
}
