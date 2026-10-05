import { settingNodeId } from "./extract-settings.js";
import type { FileKind, RawRef } from "./types.js";

/** Một file gọi (trực tiếp hoặc qua trung gian) tới file đang đọc setting. */
export interface Ancestor {
  path: string;
  kind: FileKind;
}

/**
 * Kết quả phân giải một lần đọc setting.
 *
 * - resolved:   tìm thấy; có thể nhiều đích (xem bên dưới)
 * - missing:    file tự đọc một setting mà chính schema của nó không khai.
 *               Đây là lỗi: giá trị luôn rỗng.
 * - unresolved: không xác định được setting thuộc về đâu khi chỉ đọc mã.
 *               Không phải lỗi, chỉ là giới hạn của phân tích tĩnh.
 */
export type SettingResolution =
  | { status: "resolved"; targets: string[] }
  | { status: "missing"; expected: string }
  | { status: "unresolved" };

/**
 * Tìm (các) setting mà một lần đọc trỏ tới.
 *
 * `ref.to` là cách mã viết: 'settings.x', 'section.settings.x' hoặc
 * 'block.settings.x'. Ba dạng đó được hiểu khác nhau tuỳ file đang đọc:
 *
 *   settings.x           luôn là setting toàn cục
 *
 *   section.settings.x   trong một section: setting của chính section đó
 *                        trong snippet hay block: setting của section ĐANG
 *                        render nó. Không biết là section nào khi đọc mã, nên
 *                        đích là mọi section tổ tiên có khai x.
 *
 *   block.settings.x     trong một theme block: setting của chính block đó
 *                        trong một section: setting của block cục bộ khai
 *                        trong schema của section đó
 *                        trong snippet: mọi section và block tổ tiên có khai x
 *
 * Hai trường hợp đầu của mỗi dạng là đọc TRỰC TIẾP: file đọc setting của
 * chính nó, nên không thấy thì là lỗi (missing). Trường hợp qua tổ tiên mà
 * không thấy thì chỉ là unresolved.
 *
 * `ancestors` là mọi file dẫn tới file đang đọc qua cạnh RENDERS.
 */
export function resolveSettingRef(
  ref: RawRef,
  fromKind: FileKind | undefined,
  ancestors: readonly Ancestor[],
  knownIds: ReadonlySet<string>,
): SettingResolution {
  const [object, second, third] = ref.to.split(".");

  let candidates: string[];
  let direct: boolean;

  if (object === "settings" && second !== undefined) {
    candidates = [settingNodeId(null, "settings", second)];
    direct = true;
  } else if (object === "section" && third !== undefined) {
    if (fromKind === "section") {
      candidates = [settingNodeId(ref.from, "section", third)];
      direct = true;
    } else {
      // Không cần lọc tổ tiên theo loại: chỉ section mới có setting dạng
      // "#section.", nên ứng viên từ tổ tiên khác tự rơi ở bước đối chiếu.
      candidates = ancestors.map((ancestor) => settingNodeId(ancestor.path, "section", third));
      direct = false;
    }
  } else if (object === "block" && third !== undefined) {
    if (fromKind === "block" || fromKind === "section") {
      candidates = [settingNodeId(ref.from, "block", third)];
      direct = true;
    } else {
      candidates = ancestors
        .filter((ancestor) => ancestor.kind === "section" || ancestor.kind === "block")
        .map((ancestor) => settingNodeId(ancestor.path, "block", third));
      direct = false;
    }
  } else {
    return { status: "unresolved" };
  }

  const targets = candidates.filter((id) => knownIds.has(id));

  if (targets.length > 0) return { status: "resolved", targets };

  const expected = candidates[0];
  return direct && expected !== undefined ? { status: "missing", expected } : { status: "unresolved" };
}
