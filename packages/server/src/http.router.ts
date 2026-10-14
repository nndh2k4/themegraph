import { fail } from "./api.types.js";
import type { ApiRequest, ApiResponse } from "./api.types.js";
import type { ThemesController } from "./controllers/themes.controller.js";
import type { HttpExceptionFilter } from "./http.exception-filter.js";
import { QueryParams } from "./pipes/query-params.pipe.js";

/** Một route dưới /api/themes/:id/. */
type ThemeRoute = (controller: ThemesController, id: string, query: QueryParams) => unknown;

/**
 * Bảng route dưới /api/themes/:id/ (giống @Get(':id/search') của NestJS).
 * Mỗi route gọi đúng một method của controller.
 */
const THEME_ROUTES: Record<string, ThemeRoute> = {
  overview: (controller, id) => controller.overview(id),
  search: (controller, id, query) => controller.search(id, query),
  file: (controller, id, query) => controller.file(id, query),
  flow: (controller, id, query) => controller.flow(id, query),
  "dead-code": (controller, id) => controller.deadCode(id),
  graph: (controller, id, query) => controller.graph(id, query),
};

/**
 * Router của API: chọn method của controller theo đường dẫn, và cho mọi lỗi đi
 * qua exception filter. API chỉ đọc nên chỉ nhận GET (và HEAD).
 */
export class HttpRouter {
  constructor(
    private readonly themes: ThemesController,
    private readonly filter: HttpExceptionFilter,
  ) {}

  async handle(request: ApiRequest): Promise<ApiResponse> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return fail(405, { code: "method_not_allowed", message: "API của ThemeGraph chỉ nhận GET." });
    }

    const segments = request.path.split("/").filter((segment) => segment !== "");
    const notFound = fail(404, { code: "not_found", message: `Không có đường dẫn ${request.path}.` });

    if (segments[0] !== "api" || segments[1] !== "themes") return notFound;

    try {
      if (segments.length === 2) return { status: 200, body: this.themes.list() };

      const [, , id, route] = segments;
      const handler = route === undefined ? undefined : THEME_ROUTES[route];
      if (id === undefined || handler === undefined || segments.length !== 4) return notFound;

      return { status: 200, body: await handler(this.themes, id, new QueryParams(request.query)) };
    } catch (error) {
      return this.filter.catch(error);
    }
  }
}
