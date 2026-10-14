# Đề xuất kiến trúc viết lại ThemeGraph theo phong cách NestJS

Thư mục này là bản clone của `themegraph/`, nhánh `viet-lai-kien-truc`, tách từ commit `16e0ea0`.
Bản gốc `themegraph/` giữ nguyên để đối chiếu.

## 1. Mục tiêu

- **Dễ hiểu với người quen phát triển web:** cấu trúc Module – Controller – Service – Repository như NestJS.
  Nhìn hậu tố file (`.module.ts`, `.controller.ts`, `.service.ts`, `.repository.ts`) là biết file thuộc tầng nào.
- **Viết bằng class, phụ thuộc tiêm qua constructor.** Mọi chỗ nối phụ thuộc đều nằm trong các file `*.module.ts`.
- **Có quy tắc phụ thuộc, và máy kiểm tra quy tắc đó** (ESLint).
- **Giữ nguyên hành vi.** CLI, 6 tool MCP, API HTTP, web, lược đồ `graph.db` đều không đổi. Bộ test hiện có là thước đo.

## 2. Công nghệ: phong cách NestJS, không cài NestJS

**Không thêm thư viện runtime nào.** Chỉ dùng TypeScript thuần và các thư viện đang có:

| Thư viện | Dùng ở | Ghi chú |
|---|---|---|
| `node:sqlite`, `node:fs`, `node:http`, `node:util` (`parseArgs`) | core, server, cli | sẵn trong Node ≥ 22.13 |
| `@shopify/liquid-html-parser` | core (parser Liquid) | giữ nguyên |
| `@modelcontextprotocol/sdk`, `zod` | mcp | giữ nguyên; `zod` là "validation pipe" của tool |
| `react`, `sigma`, `graphology`, `lucide-react` | web | giữ nguyên |

Không cần sửa `tsconfig` (không bật `experimentalDecorators`, không cần `reflect-metadata`).

**Vì sao không dùng chính NestJS:**

1. **NestJS sinh ra cho server HTTP.** ThemeGraph có ba cửa vào, và hai cửa không phải HTTP: CLI (mỗi lệnh là một tiến trình ngắn) và MCP qua stdio.
   Muốn dùng Nest cho cả ba thì cần thêm "standalone application", `nest-commander` cho CLI và một module MCP của cộng đồng: ba thứ phải học thêm.
2. **Chi phí khởi động.** Mỗi lần gõ `themegraph impact …` và mỗi lần client mở MCP server đều phải nạp `@nestjs/core`, `reflect-metadata`, `rxjs` rồi quét module.
   Riêng với MCP stdio, logger mặc định của Nest in ra stdout, mà stdout chỉ được chứa JSON-RPC.
3. **DI của Nest dựa trên decorator metadata, và chỗ này vướng với dự án:**
   - Thiết kế dựa trên **interface** (`GraphRepository`…). Interface biến mất lúc chạy, nên Nest bắt khai token và `@Inject(TOKEN)` ở mọi chỗ.
   - Dự án bật `verbatimModuleSyntax` và luật ESLint `consistent-type-imports`. Import kiểu viết sai một chút là metadata rỗng và DI hỏng lúc chạy.
   - vitest biên dịch bằng esbuild/oxc chứ không bằng `tsc`. Hai bộ này mặc định không sinh decorator metadata, nên dự án Nest dùng vitest thường phải thêm plugin SWC.
4. **Dễ bảo vệ hơn khi báo cáo.** Tiêm phụ thuộc thủ công (Pure DI) để lộ toàn bộ đồ thị phụ thuộc trong vài file `*.module.ts`.
   Hội đồng hỏi "DI hoạt động thế nào" thì mở file ra là thấy, không có phần "phép thuật" của framework.

Thư viện DI nhỏ (`tsyringe`, `inversify`) cũng dựa trên decorator và `reflect-metadata`, nên vướng đúng điểm 3.
Với khoảng 40 class, nối tay chỉ mất vài chục dòng.

## 3. Khái niệm NestJS và cách làm tương ứng ở đây

| NestJS | ThemeGraph (TypeScript thuần) |
|---|---|
| `@Module({ providers, imports, exports })` | class `XxxModule`: constructor nhận phụ thuộc, `new` các provider, để lộ provider cần dùng qua thuộc tính `readonly` |
| `@Injectable()` provider | class bình thường, phụ thuộc khai trong constructor bằng `private readonly` |
| `@Controller()` + `@Get()` | class `XxxController`, mỗi lệnh / tool / route là một method; bảng route nằm trong `*.router.ts` |
| Pipe (`ValidationPipe`) | `zod` (MCP), `parseArgs` + kiểm tra (CLI), `query-params.pipe.ts` (HTTP) |
| Guard | `local-host.guard.ts` (từ `isLocalHost` của server) |
| Exception filter | `*.exception-filter.ts`: đổi lỗi của lõi thành mã thoát CLI, `isError` của MCP, mã HTTP |
| `HttpException` | `ThemeGraphError` và các lớp con có `code`: `GraphNotReadyError`, `NodeNotFoundError`, `ThemeSelectionError`, `UsageError` |
| Repository (TypeORM) | interface `GraphRepository`… + class `SqliteGraphRepository`… |
| `DataSource` (TypeORM) | interface `GraphStore`: mở, ghi, xoá `graph.db` của một theme |
| Entity, DTO | `interface` / `type` trong `models/` và `dto/` (dữ liệu thuần, không phải class) |
| `Scope.REQUEST` | `GraphScope`: các service truy vấn của MỘT theme, tạo khi request mở đồ thị, bỏ đi khi đóng |
| `main.ts` + `NestFactory.create(AppModule)` | `main.ts` của từng package: `new CliModule()`, `new McpModule()`, `new ServerModule()` |

**Quy ước viết class:**

- **Class** dành cho thứ có phụ thuộc hoặc có vai trò: module, controller, service, repository, parser, view, guard, filter, error.
- **`interface` / `type`** dành cho dữ liệu: model, DTO, kết quả truy vấn. Không biến dữ liệu thành class.
- **Hàm thuần nhỏ** (`hashContent`, `stripJsonComments`, `settingNodeId`) giữ là hàm trong `common/`, không bọc class chỉ để cho có.
- Service **không bao giờ `new` một repository**. Repository chỉ được tạo trong `core.module.ts`.
- Không có singleton toàn cục, không có `static` giữ trạng thái. Module được tạo trong `main.ts` hoặc trong test, **không tạo ở top-level của file**
  (bộ test đổi `THEMEGRAPH_HOME` cho từng file test; tạo sớm là đọc nhầm thư mục).

## 4. Kiến trúc tổng thể

```
 CLI (argv)          MCP (JSON-RPC stdio)        HTTP (GET /api/…)            web (React SPA)
     │                      │                          │                          │ fetch
     ▼                      ▼                          ▼                          │
 cli.router            mcp.router                http.router + guard  ◄───────────┘
     ▼                      ▼                          ▼
 *.controller          *.tool (controller)       themes.controller          ← TẦNG CONTROLLER
     │ exception-filter     │ exception-filter         │ exception-filter
     └──────────────┬───────┴──────────────────────────┘
                    ▼
     @themegraph/views (chữ cho CLI/MCP)  ·  JSON (HTTP, --json)              ← TẦNG VIEW
                    │
                    ▼  chỉ qua @themegraph/core (CoreModule)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ core                                                                  │
 │   AnalyzeModule   AnalyzeService · ThemeFileParser · GraphBuilder      │ ← TẦNG SERVICE
 │   GraphModule     GraphScopeFactory → GraphScope {Impact, RenderFlow,  │
 │                   Context, Search, DeadCode, Overview, Export, Verify} │
 │   ThemeModule     ThemeService (list, select, status, clean)           │
 │        │ chỉ biết interface: GraphStore, GraphRepository,              │
 │        │ ThemeFileRepository, ThemeRegistryRepository                  │
 │        ▼                                                               │
 │   infrastructure/  SqliteGraphStore · SqliteGraphRepository ·          │ ← TẦNG REPOSITORY
 │                    FsThemeFileRepository · JsonThemeRegistryRepository │
 └──────────────────────────────────────────────────────────────────────┘
                    ▼
        .themegraph/graph.db  ·  file của theme  ·  ~/.themegraph/registry.json
```

**Quy tắc phụ thuộc:**

| Thư mục | Được import | Không được import |
|---|---|---|
| `core/src/models`, `core/src/common` | lẫn nhau | mọi module, `infrastructure`, `node:fs`, `node:sqlite`, `node:os` |
| `core/src/{analyze,graph,theme}` | `models`, `common`, interface của module khác | `infrastructure`, `node:fs`, `node:sqlite`, `node:os` |
| `core/src/infrastructure` | `models`, `common`, các interface repository | service, controller |
| `core/src/core.module.ts` | mọi thứ trong core | (đây là nơi duy nhất nối hạ tầng vào service) |
| `cli`, `mcp`, `server` | `@themegraph/core`, `@themegraph/views` | file bên trong core (trường `exports` của package đã chặn sẵn) |

## 5. Cây thư mục và nguồn gốc từng file

```
packages/
  core/src/
    common/
      errors.ts                     ← GraphNotReadyError (open.ts), NodeNotFoundError (find-node.ts),
                                      ThemeSelectionError (select-theme.ts) + lớp cha ThemeGraphError
      hash.ts  version.ts           ← hash.ts, version.ts
    models/                         ← types.ts, tách theo chủ đề
      theme-file.model.ts           FileKind, ThemeFile, ScanResult
      ref.model.ts                  RefKind, RefSource, RawRef, Resolution, ResolvedRef
      graph.model.ts                NodeKind, NODE_KINDS, GraphNode, EdgeType, FILE_EDGE_TYPES, GraphEdge, ThemeGraph
      extraction.model.ts           SchemaInfo, ElementMention, FileElement, Extraction, FileSchema, FileHash, GraphFacts

    analyze/                        ── AnalyzeModule
      analyze.module.ts
      analyze.service.ts            ← analyze.ts
      graph-builder.ts              ← graph.ts (buildGraph)
      ref-resolver.ts               ← resolver.ts
      setting-resolver.ts           ← resolve-setting.ts
      dto/analyze-result.dto.ts     AnalyzeResult, AnalyzeStats, AnalyzeError
      parsers/
        file-parser.ts              interface FileParser { supports(file); parse(file, content) }
        theme-file.parser.ts        ← extract.ts (chọn parser đầu tiên nhận file: Strategy)
        liquid.parser.ts            ← extract-liquid.ts (+ gọi section-loads, custom-elements)
        javascript.parser.ts        ← nhánh .js của extract.ts
        default-locale.parser.ts    ← extract-locale.ts
        global-settings.parser.ts   ← extract-settings.ts
        json-template.parser.ts     ← extract-json.ts
        schema.parser.ts            ← extract-schema.ts
        section-loads.parser.ts     ← extract-section-loads.ts
        custom-elements.parser.ts   ← extract-elements.ts
        json-comments.ts  setting-id.ts   (hàm thuần dùng chung của các parser)

    graph/                          ── GraphModule
      graph.module.ts
      graph.repository.ts           interface GraphRepository   (đọc một đồ thị)
      graph.store.ts                interface GraphStore        (mở / ghi / xoá graph.db)
      graph-scope.ts                GraphScope + GraphScopeFactory
      node-finder.service.ts        ← find-node.ts
      impact.service.ts             ← impact.ts
      render-flow.service.ts        ← render-flow.ts
      context.service.ts            ← context.ts
      search.service.ts             ← search.ts
      dead-code.service.ts          ← dead-code.ts
      overview.service.ts           ← overview.ts
      export-graph.service.ts       ← export-graph.ts
      verify.service.ts             ← verify.ts
      graph-algorithms.ts           ← bfsTraverse, diffTraversals của verify.ts (hàm thuần)
      dto/                          ImpactResult, RenderFlowResult, ContextResult, SearchResult, DeadCodeResult…

    theme/                          ── ThemeModule
      theme.module.ts
      theme.service.ts              ← select-theme.ts + status.ts + clean.ts + listThemes (registry.ts)
      theme-file.repository.ts      interface ThemeFileRepository     (quét, đọc file)
      theme-registry.repository.ts  interface ThemeRegistryRepository (sổ đăng ký)
      theme-layout.ts               ← phần phân loại đường dẫn → FileKind của scanner.ts (hàm thuần)
      dto/                          StatusResult, CleanResult, ListedTheme

    infrastructure/
      sqlite/
        schema.ts                   ← SCHEMA_SQL, SCHEMA_VERSION của store.ts
        sqlite-graph.store.ts       ← saveGraph (store.ts) + openGraph (open.ts) + phần xoá của clean.ts
        sqlite-graph.repository.ts  ← TOÀN BỘ câu SQL đang rải trong các file truy vấn
        traverse.sql.ts             ← traverse.ts (WITH RECURSIVE + vòng nhân đôi mức chặn)
      fs/
        fs-theme-file.repository.ts ← phần readdir của scanner.ts + readFile của analyze.ts / status.ts
      registry/
        json-theme-registry.repository.ts ← registry.ts

    core.module.ts                  composition root của core (giống AppModule)
    index.ts                        export CoreModule, model, DTO, lỗi

  views/                            MỚI: @themegraph/views ← core/src/format.ts
    src/  text-view.ts (interface TextView<T>)  impact.view.ts  render-flow.view.ts  context.view.ts
          search.view.ts  dead-code.view.ts  overview.view.ts  status.view.ts  theme-note.view.ts
          list.view.ts  analyze.view.ts  verify.view.ts  clean.view.ts  index.ts

  cli/src/
    main.ts                         ← cli.ts
    cli.module.ts
    cli.router.ts                   ← run.ts: parseArgs, --help, bảng "tên lệnh → controller"; vẫn export run(argv, io)
    cli.exception-filter.ts         ← khối catch ở cuối run.ts (lỗi → stderr + mã thoát 1 hoặc 2)
    cli-input.ts                    cờ chung: --theme, --json, --limit, cách chọn theme (themeRootOf)
    controllers/  analyze  list  status  clean  impact  search  render-flow  context  overview
                  dead-code  verify  setup  mcp  serve        (mỗi file một *.controller.ts)
    setup/  setup.service.ts (← setup.ts)  web-root.ts

  mcp/src/
    main.ts                         ← index.ts (nối StdioServerTransport)
    mcp.module.ts
    mcp.router.ts                   ← createServer: registerTool cho từng tool; vẫn export createServer(options)
    mcp.exception-filter.ts         ← answer(): lỗi → { isError: true }
    instructions.ts                 ← INSTRUCTIONS
    tools/  list-themes.tool.ts  search.tool.ts  impact.tool.ts  render-flow.tool.ts
            context.tool.ts  dead-code.tool.ts

  server/src/
    main.ts                         ← startServer
    server.module.ts
    http.router.ts                  ← handleApi + createListener: bảng route; vẫn export handleApi, startServer
    controllers/themes.controller.ts ← THEME_ROUTES: list, overview, search, file, flow, deadCode, graph
    pipes/query-params.pipe.ts      ← required, optionalInt, optionalList
    guards/local-host.guard.ts      ← isLocalHost
    http.exception-filter.ts        ← khối catch của handleApi (400 / 404 / 409)
    static.ts                       ← giữ nguyên

  web/                              frontend, không đổi
```

## 6. Phác thảo code

Những đoạn dưới đây chỉ để thấy **hình dạng** của từng tầng. Tên và chữ ký chỉnh theo code thật khi viết.

### Repository: interface ở service, bản SQLite ở hạ tầng

```ts
// core/src/graph/graph.repository.ts
// Danh sách hàm gom từ mọi câu SELECT đang có trong các file truy vấn.
export interface GraphRepository {
  readonly themeRoot: string;
  readonly meta: GraphMeta;
  close(): void;

  getNode(id: string): GraphNode | null;
  allNodes(): GraphNode[];
  nodesOfKind(kind: NodeKind): GraphNode[];
  nodesContaining(text: string, options: { ignoreCase: boolean; limit?: number }): GraphNode[];

  allEdges(): GraphEdge[];
  edgesFrom(id: string): EdgeWithKind[];
  edgesTo(id: string): EdgeWithKind[];
  reach(startIds: readonly string[], direction: Direction, edgeTypes?: readonly EdgeType[]): Reached[];

  refsFrom(id: string): ResolvedRef[];
  schemas(): FileSchema[];
  elements(): FileElement[];
  fileHashes(): FileHash[];
  counts(): GraphCounts;
}

// core/src/graph/graph.store.ts
export interface GraphStore {
  open(themeRoot: string): GraphRepository; // ném GraphNotReadyError
  save(themeRoot: string, graph: ThemeGraph, analyzedAt: Date): void;
  remove(themeRoot: string): boolean;
  hasGraph(dir: string): boolean; // dùng khi tìm ngược lên thư mục cha, như git tìm .git
}
```

### Service và phạm vi request

```ts
// core/src/graph/impact.service.ts
export class ImpactService {
  constructor(
    private readonly graph: GraphRepository,
    private readonly nodes: NodeFinder,
  ) {}

  findImpact(target: string, options: FindNodeOptions = {}): ImpactResult {
    const start = this.nodes.find(target, options);
    const reached = this.graph.reach([start.id], "backward", FILE_EDGE_TYPES);
    // … phần gom theo trang giữ nguyên từ impact.ts
  }
}

// core/src/graph/graph-scope.ts
/** Các service truy vấn của MỘT theme, sống trong một request (giống Scope.REQUEST). */
export class GraphScope {
  readonly nodes: NodeFinder;
  readonly impact: ImpactService;
  readonly context: ContextService;
  // … renderFlow, search, deadCode, overview, exportGraph, verify

  constructor(readonly graph: GraphRepository) {
    this.nodes = new NodeFinder(graph);
    this.impact = new ImpactService(graph, this.nodes);
    this.context = new ContextService(graph, this.nodes, this.impact);
  }
}

export class GraphScopeFactory {
  constructor(private readonly store: GraphStore) {}

  /** Mở đồ thị, chạy body, luôn đóng lại. Thay cho withGraph (cli), onTheme (mcp), withTheme (server). */
  use<T>(themeRoot: string, body: (scope: GraphScope) => T): T {
    const graph = this.store.open(themeRoot);
    try {
      return body(new GraphScope(graph));
    } finally {
      graph.close();
    }
  }
}
```

Hiện mỗi lớp vỏ tự viết một hàm "mở – chạy – đóng" riêng: `withGraph` ở `cli/run.ts`, `onTheme` ở `mcp/server.ts`, `withTheme` ở `server/api.ts`.
`GraphScopeFactory.use` gộp ba hàm đó làm một.

### Parser theo mẫu Strategy

```ts
// core/src/analyze/parsers/theme-file.parser.ts
export class ThemeFileParser {
  constructor(private readonly parsers: readonly FileParser[]) {}

  parse(file: ThemeFile, content: string): Extraction {
    const parser = this.parsers.find((candidate) => candidate.supports(file));
    return parser === undefined ? EMPTY_EXTRACTION : parser.parse(file, content);
  }
}
```

### Module: nơi duy nhất `new` các provider

```ts
// core/src/analyze/analyze.module.ts
export class AnalyzeModule {
  readonly analyzer: AnalyzeService;

  constructor(files: ThemeFileRepository, store: GraphStore, registry: ThemeRegistryRepository) {
    // Thứ tự = thứ tự ưu tiên của extract.ts hiện tại: liquid, js, locale mặc định, settings_schema, json.
    const parser = new ThemeFileParser([
      new LiquidParser(new SchemaParser(), new SectionLoadsParser(), new CustomElementsParser()),
      new JavaScriptParser(new SectionLoadsParser(), new CustomElementsParser()),
      new DefaultLocaleParser(),
      new GlobalSettingsParser(),
      new JsonTemplateParser(),
    ]);
    const builder = new GraphBuilder(new RefResolver(), new SettingResolver());
    this.analyzer = new AnalyzeService(files, parser, builder, store, registry);
  }
}

// core/src/core.module.ts
export class CoreModule {
  readonly analyzer: AnalyzeService;
  readonly themes: ThemeService;
  readonly graphs: GraphScopeFactory;

  constructor() {
    // Chỉ file này biết có SQLite, file system và file JSON.
    const store = new SqliteGraphStore();
    const files = new FsThemeFileRepository();
    const registry = new JsonThemeRegistryRepository(registryDir());

    this.analyzer = new AnalyzeModule(files, store, registry).analyzer;
    this.themes = new ThemeModule(registry, files, store).themes;
    this.graphs = new GraphModule(store).scopes;
  }
}
```

### Controller ở ba lớp vỏ

```ts
// cli/src/controllers/impact.controller.ts
export class ImpactController implements CliController {
  readonly command = "impact";

  constructor(
    private readonly graphs: GraphScopeFactory,
    private readonly view: ImpactView,
  ) {}

  run(input: CliInput, io: Io): number {
    const target = input.requireOne("đường dẫn file"); // sai cú pháp → UsageError → filter trả mã thoát 2
    const result = this.graphs.use(input.themeRoot(), (scope) => scope.impact.findImpact(target, { baseDir: input.cwd }));
    input.print(result, this.view, io); // --json hoặc chữ
    return EXIT_OK;
  }
}

// mcp/src/tools/impact.tool.ts: inputSchema bằng zod, giống DTO + ValidationPipe
export class ImpactTool implements McpTool {
  readonly name = "impact";
  readonly inputSchema = { target: z.string().min(1).describe("…"), limit: limitParam(…), theme: themeParam };

  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
    private readonly view: ImpactView,
  ) {}

  handle(input: { target: string; limit?: number; theme?: string }): string[] { /* … */ }
}

// server/src/controllers/themes.controller.ts: mỗi method một route, bảng route ở http.router.ts
export class ThemesController {
  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
  ) {}

  list(): ApiTheme[] { /* GET /api/themes */ }
  search(id: string, query: URLSearchParams): SearchResult { /* GET /api/themes/:id/search */ }
  // overview, file, flow, deadCode, graph
}
```

## 7. Vòng đời một request

```
themegraph impact snippets/card.liquid
  main.ts ─► CliModule ─► CliRouter ─► ImpactController.run
                                          ├─ GraphScopeFactory.use(themeRoot)  ─► SqliteGraphStore.open
                                          │     └─ scope.impact.findImpact()   ─► SqliteGraphRepository.reach (WITH RECURSIVE)
                                          ├─ ImpactView.render(result)  (hoặc JSON khi --json)
                                          └─ lỗi? ─► CliExceptionFilter ─► stderr + mã thoát

MCP tool "impact" và GET /api/themes/:id/file đi cùng đường đó; chỉ khác router, controller và filter.
```

## 8. Cho máy giữ quy tắc phụ thuộc

Thêm vào `eslint.config.mjs`:

```js
const NO_IO = { group: ['node:sqlite', 'node:fs', 'node:fs/*', 'node:os'], message: 'Service không làm I/O trực tiếp; dùng repository.' };
const NO_INFRA = { group: ['**/infrastructure/**'], message: 'Chỉ core.module.ts được biết tầng hạ tầng.' };

// …
{ files: ['packages/core/src/{analyze,graph,theme}/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', { patterns: [NO_IO, NO_INFRA] }] } },
{ files: ['packages/core/src/{models,common}/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', { patterns: [NO_IO, NO_INFRA,
    { group: ['**/analyze/**', '**/graph/**', '**/theme/**'], message: 'models và common không phụ thuộc module nào.' }] }] } },
```

Lưu ý: với flat config, khối sau **ghi đè** (không gộp) cấu hình của cùng một luật trên cùng file.
Vì vậy khối nào cũng phải liệt kê đủ mẫu cấm của nó, như `NO_IO` và `NO_INFRA` được nhắc lại ở trên.

## 9. Lộ trình: test phải xanh sau mỗi bước

**Nguyên tắc giữ test:** giữ nguyên các cửa vào công khai của lớp vỏ: `run(argv, io, overrides)` (cli), `createServer(options)` (mcp),
`handleApi(request)` và `startServer(options)` (server). Bên trong, các hàm này tạo module rồi gọi router.
Nhờ vậy `run.test.ts`, `server.test.ts`, `stdio.test.ts`, `api.test.ts`, `http.test.ts` **không phải sửa** và giữ cho hành vi không đổi.
Test của core thì phải sửa, vì chúng gọi thẳng hàm (`impact(graph, …)`). Thêm vào `tests/helpers.ts` một hàm `openScope(themeRoot)` để việc sửa chỉ là thay chữ:
`impact(graph, x)` → `scope.impact.findImpact(x)`.

| Bước | Việc | Thước đo xong | Ước lượng |
|---|---|---|---|
| B0 | `pnpm install`, `pnpm test`, ghi số test; chạy `tools/accept/` trên Purity và Dawn, lưu kết quả làm mốc | có số liệu mốc | 0,5 ngày |
| B1 | Chuyển file vào cây thư mục mới, **vẫn là hàm, chưa đổi logic**; sửa import, kể cả trong `tests/` | `pnpm typecheck` + `pnpm test` xanh, cùng số test | 1 ngày |
| B2 | Tách `format.ts` thành `@themegraph/views`, mỗi view một class | test xanh | 0,5 ngày |
| B3 | Viết interface repository + `SqliteGraphStore`, `SqliteGraphRepository`; chuyển SQL **từng truy vấn một**: find-node → search → status → overview → export-graph → impact → render-flow → context → verify → dead-code | ngoài `infrastructure/` không còn `.db` hay `prepare(` | 2–3 ngày |
| B4 | Đổi các truy vấn thành class `*Service`, thêm `GraphScope`, `GraphScopeFactory`, `GraphModule`; sửa test core qua `openScope` | test xanh | 1,5 ngày |
| B5 | Parser thành class (Strategy), `GraphBuilder`, `AnalyzeService`, `ThemeService`, `FsThemeFileRepository`, `JsonThemeRegistryRepository`, `CoreModule` | test xanh | 1 ngày |
| B6 | Lớp vỏ: router, controller, exception filter, guard, pipe cho cli, mcp, server; `run`, `createServer`, `handleApi` thành hàm bootstrap mỏng | test lớp vỏ xanh **mà không sửa dòng nào** | 2 ngày |
| B7 | Luật ESLint ở mục 8; viết 1–2 test dùng `GraphRepository` giả trong bộ nhớ (ví dụ cho `ImpactService`); chạy lại `tools/accept/` và đo thời gian so với mốc | `pnpm lint` sạch, số liệu trùng mốc | 0,5–1 ngày |

**Tổng khoảng 9–10 ngày làm việc.** Từ 14/10 tới hạn 03/11 còn khoảng 15 ngày làm việc, nên chỉ còn 5–6 ngày cho báo cáo. Hai điểm dừng an toàn:

- **Dừng sau B5:** core đã đúng kiểu NestJS (module, service, repository, DI qua constructor).
  Lớp vỏ vẫn chạy, chỉ gọi `CoreModule` từ code cũ. Báo cáo được trọn tầng service và repository.
- **Dừng sau B3:** SQL đã gom về repository, nhưng service vẫn là hàm. Phần class ghi vào "hướng phát triển".

Mỗi bước một commit trên nhánh `viet-lai-kien-truc`.

## 10. Những gì không đổi

- Lược đồ `graph.db` (`SCHEMA_VERSION = 6`) và phép duyệt `WITH RECURSIVE`, chỉ chuyển chỗ sang `infrastructure/sqlite/`.
- Lệnh CLI, cờ, mã thoát, đầu ra chữ và `--json`; 6 tool MCP và `INSTRUCTIONS`; đường dẫn và dạng JSON của API HTTP; package `web`.
- Thuật toán trích quan hệ, phân giải, gộp cạnh, duyệt.

## 11. Rủi ro

- **`reach` nhận nhiều điểm xuất phát** (để dead-code dùng chung phép duyệt, thay cho câu đệ quy riêng `UNUSED_SQL`):
  SQL đổi `SELECT ?1` thành `SELECT value FROM json_each(?1)`. Cần đo thời gian ở B7. Nếu chậm thì giữ một hàm riêng trong repository, đặt tên theo khái niệm
  (`reachFromEntryPoints`), và ghi rõ đây là đánh đổi.
- **Quy tắc "file đang dùng" của dead-code** (loại trang, section có preset, block công khai khi có file nhận `@theme`) chuyển từ SQL sang `DeadCodeService`,
  thành một vòng lặp tới điểm bất động. 345 dòng của `dead-code.test.ts` giữ cho kết quả không đổi.
- **Interface `GraphRepository` khoảng 15 hàm.** Đó là cái giá của việc gom SQL về một chỗ. Chia nhóm bằng chú thích trong interface là đủ.
- **Class hoá dễ sinh thừa:** không tạo class cho dữ liệu (model, DTO), không tạo interface cho thứ chỉ có một bản hiện thực mà cũng không cần thay khi test (parser, view).
  Interface chỉ dành cho repository, vì đó là chỗ thật sự cần thay bằng bản giả.

## 12. Gọi tên trong báo cáo

> ThemeGraph được tổ chức theo **kiến trúc module phong cách NestJS: Module – Controller – Service – Repository**.
> Ba kênh vào (CLI, MCP, HTTP) là ba bộ controller dùng chung tầng service của gói lõi. Tầng service truy cập dữ liệu qua các interface repository,
> hiện thực bằng SQLite và file system. Phụ thuộc được tiêm qua constructor và nối tập trung trong các file module (Pure DI, composition root),
> không dùng framework DI. Luồng phân tích theo mô hình **Pipes and Filters**; bộ phân tích file dùng mẫu **Strategy**.
> Quy tắc phụ thuộc giữa các tầng được kiểm tra tự động bằng ESLint.
