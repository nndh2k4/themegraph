import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { graphDbPath } from "./store.js";

/**
 * Phiên bản của định dạng registry.json. Tăng khi đổi cấu trúc file; file có
 * phiên bản khác được coi như registry rỗng và sẽ được ghi lại ở lần analyze sau.
 */
const REGISTRY_VERSION = 1;

/** Một theme đã được phân tích, như ghi trong sổ đăng ký. */
export interface RegistryEntry {
  path: string; // đường dẫn tuyệt đối của thư mục theme
  name: string; // tên thư mục theme, để hiển thị
  analyzedAt: string; // thời điểm phân tích gần nhất, dạng ISO 8601
  nodes: number;
  edges: number;
}

/** Một mục của sổ đăng ký kèm tình trạng hiện tại trên đĩa. */
export interface ListedTheme extends RegistryEntry {
  // false khi graph.db của theme không còn: theme đã bị xoá, đổi chỗ, hoặc
  // thư mục .themegraph bị xoá tay mà không qua lệnh clean.
  present: boolean;
}

/**
 * Thư mục chứa dữ liệu toàn cục của ThemeGraph: mặc định là ~/.themegraph.
 *
 * Biến môi trường THEMEGRAPH_HOME đổi được vị trí này. Bộ test dùng nó để
 * không bao giờ ghi vào thư mục home thật của người chạy test.
 */
export function registryDir(): string {
  const override = process.env.THEMEGRAPH_HOME;
  return override !== undefined && override !== "" ? path.resolve(override) : path.join(os.homedir(), ".themegraph");
}

/** Đường dẫn của sổ đăng ký toàn cục. */
export function registryPath(): string {
  return path.join(registryDir(), "registry.json");
}

/**
 * Dạng dùng để SO SÁNH hai đường dẫn theme. Trên Windows, C:\Themes\Dawn và
 * c:\themes\dawn là cùng một thư mục, nên so ở dạng chữ thường; trên các hệ
 * khác thì phân biệt hoa thường như hệ thống file.
 */
function pathKey(themeRoot: string): string {
  const resolved = path.resolve(themeRoot);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Kiểm tra một giá trị đọc từ file có đúng hình dạng của một mục hay không. */
function isEntry(value: unknown): value is RegistryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;

  return (
    typeof entry.path === "string" &&
    typeof entry.name === "string" &&
    typeof entry.analyzedAt === "string" &&
    typeof entry.nodes === "number" &&
    typeof entry.edges === "number"
  );
}

/** Xếp theo tên rồi theo đường dẫn, để danh sách không phụ thuộc thứ tự analyze. */
function sortEntries(entries: RegistryEntry[]): RegistryEntry[] {
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return entries.sort((a, b) => compare(a.name, b.name) || compare(a.path, b.path));
}

/**
 * Đọc sổ đăng ký. Không bao giờ ném lỗi: file chưa có, file hỏng, hoặc file
 * của một phiên bản định dạng khác đều cho ra danh sách rỗng. Sổ đăng ký chỉ
 * là chỉ mục dựng lại được bằng cách analyze, nên một file hỏng không đáng
 * để làm hỏng lệnh đang chạy.
 */
export function readRegistry(): RegistryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(registryPath(), "utf8"));
  } catch {
    return [];
  }

  if (typeof data !== "object" || data === null) return [];
  const { version, themes } = data as { version?: unknown; themes?: unknown };

  if (version !== REGISTRY_VERSION || !Array.isArray(themes)) return [];

  // Bỏ qua từng mục sai hình dạng thay vì bỏ cả file.
  return sortEntries(themes.filter(isEntry));
}

/**
 * Ghi sổ đăng ký. Ghi vào file tạm rồi đổi tên, để registry.json luôn là một
 * file JSON hoàn chỉnh dù tiến trình bị ngắt giữa chừng.
 */
function writeRegistry(entries: RegistryEntry[]): void {
  const file = registryPath();
  const temp = `${file}.tmp`;

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(temp, `${JSON.stringify({ version: REGISTRY_VERSION, themes: sortEntries(entries) }, null, 2)}\n`);
  renameSync(temp, file);
}

/**
 * Ghi một theme vào sổ đăng ký. Theme đã có (cùng đường dẫn) thì mục cũ được
 * thay bằng mục mới, không thêm mục trùng.
 */
export function registerTheme(entry: RegistryEntry): void {
  const key = pathKey(entry.path);
  const others = readRegistry().filter((existing) => pathKey(existing.path) !== key);

  writeRegistry([...others, entry]);
}

/**
 * Gỡ một theme khỏi sổ đăng ký. Trả true nếu có mục bị gỡ. Không tạo file
 * registry.json khi theme vốn không có trong sổ.
 */
export function unregisterTheme(themeRoot: string): boolean {
  const key = pathKey(themeRoot);
  const entries = readRegistry();
  const kept = entries.filter((existing) => pathKey(existing.path) !== key);

  if (kept.length === entries.length) return false;

  writeRegistry(kept);
  return true;
}

/**
 * Tìm theme trong sổ đăng ký chứa `startDir`: chính thư mục đó hoặc một thư
 * mục cha của nó. Trả về đường dẫn như ghi trong sổ, hoặc null.
 *
 * Dùng khi graph.db của theme đã mất nên findThemeRoot() không còn gì để bám
 * vào, nhưng mục trong sổ vẫn còn: lệnh clean cần biết để gỡ mục đó.
 */
export function findRegisteredTheme(startDir: string): string | null {
  const byKey = new Map(readRegistry().map((entry) => [pathKey(entry.path), entry.path]));

  let dir = path.resolve(startDir);
  for (;;) {
    const found = byKey.get(pathKey(dir));
    if (found !== undefined) return found;

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Mọi theme trong sổ đăng ký, kèm việc graph.db của nó có còn trên đĩa hay không. */
export function listThemes(): ListedTheme[] {
  return readRegistry().map((entry) => ({ ...entry, present: existsSync(graphDbPath(entry.path)) }));
}
