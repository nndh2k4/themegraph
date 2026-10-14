import path from "node:path";

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
import { SqliteGraphStore } from "./infrastructure/sqlite/sqlite-graph.store.js";
import type { GraphNode, ThemeGraph } from "./models/index.js";

/**
 * API dạng hàm của bản cũ, giữ TẠM trong lúc các lớp vỏ chuyển sang module
 * và controller. Mỗi hàm chỉ chuyển lời gọi sang class tương ứng.
 * File này bị xoá khi không còn ai dùng.
 */

export const legacyStore = new SqliteGraphStore();

export interface SaveGraphOptions {
  /** Thời điểm ghi vào bảng meta. Mặc định là lúc gọi hàm; test truyền giá trị cố định. */
  analyzedAt?: Date;
}

/** Mở đồ thị của một theme để đọc. Xem SqliteGraphStore.open(). */
export function openGraph(themeRoot: string): GraphRepository {
  return legacyStore.open(themeRoot);
}

/** Ghi đồ thị của một theme. Xem SqliteGraphStore.save(). */
export function saveGraph(themeRoot: string, graph: ThemeGraph, options: SaveGraphOptions = {}): void {
  legacyStore.save(themeRoot, graph, options.analyzedAt ?? new Date());
}

/**
 * Tìm thư mục theme chứa `startDir`: đi từ `startDir` ngược lên thư mục cha
 * cho tới khi gặp thư mục có .themegraph/graph.db, giống cách git tìm .git.
 *
 * Nhờ vậy người dùng đứng ở bất cứ đâu bên trong theme (ví dụ trong
 * sections/) vẫn gọi được lệnh truy vấn. Trả null nếu không tìm thấy.
 */
export function findThemeRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);

  for (;;) {
    if (legacyStore.hasGraph(dir)) return dir;

    // Ở gốc ổ đĩa, thư mục cha của một thư mục là chính nó: hết đường đi lên.
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---- Truy vấn dạng hàm: mỗi hàm mở một GraphScope trên đồ thị đã mở ----

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
