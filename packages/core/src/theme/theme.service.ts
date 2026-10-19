import path from "node:path";

import { hashContent } from "../common/hash.js";
import { ThemeSelectionError } from "../common/errors.js";
import { pathKey } from "../common/paths.js";
import type { GraphStore } from "../graph/graph.store.js";
import type { ListedTheme, NodeKind } from "../models/index.js";
import type { CleanResult, StatusResult } from "./dto/theme.dto.js";
import { READ_EXTENSIONS } from "./theme-layout.js";
import type { ThemeFileRepository } from "./theme-file.repository.js";
import type { ThemeRegistryRepository } from "./theme-registry.repository.js";
import type { ThemeScanner } from "./theme-scanner.js";

/** Ba loại node không ứng với file nào trên đĩa. */
const NON_FILE_KINDS: readonly NodeKind[] = ["page_type", "translation_key", "setting"];

/** "dawn (C:\themes\dawn), purity (D:\...)" để ghép vào thông báo lỗi. */
function describe(themes: readonly ListedTheme[]): string {
  return themes.map((theme) => `${theme.name} (${theme.path})`).join(", ");
}

/** Đi từ `startDir` ngược lên thư mục cha, trả thư mục đầu tiên thoả `found`. */
function walkUp(startDir: string, found: (dir: string) => boolean): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (found(dir)) return dir;

    // Ở gốc ổ đĩa, thư mục cha của một thư mục là chính nó: hết đường đi lên.
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Quản lý các theme trên máy: theme nào đã phân tích, theme nào đang được hỏi,
 * đồ thị của nó còn khớp với đĩa không, và xoá dữ liệu đã ghi.
 */
export class ThemeService {
  constructor(
    private readonly registry: ThemeRegistryRepository,
    private readonly store: GraphStore,
    private readonly scanner: ThemeScanner,
    private readonly files: ThemeFileRepository,
  ) {}

  /** Nơi lưu sổ đăng ký, để báo cho người dùng khi không ghi được. */
  get registryLocation(): string {
    return this.registry.location;
  }

  /** Mọi theme trong sổ đăng ký, kèm việc đồ thị của nó có còn trên đĩa hay không. */
  list(): ListedTheme[] {
    return this.registry.list().map((entry) => ({ ...entry, present: this.store.hasGraph(entry.path) }));
  }

  /**
   * Tìm thư mục theme chứa `startDir`: đi từ `startDir` ngược lên thư mục cha
   * cho tới khi gặp thư mục có đồ thị, giống cách git tìm .git.
   *
   * Nhờ vậy người dùng đứng ở bất cứ đâu bên trong theme (ví dụ trong
   * sections/) vẫn gọi được lệnh truy vấn. Trả null nếu không tìm thấy.
   */
  locate(startDir: string): string | null {
    return walkUp(startDir, (dir) => this.store.hasGraph(dir));
  }

  /**
   * Tìm theme trong sổ đăng ký chứa `startDir`: chính thư mục đó hoặc một thư
   * mục cha của nó. Trả về đường dẫn như ghi trong sổ, hoặc null.
   *
   * Dùng khi đồ thị của theme đã mất nên locate() không còn gì để bám vào,
   * nhưng mục trong sổ vẫn còn: lệnh clean cần biết để gỡ mục đó.
   */
  findRegistered(startDir: string): string | null {
    const byKey = new Map(this.registry.list().map((entry) => [pathKey(entry.path), entry.path]));
    const dir = walkUp(startDir, (candidate) => byKey.has(pathKey(candidate)));
    return dir === null ? null : (byKey.get(pathKey(dir)) ?? null);
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
   *     3. một thư mục có đồ thị, dù chưa có trong sổ
   *
   *   Không có `requested`:
   *     4. theme chứa `cwd` (tìm ngược lên thư mục cha), theo đồ thị trên đĩa
   *        rồi theo sổ đăng ký
   *     5. theme duy nhất trong sổ đăng ký
   *
   * Trả về đường dẫn tuyệt đối của thư mục theme. Hàm không mở đồ thị: theme
   * đã chọn mà chưa phân tích được thì GraphStore.open() sẽ báo, kèm cách chữa.
   *
   * Ném ThemeSelectionError nếu không cách nào ra kết quả.
   */
  select(requested: string | undefined, cwd: string): string {
    const themes = this.list();

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
      if (this.store.hasGraph(asPath)) return asPath;

      throw new ThemeSelectionError(
        "unknown",
        themes.length === 0
          ? `Không có theme "${wanted}", và chưa theme nào được phân tích. Chạy "themegraph analyze" trong thư mục theme.`
          : `Không có theme "${wanted}". Các theme đã phân tích: ${describe(themes)}.`,
        themes,
      );
    }

    // 4. Theme chứa thư mục đang đứng.
    const here = this.locate(cwd) ?? this.findRegistered(cwd);
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

  /**
   * So đồ thị đã ghi của một theme với các file đang có trên đĩa.
   *
   * "Đã bị sửa" được xác định bằng NỘI DUNG: hash của file hiện có trên đĩa
   * được so với hash analyze đã ghi vào đồ thị. Thời điểm sửa của file không
   * được dùng tới, vì nó đổi cả khi nội dung không đổi (git checkout, trình
   * soạn thảo lưu lại file) và có thể không đổi khi nội dung đổi (file được
   * chép đè kèm thời điểm cũ).
   *
   * Chỉ những file analyze đọc nội dung (READ_EXTENSIONS: .liquid, .json, .js,
   * .mjs, .css) mới được xét là "đã sửa". Sửa một ảnh hay một font không làm
   * đồ thị đổi.
   *
   * Ném GraphNotReadyError nếu theme chưa có đồ thị dùng được.
   */
  async status(themeRoot: string): Promise<StatusResult> {
    const graph = this.store.open(themeRoot);

    let inGraph: Set<string>;
    let hashOf: Map<string, string>;
    let counts: { nodes: number; edges: number };
    try {
      inGraph = new Set(
        graph
          .allNodes()
          .filter((node) => !NON_FILE_KINDS.includes(node.kind))
          .map((node) => node.id),
      );
      hashOf = new Map(graph.fileHashes().map((entry) => [entry.file, entry.hash]));
      counts = {
        nodes: graph.countNodes(),
        edges: Object.values(graph.counts().edgesByType).reduce((total, n) => total + n, 0),
      };
    } finally {
      // Đóng trước khi làm việc với đĩa: không cần giữ đồ thị trong lúc đó.
      graph.close();
    }

    const { files } = await this.scanner.scan(graph.themeRoot);
    const onDisk = new Set(files.map((file) => file.path));

    const modified: string[] = [];
    for (const file of files) {
      if (!inGraph.has(file.path)) continue;
      if (!READ_EXTENSIONS.has(file.ext)) continue;

      // File không có hash là file lần phân tích không đọc được; không biết nội
      // dung cũ của nó nên coi là đã đổi.
      const content = await this.files.readFile(graph.themeRoot, file.path);
      if (hashOf.get(file.path) !== hashContent(content)) modified.push(file.path);
    }

    // Scanner đã xếp `files` theo tên, nên modified và added cũng đã xếp.
    const added = files.map((file) => file.path).filter((filePath) => !inGraph.has(filePath));
    const removed = [...inGraph].filter((filePath) => !onDisk.has(filePath)).sort();

    return {
      themeRoot: graph.themeRoot,
      dbPath: this.store.dbPath(graph.themeRoot),
      analyzedAt: graph.meta.analyzedAt,
      toolVersion: graph.meta.toolVersion,
      nodes: counts.nodes,
      edges: counts.edges,
      stale: modified.length + added.length + removed.length > 0,
      modified,
      added,
      removed,
    };
  }

  /**
   * Xoá mọi thứ ThemeGraph đã ghi cho một theme: dữ liệu đồ thị và mục của
   * theme trong sổ đăng ký toàn cục.
   *
   * Chạy lại trên một theme đã sạch thì không làm gì và không báo lỗi. Thứ bị
   * xoá chỉ là kết quả phân tích; chạy analyze là có lại.
   */
  clean(themeRoot: string): CleanResult {
    const root = path.resolve(themeRoot);
    const { removedFiles, removedDir } = this.store.remove(root);

    return { themeRoot: root, removedFiles, removedDir, unregistered: this.registry.unregister(root) };
  }

  /**
   * Xoá dữ liệu của MỌI theme trong sổ đăng ký. Theme đã bị xoá hoặc đổi chỗ
   * thì chỉ còn mục trong sổ để gỡ. Trả về kết quả của từng theme, theo thứ tự
   * của sổ đăng ký.
   */
  cleanAll(): CleanResult[] {
    return this.registry.list().map((entry) => this.clean(entry.path));
  }
}
