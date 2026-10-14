import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { pathKey } from "../../common/paths.js";
import type { RegistryEntry } from "../../models/index.js";
import type { ThemeRegistryRepository } from "../../theme/theme-registry.repository.js";

/**
 * Phiên bản của định dạng registry.json. Tăng khi đổi cấu trúc file; file có
 * phiên bản khác được coi như registry rỗng và sẽ được ghi lại ở lần analyze sau.
 */
const REGISTRY_VERSION = 1;

/** Chờ tối đa bấy nhiêu để lấy khoá, rồi bỏ cuộc và báo lỗi. */
const LOCK_WAIT_MS = 5_000;
/** Khoảng nghỉ giữa hai lần thử lấy khoá. */
const LOCK_RETRY_MS = 20;
/**
 * Khoá cũ hơn mức này được coi là của một tiến trình đã chết và bị gỡ. Một
 * lượt đọc-sửa-ghi sổ đăng ký chỉ mất vài mili giây, nên 10 giây là rất xa.
 */
const LOCK_STALE_MS = 10_000;

/**
 * Thư mục chứa dữ liệu toàn cục của ThemeGraph: mặc định là ~/.themegraph.
 *
 * Biến môi trường THEMEGRAPH_HOME đổi được vị trí này. Bộ test dùng nó để
 * không bao giờ ghi vào thư mục home thật của người chạy test.
 */
export function defaultRegistryDir(): string {
  const override = process.env.THEMEGRAPH_HOME;
  return override !== undefined && override !== "" ? path.resolve(override) : path.join(os.homedir(), ".themegraph");
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

/** Dừng tiến trình hiện tại một lúc mà không dùng hết CPU. */
function sleepSync(ms: number): void {
  // Atomics.wait chờ một ô nhớ đổi giá trị; ở đây không ai đổi nó, nên lệnh
  // chỉ đơn giản là ngủ cho tới khi hết thời gian.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Bản hiện thực ThemeRegistryRepository bằng một file JSON:
 * <thư mục>/registry.json, mặc định là ~/.themegraph/registry.json.
 */
export class JsonThemeRegistryRepository implements ThemeRegistryRepository {
  readonly location: string;
  private readonly lockPath: string;

  constructor(private readonly dir: string) {
    this.location = path.join(dir, "registry.json");
    this.lockPath = path.join(dir, "registry.lock");
  }

  /**
   * Không bao giờ ném lỗi: file chưa có, file hỏng, hoặc file của một phiên
   * bản định dạng khác đều cho ra danh sách rỗng. Sổ đăng ký chỉ là chỉ mục
   * dựng lại được bằng cách analyze, nên một file hỏng không đáng để làm hỏng
   * lệnh đang chạy.
   */
  list(): RegistryEntry[] {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(this.location, "utf8"));
    } catch {
      return [];
    }

    if (typeof data !== "object" || data === null) return [];
    const { version, themes } = data as { version?: unknown; themes?: unknown };

    if (version !== REGISTRY_VERSION || !Array.isArray(themes)) return [];

    // Bỏ qua từng mục sai hình dạng thay vì bỏ cả file.
    return sortEntries(themes.filter(isEntry));
  }

  register(entry: RegistryEntry): void {
    const key = pathKey(entry.path);

    this.withLock(() => {
      const others = this.list().filter((existing) => pathKey(existing.path) !== key);
      this.write([...others, entry]);
    });
  }

  /** Không tạo file registry.json khi theme vốn không có trong sổ. */
  unregister(themeRoot: string): boolean {
    // Chưa có sổ thì không có gì để gỡ, và cũng không tạo thư mục hay khoá.
    if (!existsSync(this.location)) return false;

    const key = pathKey(themeRoot);

    return this.withLock(() => {
      const entries = this.list();
      const kept = entries.filter((existing) => pathKey(existing.path) !== key);

      if (kept.length === entries.length) return false;

      this.write(kept);
      return true;
    });
  }

  /**
   * Ghi sổ đăng ký. Ghi vào file tạm rồi đổi tên, để registry.json luôn là một
   * file JSON hoàn chỉnh dù tiến trình bị ngắt giữa chừng.
   */
  private write(entries: RegistryEntry[]): void {
    const temp = `${this.location}.tmp`;

    writeFileSync(temp, `${JSON.stringify({ version: REGISTRY_VERSION, themes: sortEntries(entries) }, null, 2)}\n`);
    try {
      renameSync(temp, this.location);
    } catch (error) {
      // Không đổi tên được thì dọn file tạm, không để rác trong thư mục home.
      rmSync(temp, { force: true });
      throw error;
    }
  }

  /**
   * Chạy `body` trong khi giữ khoá của sổ đăng ký.
   *
   * Thêm hay gỡ một theme là một lượt ĐỌC rồi SỬA rồi GHI cả file. Hai lệnh
   * analyze chạy cùng lúc trên hai theme mà không có khoá thì cả hai cùng đọc
   * bản cũ, và lệnh ghi sau xoá mất mục của lệnh ghi trước.
   *
   * Khoá là một file registry.lock: tạo file với cờ "wx" chỉ thành công khi
   * file chưa tồn tại, và hệ điều hành bảo đảm chỉ một tiến trình thắng.
   */
  private withLock<T>(body: () => T): T {
    mkdirSync(this.dir, { recursive: true });

    const deadline = Date.now() + LOCK_WAIT_MS;

    for (;;) {
      try {
        closeSync(openSync(this.lockPath, "wx"));
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // EEXIST: tiến trình khác đang giữ khoá. EPERM: trên Windows, file khoá
        // đang trong lúc bị tiến trình kia xoá. Mọi lỗi khác là lỗi thật.
        if (code !== "EEXIST" && code !== "EPERM") throw error;

        let ageMs: number;
        try {
          ageMs = Date.now() - statSync(this.lockPath).mtimeMs;
        } catch {
          // Khoá vừa được nhả giữa hai lệnh: thử lại ngay.
          continue;
        }

        if (ageMs > LOCK_STALE_MS) {
          rmSync(this.lockPath, { force: true });
          continue;
        }

        if (Date.now() > deadline) {
          throw new Error(`Không lấy được khoá của sổ đăng ký sau ${LOCK_WAIT_MS} ms: ${this.lockPath}`, { cause: error });
        }
        sleepSync(LOCK_RETRY_MS);
      }
    }

    try {
      return body();
    } finally {
      rmSync(this.lockPath, { force: true });
    }
  }
}
