import { EXPORT_GROUPS, GraphNotReadyError, NODE_KINDS } from "@themegraph/core";
import type {
  ContextResult,
  DeadCodeResult,
  ExportedGraph,
  ExportGroup,
  GraphScope,
  GraphScopeFactory,
  ImpactResult,
  NodeKind,
  OverviewResult,
  RenderFlowResult,
  SearchResult,
  StatusResult,
  ThemeService,
} from "@themegraph/core";

import type { ApiTheme } from "../api.types.js";
import { ThemeNotFoundError } from "../http.errors.js";
import type { QueryParams } from "../pipes/query-params.pipe.js";
import { themeId } from "../theme-id.js";

/**
 * Controller của /api/themes. Mỗi method một route; bảng route nằm ở
 * HttpRouter. Mỗi route đọc tham số, gọi một hoặc hai service của lõi, và trả
 * nguyên kết quả. Nó không đọc file theme, không viết SQL, và không ghi gì cả.
 */
export class ThemesController {
  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
  ) {}

  /** GET /api/themes */
  list(): ApiTheme[] {
    return this.themes.list().map((theme) => ({
      id: themeId(theme.path),
      ...theme,
      problem: this.problemOf(theme.path),
    }));
  }

  /**
   * GET /api/themes/:id/overview — tổng quan kèm tình trạng đồ thị. Đây là
   * route duy nhất so hash file với đĩa, vì phép so đó tốn hàng trăm mili giây
   * trên theme lớn.
   */
  async overview(id: string): Promise<{ overview: OverviewResult; status: StatusResult }> {
    const summary = this.withTheme(id, (scope) => scope.overview.summarize());
    return { overview: summary, status: await this.themes.status(summary.themeRoot) };
  }

  /** GET /api/themes/:id/search?q=&kind=&limit= */
  search(id: string, query: QueryParams): SearchResult {
    const kinds = query.optionalList<NodeKind>("kind", NODE_KINDS);
    const limit = query.optionalInt("limit", 0);

    return this.withTheme(id, (scope) =>
      scope.search.search(query.get("q") ?? "", { kinds, ...(limit === undefined ? {} : { limit }) }),
    );
  }

  /**
   * GET /api/themes/:id/file?path= — mọi thứ về một file: quan hệ trực tiếp
   * (context) và phạm vi ảnh hưởng (impact). Đường dẫn file đi trong tham số vì
   * nó chứa dấu gạch chéo.
   */
  file(id: string, query: QueryParams): { context: ContextResult; impact: ImpactResult } {
    const target = query.required("path");
    return this.withTheme(id, (scope) => ({ context: scope.context.describe(target), impact: scope.impact.findImpact(target) }));
  }

  /** GET /api/themes/:id/flow?page=&depth= */
  flow(id: string, query: QueryParams): RenderFlowResult {
    const page = query.required("page");
    const maxDepth = query.optionalInt("depth", 1);

    return this.withTheme(id, (scope) => scope.renderFlow.buildFlow(page, maxDepth === undefined ? {} : { maxDepth }));
  }

  /** GET /api/themes/:id/dead-code */
  deadCode(id: string): DeadCodeResult {
    return this.withTheme(id, (scope) => scope.deadCode.findUnused());
  }

  /** GET /api/themes/:id/graph?include= */
  graph(id: string, query: QueryParams): ExportedGraph {
    const include = query.optionalList<ExportGroup>("include", EXPORT_GROUPS);
    return this.withTheme(id, (scope) => scope.exportGraph.export({ include }));
  }

  /** Mở đồ thị của theme có mã `id`, chạy `body`, rồi luôn đóng lại. */
  private withTheme<T>(id: string, body: (scope: GraphScope) => T): T {
    const theme = this.themes.list().find((entry) => themeId(entry.path) === id);
    if (theme === undefined) throw new ThemeNotFoundError(`Không có theme nào mang mã "${id}".`);

    return this.graphs.use(theme.path, body);
  }

  /** Thử mở đồ thị của một theme; trả thông báo lỗi nếu không mở được. */
  private problemOf(themePath: string): string | null {
    try {
      // Mở chỉ đọc bảng meta (vài chục byte), nên làm cho mọi theme cũng nhanh.
      this.graphs.use(themePath, () => undefined);
      return null;
    } catch (error) {
      if (error instanceof GraphNotReadyError) return error.message;
      throw error;
    }
  }
}
