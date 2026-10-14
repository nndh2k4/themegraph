// API công khai của @themegraph/core. Lớp vỏ chỉ được import từ đây.

export { VERSION } from './common/version.js';
export { hashContent } from './common/hash.js';
export {
  GraphNotReadyError,
  NodeNotFoundError,
  ThemeGraphError,
  ThemeSelectionError,
} from './common/errors.js';
export type { GraphNotReadyReason, ThemeSelectionReason } from './common/errors.js';

// Model: dữ liệu thuần mà mọi tầng dùng chung.
export * from './models/index.js';

// Module gốc: nơi nối các bản hiện thực thật vào service.
export { CoreModule } from './core.module.js';
export type { CoreModuleOptions } from './core.module.js';

// Module analyze: thư mục theme -> đồ thị đã ghi.
export { AnalyzeModule } from './analyze/analyze.module.js';
export { AnalyzeService } from './analyze/analyze.service.js';
export type { AnalyzeError, AnalyzeResult, AnalyzeStats } from './analyze/dto/analyze-result.dto.js';
export { GraphBuilder } from './analyze/graph-builder.js';
export { ThemeFileParser } from './analyze/parsers/theme-file.parser.js';
export type { FileParser } from './analyze/parsers/file-parser.js';
export { defaultParsers } from './analyze/parsers/index.js';

// Module theme: danh sách theme, chọn theme, status, clean.
export { ThemeModule } from './theme/theme.module.js';
export { ThemeService } from './theme/theme.service.js';
export { ThemeScanner } from './theme/theme-scanner.js';
export type { CleanResult, StatusResult } from './theme/dto/theme.dto.js';
export type { ThemeFileRepository } from './theme/theme-file.repository.js';
export type { ThemeRegistryRepository } from './theme/theme-registry.repository.js';

// Module graph: cổng đọc đồ thị, các service truy vấn và kết quả của chúng.
export { GraphModule } from './graph/graph.module.js';
export { GraphScope, GraphScopeFactory } from './graph/graph-scope.js';
export type {
  Direction,
  ElementPair,
  GraphCounts,
  GraphMeta,
  GraphRepository,
  IntegrityReport,
  NeighborEdge,
  Reached,
  ReferenceCount,
} from './graph/graph.repository.js';
export type { GraphStore, RemovedData } from './graph/graph.store.js';
export type * from './graph/dto/index.js';
export { NodeFinder } from './graph/node-finder.service.js';
export { DEFAULT_SEARCH_LIMIT, SearchService } from './graph/search.service.js';
export { ImpactService } from './graph/impact.service.js';
export { RenderFlowService } from './graph/render-flow.service.js';
export { ContextService } from './graph/context.service.js';
export { DeadCodeService } from './graph/dead-code.service.js';
export { OverviewService } from './graph/overview.service.js';
export { EXPORT_GROUPS, ExportGraphService } from './graph/export-graph.service.js';
export { VerifyService } from './graph/verify.service.js';

// Hạ tầng: các bản hiện thực thật của repository.
export { SqliteGraphStore } from './infrastructure/sqlite/sqlite-graph.store.js';
export { graphDbPath, SCHEMA_VERSION } from './infrastructure/sqlite/schema.js';
export { FsThemeFileRepository } from './infrastructure/fs/fs-theme-file.repository.js';
export { defaultRegistryDir, JsonThemeRegistryRepository } from './infrastructure/registry/json-theme-registry.repository.js';

// API dạng hàm cũ, giữ tạm cho các lớp vỏ.
export {
  analyze,
  cleanAllThemes,
  cleanTheme,
  context,
  deadCode,
  exportGraph,
  findNode,
  findRegisteredTheme,
  findThemeRoot,
  impact,
  listThemes,
  openGraph,
  overview,
  readRegistry,
  registryPath,
  renderFlow,
  saveGraph,
  search,
  selectTheme,
  themeStatus,
  unregisterTheme,
  verify,
} from './legacy.js';
export type { SaveGraphOptions } from './legacy.js';
