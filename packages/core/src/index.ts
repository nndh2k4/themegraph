export { VERSION } from './version.js';

export * from './types.js';

// Tầng quét: thư mục theme -> danh sách file đã phân loại.
export { scanThemeDir } from './scanner.js';

// Tầng parse: một file + nội dung -> danh sách quan hệ thô.
export { extractFile, extractRefs } from './extract.js';
export { extractJsonRefs } from './extract-json.js';
export { extractLiquid, extractLiquidRefs } from './extract-liquid.js';
export { collectTranslationKeys, isDefaultLocale } from './extract-locale.js';
export { collectGlobalSettings, isGlobalSettingsSchema, SETTING_PREFIX, settingNodeId } from './extract-settings.js';
export type { SettingObject } from './extract-settings.js';

// Resolver: quan hệ thô -> file thật trong theme.
export { resolveRef, TRANSLATION_PREFIX } from './resolver.js';
export { resolveSettingRef } from './resolve-setting.js';
export type { Ancestor, SettingResolution } from './resolve-setting.js';

// Đồ thị: danh sách file + quan hệ thô -> node và cạnh.
export { buildGraph } from './graph.js';

// Lưu trữ: đồ thị -> <theme>/.themegraph/graph.db.
export { graphDbPath, saveGraph, SCHEMA_VERSION } from './store.js';
export type { SaveGraphOptions } from './store.js';

// Điểm nối của lõi: thư mục theme -> graph.db + thống kê.
export { analyze } from './analyze.js';
export type { AnalyzeError, AnalyzeResult, AnalyzeStats } from './analyze.js';

// Đọc đồ thị: mở graph.db của một theme và tìm node theo tên người dùng gõ.
export { findThemeRoot, GraphNotReadyError, openGraph } from './open.js';
export type { GraphHandle, GraphMeta, GraphNotReadyReason } from './open.js';
export { findNode, NodeNotFoundError } from './find-node.js';
export type { FindNodeOptions } from './find-node.js';

// Duyệt đồ thị bằng truy vấn đệ quy; nền của impact và renderFlow.
export { traverse } from './traverse.js';
export type { Direction, Reached, TraverseOptions } from './traverse.js';

// Truy vấn: sửa file này thì những gì bị ảnh hưởng.
export { impact } from './impact.js';
export type { ImpactPage, ImpactResult } from './impact.js';

// Truy vấn: trang này render những file nào.
export { renderFlow } from './render-flow.js';
export type { FlowNode, RenderFlowOptions, RenderFlowResult } from './render-flow.js';

// Truy vấn: trong theme có node nào tên như thế này.
export { DEFAULT_SEARCH_LIMIT, search } from './search.js';
export type { SearchHit, SearchMatch, SearchOptions, SearchResult } from './search.js';

// Truy vấn: file này là gì, ai gọi nó, nó gọi ai.
export { context } from './context.js';
export type { BrokenRef, ContextLink, ContextResult } from './context.js';

// Truy vấn: file nào không còn được dùng.
export { deadCode } from './dead-code.js';
export type {
  DeadCodeResult,
  DeadConfidence,
  DeadFile,
  DeadReason,
  NeededElement,
  NotLoadedAsset,
} from './dead-code.js';
export { extractElements } from './extract-elements.js';

// Tổng quan của cả theme, và xuất đồ thị cho giao diện vẽ.
export { overview } from './overview.js';
export type { OverviewResult, UsageCount } from './overview.js';
export { EXPORT_GROUPS, exportGraph } from './export-graph.js';
export type { ExportedGraph, ExportGraphOptions, ExportGroup } from './export-graph.js';

// Kiểm chứng: đối chiếu truy vấn SQL với phép duyệt bằng JavaScript.
export { bfsTraverse, diffTraversals, verify } from './verify.js';
export type { PlainEdge, Reach, VerifyMismatch, VerifyResult } from './verify.js';

// Sổ đăng ký toàn cục: những theme nào đã được phân tích, nằm ở đâu.
export { findRegisteredTheme, listThemes, readRegistry, registerTheme, registryDir, registryPath, unregisterTheme } from './registry.js';
export type { ListedTheme, RegistryEntry } from './registry.js';

// Chọn theme để truy vấn khi người gọi không đứng trong một terminal (MCP).
export { selectTheme, ThemeSelectionError } from './select-theme.js';
export type { ThemeSelectionReason } from './select-theme.js';

// Tình trạng của đồ thị so với đĩa, và việc xoá dữ liệu đã ghi.
export { themeStatus } from './status.js';
export type { StatusResult } from './status.js';
export { cleanAllThemes, cleanTheme } from './clean.js';
export type { CleanResult } from './clean.js';

// Trình bày kết quả thành các dòng chữ; CLI và MCP server dùng chung.
export {
  formatAnalyze,
  formatClean,
  formatContext,
  formatDeadCode,
  formatImpact,
  formatList,
  formatOverview,
  formatRenderFlow,
  formatSearch,
  formatStatus,
  formatThemeNote,
  formatVerify,
} from './format.js';
export type { FormatOptions } from './format.js';

// Hash nội dung file, dùng chung cho analyze và status.
export { hashContent } from './hash.js';
