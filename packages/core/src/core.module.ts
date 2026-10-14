import { AnalyzeModule } from "./analyze/analyze.module.js";
import type { AnalyzeService } from "./analyze/analyze.service.js";
import { GraphModule } from "./graph/graph.module.js";
import type { GraphScopeFactory } from "./graph/graph-scope.js";
import { FsThemeFileRepository } from "./infrastructure/fs/fs-theme-file.repository.js";
import { defaultRegistryDir, JsonThemeRegistryRepository } from "./infrastructure/registry/json-theme-registry.repository.js";
import { SqliteGraphStore } from "./infrastructure/sqlite/sqlite-graph.store.js";
import { ThemeModule } from "./theme/theme.module.js";
import type { ThemeService } from "./theme/theme.service.js";

export interface CoreModuleOptions {
  /** Thư mục của sổ đăng ký toàn cục. Mặc định ~/.themegraph, hoặc THEMEGRAPH_HOME. */
  registryDir?: string;
}

/**
 * Module gốc của lõi (giống AppModule của NestJS): nơi DUY NHẤT nối các bản
 * hiện thực thật (SQLite, hệ thống file, file JSON) vào các service.
 *
 * Lớp vỏ (CLI, MCP, HTTP) tạo một CoreModule rồi dùng ba provider của nó:
 *   - analyzer: phân tích một theme và ghi đồ thị
 *   - themes:   danh sách theme, chọn theme, status, clean
 *   - graphs:   mở đồ thị của một theme thành các service truy vấn
 *
 * Tạo module trong hàm khởi động hoặc trong test, không ở top-level của một
 * file: thư mục của sổ đăng ký được đọc lúc tạo.
 */
export class CoreModule {
  readonly analyzer: AnalyzeService;
  readonly themes: ThemeService;
  readonly graphs: GraphScopeFactory;

  constructor(options: CoreModuleOptions = {}) {
    const store = new SqliteGraphStore();
    const files = new FsThemeFileRepository();
    const registry = new JsonThemeRegistryRepository(options.registryDir ?? defaultRegistryDir());

    const theme = new ThemeModule(registry, files, store);
    this.themes = theme.themes;
    this.analyzer = new AnalyzeModule(theme.scanner, files, store, registry).analyzer;
    this.graphs = new GraphModule(store).scopes;
  }
}
