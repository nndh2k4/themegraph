import { existsSync } from "node:fs";
import path from "node:path";

import { findThemeRoot } from "./open.js";
import { findRegisteredTheme, listThemes } from "./registry.js";
import type { ListedTheme } from "./registry.js";

/** Vì sao không chọn được theme. */
export type ThemeSelectionReason =
  | "none_registered" // sổ đăng ký trống
  | "ambiguous" // có nhiều theme mà không biết lấy cái nào
  | "unknown"; // tên hoặc đường dẫn được nêu không ứng với theme nào

/**
 * Lỗi ném ra khi không xác định được theme để truy vấn. `themes` là các theme
 * đang có trong sổ đăng ký, để người (hoặc agent) gọi chọn lại.
 */
export class ThemeSelectionError extends Error {
  readonly reason: ThemeSelectionReason;
  readonly themes: ListedTheme[];

  constructor(reason: ThemeSelectionReason, message: string, themes: ListedTheme[]) {
    super(message);
    this.name = "ThemeSelectionError";
    this.reason = reason;
    this.themes = themes;
  }
}

/** Dạng dùng để so sánh hai đường dẫn; Windows không phân biệt hoa thường. */
function pathKey(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** "dawn (C:\themes\dawn), purity (D:\...)" để ghép vào thông báo lỗi. */
function describe(themes: readonly ListedTheme[]): string {
  return themes.map((theme) => `${theme.name} (${theme.path})`).join(", ");
}

/**
 * Chọn theme để truy vấn khi người gọi KHÔNG đứng trong một cửa sổ dòng lệnh,
 * tức khi "thư mục đang đứng" chưa chắc nói lên điều gì. MCP server dùng hàm
 * này: agent có thể nêu tên theme, hoặc không nêu gì.
 *
 * Thử lần lượt, lấy cách đầu tiên ra kết quả:
 *
 *   Có `requested` (tên hoặc đường dẫn):
 *     1. đường dẫn của một theme trong sổ đăng ký
 *     2. tên của đúng một theme trong sổ (không phân biệt hoa thường)
 *     3. một thư mục có .themegraph/graph.db, dù chưa có trong sổ
 *
 *   Không có `requested`:
 *     4. theme chứa `cwd` (tìm ngược lên thư mục cha), theo graph.db trên đĩa
 *        rồi theo sổ đăng ký
 *     5. theme duy nhất trong sổ đăng ký
 *
 * Trả về đường dẫn tuyệt đối của thư mục theme. Hàm không mở graph.db: theme
 * đã chọn mà chưa phân tích được thì openGraph() sẽ báo, kèm cách chữa.
 *
 * Ném ThemeSelectionError nếu không cách nào ra kết quả.
 */
export function selectTheme(requested: string | undefined, cwd: string): string {
  const themes = listThemes();

  if (requested !== undefined && requested.trim() !== "") {
    const wanted = requested.trim();

    // 1. Đường dẫn có trong sổ. Đường dẫn tương đối được tính từ cwd.
    const asPath = path.resolve(cwd, wanted);
    const byPath = themes.find((theme) => pathKey(theme.path) === pathKey(asPath));
    if (byPath !== undefined) return byPath.path;

    // 2. Tên theme. Hai theme ở hai nơi có thể trùng tên thư mục; khi đó tên
    // không đủ để chọn và người gọi phải đưa đường dẫn.
    const byName = themes.filter((theme) => theme.name.toLowerCase() === wanted.toLowerCase());
    if (byName.length === 1 && byName[0] !== undefined) return byName[0].path;
    if (byName.length > 1) {
      throw new ThemeSelectionError(
        "ambiguous",
        `Có ${byName.length} theme cùng tên "${wanted}": ${describe(byName)}. Hãy nêu đường dẫn thay cho tên.`,
        themes,
      );
    }

    // 3. Thư mục đã phân tích nhưng không có trong sổ (ví dụ sổ bị xoá).
    if (existsSync(path.join(asPath, ".themegraph", "graph.db"))) return asPath;

    throw new ThemeSelectionError(
      "unknown",
      themes.length === 0
        ? `Không có theme "${wanted}", và chưa theme nào được phân tích. Chạy "themegraph analyze" trong thư mục theme.`
        : `Không có theme "${wanted}". Các theme đã phân tích: ${describe(themes)}.`,
      themes,
    );
  }

  // 4. Theme chứa thư mục đang đứng.
  const here = findThemeRoot(cwd) ?? findRegisteredTheme(cwd);
  if (here !== null) return here;

  // 5. Chỉ có một theme thì không có gì để nhầm.
  if (themes.length === 1 && themes[0] !== undefined) return themes[0].path;

  if (themes.length === 0) {
    throw new ThemeSelectionError(
      "none_registered",
      'Chưa theme nào được phân tích. Chạy "themegraph analyze" trong thư mục theme rồi gọi lại.',
      themes,
    );
  }

  throw new ThemeSelectionError(
    "ambiguous",
    `Thư mục ${cwd} không nằm trong theme nào, và có ${themes.length} theme đã phân tích: ${describe(themes)}. Hãy nêu theme cần hỏi.`,
    themes,
  );
}
