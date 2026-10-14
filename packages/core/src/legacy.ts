import { CoreModule } from "./core.module.js";
import type { AnalyzeResult } from "./analyze/dto/analyze-result.dto.js";
import type {
  ContextResult,
  DeadCodeResult,
  ExportedGraph,
  ExportGraphOptions,
  FindNodeOptions,
  ImpactResult,
  OverviewResult,
  RenderFlowOptions,
  RenderFlowResult,
  SearchOptions,
  SearchResult,
  VerifyResult,
} from "./graph/dto/index.js";
import { GraphScope } from "./graph/graph-scope.js";
import type { GraphRepository } from "./graph/graph.repository.js";
import { defaultRegistryDir, JsonThemeRegistryRepository } from "./infrastructure/registry/json-theme-registry.repository.js";
import { SqliteGraphStore } from "./infrastructure/sqlite/sqlite-graph.store.js";
import type { GraphNode, ListedTheme, RegistryEntry, ThemeGraph } from "./models/index.js";
import type { CleanResult, StatusResult } from "./theme/dto/theme.dto.js";

/**
 * API dạng hàm của bản cũ, giữ TẠM trong lúc các lớp vỏ chuyển sang module
 * và controller. Mỗi hàm chỉ chuyển lời gọi sang class tương ứng, tạo module
 * mới ở mỗi lần gọi để luôn đọc đúng THEMEGRAPH_HOME hiện tại.
 * File này bị xoá khi không còn ai dùng.
 */

const core = (): CoreModule => new CoreModule();
const registry = (): JsonThemeRegistryRepository => new JsonThemeRegistryRepository(defaultRegistryDir());

export interface SaveGraphOptions {
  /** Thời điểm ghi vào bảng meta. Mặc định là lúc gọi hàm; test truyền giá trị cố định. */
  analyzedAt?: Date;
}

export const openGraph = (themeRoot: string): GraphRepository => new SqliteGraphStore().open(themeRoot);
export const saveGraph = (themeRoot: string, graph: ThemeGraph, options: SaveGraphOptions = {}): void =>
  new SqliteGraphStore().save(themeRoot, graph, options.analyzedAt ?? new Date());

// ---- Theme ----------------------------------------------------------------

export const analyze = (themeRoot: string): Promise<AnalyzeResult> => core().analyzer.analyze(themeRoot);
export const listThemes = (): ListedTheme[] => core().themes.list();
export const findThemeRoot = (startDir: string): string | null => core().themes.locate(startDir);
export const findRegisteredTheme = (startDir: string): string | null => core().themes.findRegistered(startDir);
export const selectTheme = (requested: string | undefined, cwd: string): string => core().themes.select(requested, cwd);
export const themeStatus = (themeRoot: string): Promise<StatusResult> => core().themes.status(themeRoot);
export const cleanTheme = (themeRoot: string): CleanResult => core().themes.clean(themeRoot);
export const cleanAllThemes = (): CleanResult[] => core().themes.cleanAll();
export const registryPath = (): string => registry().location;
export const readRegistry = (): RegistryEntry[] => registry().list();
export const unregisterTheme = (themeRoot: string): boolean => registry().unregister(themeRoot);

// ---- Truy vấn: mỗi hàm mở một GraphScope trên đồ thị đã mở ----------------

export const findNode = (graph: GraphRepository, input: string, options?: FindNodeOptions): GraphNode =>
  new GraphScope(graph).nodes.find(input, options);
export const search = (graph: GraphRepository, query: string, options?: SearchOptions): SearchResult =>
  new GraphScope(graph).search.search(query, options);
export const impact = (graph: GraphRepository, name: string, options?: FindNodeOptions): ImpactResult =>
  new GraphScope(graph).impact.findImpact(name, options);
export const renderFlow = (graph: GraphRepository, name: string, options?: RenderFlowOptions): RenderFlowResult =>
  new GraphScope(graph).renderFlow.buildFlow(name, options);
export const context = (graph: GraphRepository, name: string, options?: FindNodeOptions): ContextResult =>
  new GraphScope(graph).context.describe(name, options);
export const deadCode = (graph: GraphRepository): DeadCodeResult => new GraphScope(graph).deadCode.findUnused();
export const overview = (graph: GraphRepository): OverviewResult => new GraphScope(graph).overview.summarize();
export const exportGraph = (graph: GraphRepository, options?: ExportGraphOptions): ExportedGraph =>
  new GraphScope(graph).exportGraph.export(options);
export const verify = (graph: GraphRepository): VerifyResult => new GraphScope(graph).verify.verify();
