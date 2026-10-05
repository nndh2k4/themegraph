import { stripLeadingComment } from "./extract-json.js";
import type { ThemeFile } from "./types.js";

/** Tiền tố của id node setting, để không trùng với đường dẫn file nào. */
export const SETTING_PREFIX = "setting:";

/**
 * Đối tượng Liquid mà một setting được đọc qua:
 *
 * - section: {{ section.settings.x }}, setting của một section
 * - block:   {{ block.settings.x }}, setting của một block
 */
export type SettingObject = "section" | "block";

/**
 * Id của node setting. Phần sau tiền tố viết đúng như cách Liquid đọc nó,
 * kèm file định nghĩa:
 *
 *   setting:settings.cart_type                    setting toàn cục của theme
 *   setting:sections/header.liquid#section.logo   setting của section header
 *   setting:sections/header.liquid#block.title    setting của block cục bộ trong header
 *   setting:blocks/text.liquid#block.text         setting của theme block text
 *
 * `owner` là null với setting toàn cục, còn lại là đường dẫn file có {% schema %}
 * khai setting đó.
 */
export function settingNodeId(owner: string | null, object: SettingObject | "settings", id: string): string {
  return owner === null ? `${SETTING_PREFIX}settings.${id}` : `${SETTING_PREFIX}${owner}#${object}.${id}`;
}

/** File khai các setting toàn cục của theme (mục Theme settings trong theme editor). */
export function isGlobalSettingsSchema(file: ThemeFile): boolean {
  return file.path === "config/settings_schema.json";
}

/** Kiểm tra một giá trị có phải object thường (không phải null, không phải mảng). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lấy id của các setting trong một mảng "settings" của schema.
 *
 * Mục không có id bị bỏ qua: đó là các mục chỉ để trình bày trong theme
 * editor ("header", "paragraph"), không có giá trị nào để mã đọc.
 */
export function settingIdsOf(settings: unknown): string[] {
  if (!Array.isArray(settings)) return [];

  const ids: string[] = [];
  for (const entry of settings) {
    if (isObject(entry) && typeof entry.id === "string") ids.push(entry.id);
  }
  return ids;
}

/**
 * Đọc config/settings_schema.json và trả về id node của mọi setting toàn cục.
 *
 * File này là một MẢNG các nhóm; mỗi nhóm có "settings" riêng. Nhóm đầu
 * thường là "theme_info" và không có setting nào.
 *
 * Ném lỗi có tên file nếu nội dung không phải JSON hợp lệ.
 */
export function collectGlobalSettings(file: ThemeFile, content: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(stripLeadingComment(content));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Không đọc được JSON của "${file.path}": ${reason}`, { cause: error });
  }

  if (!Array.isArray(data)) return [];

  const ids = new Set<string>();
  for (const group of data) {
    if (!isObject(group)) continue;
    for (const id of settingIdsOf(group.settings)) ids.add(settingNodeId(null, "settings", id));
  }
  return [...ids];
}
