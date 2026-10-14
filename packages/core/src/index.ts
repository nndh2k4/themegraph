export { VERSION } from './common/version.js';

export * from './models/index.js';

// Tầng quét: thư mục theme -> danh sách file đã phân loại.
export { scanThemeDir } from './infrastructure/fs/fs-theme-file.repository.js';

// Tầng parse: một file + nội dung -> danh sách quan hệ thô.
export { extractFile, extractRefs } from './analyze/parsers/theme-file.parser.js';
export { extractJsonRefs } from './analyze/parsers/json-template.parser.js';
export { extractLiquid, extractLiquidRefs } from './analyze/parsers/liquid.parser.js';
export { collectTranslationKeys, isDefaultLocale } from './analyze/parsers/default-locale.parser.js';
export { collectGlobalSettings, isGlobalSettingsSchema, SETTING_PREFIX, settingNodeId } from './analyze/parsers/global-settings.parser.js';
export type { SettingObject } from './analyze/parsers/global-settings.parser.js';

// Resolver: quan hệ thô -> file thật trong theme.
export { resolveRef, TRANSLATION_PREFIX } from './analyze/ref-resolver.js';
export { resolveSettingRef } from './analyze/setting-resolver.js';
export type { Ancestor, SettingResolution } from './analyze/setting-resolver.js';

// Đồ thị: danh sách file + quan hệ thô -> node và cạnh.
export { buildGraph } from './analyze/graph-builder.js';

// Lưu trữ: đồ thị -> <theme>/.themegraph/graph.db.
export { graphDbPath, SCHEMA_VERSION } from './infrastructure/sqlite/schema.js';
export { SqliteGraphStore } from './infrastructure/sqlite/sqlite-graph.store.js';
export type { GraphStore, RemovedData } from './graph/graph.store.js';

// Lỗi mà lớp vỏ cần phân biệt.
export { GraphNotReadyError, NodeNotFoundError, ThemeGraphError } from './common/errors.js';
export type { GraphNotReadyReason } from './common/errors.js';

// API dạng hàm cũ, giữ tạm cho các lớp vỏ.
export {
  context,
  deadCode,
  exportGraph,
  findNode,
  findThemeRoot,
  impact,
  openGraph,
  overview,
  renderFlow,
  saveGraph,
  search,
  verify,
} from './legacy.js';
export type { SaveGraphOptions } from './legacy.js';

// Điểm nối của lõi: thư mục theme -> graph.db + thống kê.
export { analyze } from './analyze/analyze.service.js';
export type { AnalyzeError, AnalyzeResult, AnalyzeStats } from './analyze/analyze.service.js';

// Module graph: cổng đọc đồ thị, các service truy vấn và kết quả của chúng.
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
export type * from './graph/dto/index.js';
export { GraphModule } from './graph/graph.module.js';
export { GraphScope, GraphScopeFactory } from './graph/graph-scope.js';
export { NodeFinder } from './graph/node-finder.service.js';
export { DEFAULT_SEARCH_LIMIT, SearchService } from './graph/search.service.js';
export { ImpactService } from './graph/impact.service.js';
export { RenderFlowService } from './graph/render-flow.service.js';
export { ContextService } from './graph/context.service.js';
export { DeadCodeService } from './graph/dead-code.service.js';
export { OverviewService } from './graph/overview.service.js';
export { EXPORT_GROUPS, ExportGraphService } from './graph/export-graph.service.js';
export { VerifyService } from './graph/verify.service.js';
export { bfsTraverse, diffTraversals } from './graph/graph-algorithms.js';
export { extractElements } from './analyze/parsers/custom-elements.parser.js';

// Sổ đăng ký toàn cục: những theme nào đã được phân tích, nằm ở đâu.
export { findRegisteredTheme, listThemes, readRegistry, registerTheme, registryDir, registryPath, unregisterTheme } from './infrastructure/registry/json-theme-registry.repository.js';
export type { ListedTheme, RegistryEntry } from './infrastructure/registry/json-theme-registry.repository.js';

// Chọn theme để truy vấn khi người gọi không đứng trong một terminal (MCP).
export { selectTheme, ThemeSelectionError } from './theme/select-theme.js';
export type { ThemeSelectionReason } from './theme/select-theme.js';

// Tình trạng của đồ thị so với đĩa, và việc xoá dữ liệu đã ghi.
export { themeStatus } from './theme/status.js';
export type { StatusResult } from './theme/status.js';
export { cleanAllThemes, cleanTheme } from './theme/clean.js';
export type { CleanResult } from './theme/clean.js';

// Hash nội dung file, dùng chung cho analyze và status.
export { hashContent } from './common/hash.js';
