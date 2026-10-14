# Kiến trúc ThemeGraph sau khi viết lại theo phong cách NestJS

Thư mục này là bản clone của `themegraph/`, nhánh `viet-lai-kien-truc`, tách từ commit `16e0ea0`.
Bản gốc `themegraph/` giữ nguyên để đối chiếu. Tài liệu này mô tả kiến trúc **đã triển khai**;
mục 9 ghi những chỗ khác với bản đề xuất ban đầu.

## 1. Kết quả

| Bước | Commit | Nội dung |
|---|---|---|
| B1 | `c007c61` | Chuyển file của core vào cây thư mục theo module; `types.ts` tách thành bốn file model |
| B2 | `eda7520` | Tách `format.ts` thành gói `@themegraph/views`, mỗi kết quả một class view |
| B3 | `227295b` | Gom mọi câu SQL về `SqliteGraphRepository` sau interface `GraphRepository` |
| B4 | `6c0396c` | Truy vấn thành class service; `GraphScope`, `GraphScopeFactory`, `GraphModule` |
| B5 | `09fec75` | Module analyze và theme; `CoreModule` là nơi duy nhất nối hạ tầng vào service |
| B6 | `29cfd66` | CLI, MCP, HTTP thành module, router, controller, exception filter; bỏ API dạng hàm |
| B7 | `46487d9` | Luật ESLint giữ quy tắc phụ thuộc; test service trên repository trong bộ nhớ |

Hành vi không đổi: lệnh CLI, cờ, mã thoát, đầu ra chữ và `--json`, sáu tool MCP, API HTTP, giao diện web,
lược đồ `graph.db`. Bằng chứng ở mục 10.

## 2. Công nghệ: phong cách NestJS, không cài NestJS

Không thêm thư viện runtime nào. Vẫn là TypeScript, `node:sqlite`, `@shopify/liquid-html-parser`, MCP SDK, `zod`,
React/sigma cho web. Phụ thuộc được tiêm **bằng tay qua constructor** (Pure DI) và nối trong các file `*.module.ts`.

Không dùng chính NestJS vì: hai trong ba cửa vào không phải HTTP (CLI là tiến trình ngắn, MCP chạy trên stdio, nơi
stdout chỉ được chứa JSON-RPC); DI của Nest dựa trên decorator metadata, mà thiết kế ở đây dựa trên interface
(biến mất lúc chạy), dự án bật `verbatimModuleSyntax` + `consistent-type-imports`, và vitest không sinh decorator
metadata; nối tay để lộ toàn bộ đồ thị phụ thuộc trong vài file, dễ giải thích hơn.

## 3. Khái niệm NestJS và chỗ tương ứng trong code

| NestJS | ThemeGraph |
|---|---|
| `AppModule` | [core.module.ts](packages/core/src/core.module.ts): `CoreModule`, nơi DUY NHẤT `new` SQLite, file system, sổ đăng ký |
| `@Module` | `AnalyzeModule`, `ThemeModule`, `GraphModule`, `CliModule`, `McpModule`, `ServerModule` |
| `@Injectable()` provider | class nhận phụ thuộc qua constructor `private readonly`: `AnalyzeService`, `ThemeService`, `ImpactService`… |
| `Scope.REQUEST` | [graph-scope.ts](packages/core/src/graph/graph-scope.ts): `GraphScope` gom các service truy vấn của MỘT theme; `GraphScopeFactory.use()` mở, chạy, luôn đóng |
| Repository / DataSource (TypeORM) | interface `GraphRepository`, `GraphStore`, `ThemeFileRepository`, `ThemeRegistryRepository`; bản thật trong `infrastructure/` |
| `@Controller` | CLI: 14 `*.controller.ts`; MCP: 6 `*.tool.ts`; HTTP: `ThemesController` |
| Router | `CliRouter`, `createServer()` trong `mcp.router.ts`, `HttpRouter` (bảng route) |
| Pipe (ValidationPipe) | `parseCliArgs` + `CliInput` (CLI), schema `zod` (MCP), `QueryParams` (HTTP) |
| Guard | `LocalHostGuard` (chặn DNS rebinding) |
| Exception filter | `CliExceptionFilter` (mã thoát 1/2), `McpExceptionFilter` (`isError`), `HttpExceptionFilter` (400/404/409) |
| `HttpException` | `ThemeGraphError` và các lớp con: `GraphNotReadyError`, `NodeNotFoundError`, `ThemeSelectionError`; `UsageError` ở CLI |
| Entity, DTO | `models/*.model.ts`, `*/dto/*.dto.ts`: chỉ `interface`/`type`, không class |
| View / serializer | gói `@themegraph/views` (chữ cho CLI và MCP); `JSON.stringify` cho `--json` và HTTP |
| `main.ts` | `run.ts` (CLI), `mcp.router.ts` + `index.ts` (MCP), `main.ts` (HTTP) |

## 4. Kiến trúc tổng thể

```
 CLI (argv)              MCP (JSON-RPC stdio)            HTTP (GET /api/…)            web (React SPA)
     │ run.ts                │ createServer                   │ main.ts + LocalHostGuard  ◄──┘ fetch
     ▼                       ▼                                ▼
 CliRouter ──────────── McpServer ───────────────────── HttpRouter                         ROUTER
     ▼                       ▼                                ▼
 *.controller.ts        *.tool.ts (+ ThemeRunner)       ThemesController                   CONTROLLER
     │ CliExceptionFilter    │ McpExceptionFilter             │ HttpExceptionFilter
     └───────────┬───────────┴────────────────────────────────┘
                 ▼  chỉ qua API công khai của @themegraph/core (CoreModule)
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ AnalyzeService      ThemeService          GraphScopeFactory → GraphScope    │ SERVICE
 │  ThemeScanner        (list, locate,        NodeFinder, SearchService,       │
 │  ThemeFileParser      select, status,      ImpactService, RenderFlowService,│
 │  GraphBuilder         clean)               ContextService, DeadCodeService, │
 │                                            OverviewService, ExportGraph…,   │
 │                                            VerifyService                    │
 │        │ chỉ biết interface: GraphStore, GraphRepository,                   │
 │        │ ThemeFileRepository, ThemeRegistryRepository                       │
 │        ▼                                                                   │
 │ infrastructure/  SqliteGraphStore · SqliteGraphRepository ·                 │ REPOSITORY
 │                  FsThemeFileRepository · JsonThemeRegistryRepository        │
 └───────────────────────────────────────────────────────────────────────────┘
        ▼
 .themegraph/graph.db  ·  file của theme  ·  ~/.themegraph/registry.json
```

Gói `@themegraph/views` đứng cạnh tầng controller: CLI và MCP đưa kết quả của service qua view để ra chữ.

## 5. Quy tắc phụ thuộc, và máy kiểm tra nó

| Thư mục | Không được import |
|---|---|
| `core/src/models`, `core/src/common` | module nào (`analyze`, `graph`, `theme`), `infrastructure`, `node:fs`, `node:sqlite`, `node:os` |
| `core/src/analyze`, `graph`, `theme` | `infrastructure`, `node:fs`, `node:sqlite`, `node:os` |
| `core/src/infrastructure` | (hiện thực interface của các module; không ai ngoài `core.module.ts` import nó) |
| `cli`, `mcp`, `server`, `views` | file bên trong core (`@themegraph/core/*`); chỉ dùng API công khai |

[eslint.config.mjs](eslint.config.mjs) khai các luật này bằng `no-restricted-imports`; `pnpm lint` báo lỗi khi vi phạm.
Đã thử với ba file cố ý vi phạm: ra đúng bốn lỗi, mỗi lỗi kèm lời giải thích.

## 6. Cây thư mục

```
packages/
  core/src/
    common/          errors.ts  hash.ts  paths.ts  version.ts
    models/          theme-file · ref · extraction · graph · theme-registry (.model.ts)
    analyze/         analyze.module.ts  analyze.service.ts  graph-builder.ts
                     ref-resolver.ts  setting-resolver.ts  dto/
                     parsers/  file-parser.ts (interface FileParser)  theme-file.parser.ts  index.ts (defaultParsers)
                               liquid · javascript · default-locale · global-settings · json-template (.parser.ts)
                               schema · section-loads · custom-elements (.parser.ts: hàm thuần)  json-comments.ts
    theme/           theme.module.ts  theme.service.ts  theme-scanner.ts  theme-layout.ts
                     theme-file.repository.ts  theme-registry.repository.ts  dto/
    graph/           graph.module.ts  graph-scope.ts  graph.repository.ts  graph.store.ts  graph-algorithms.ts
                     node-finder · search · impact · render-flow · context · dead-code · overview
                     · export-graph · verify (.service.ts)  dto/
    infrastructure/  sqlite/ (schema · traverse.sql · sqlite-graph.repository · sqlite-graph.store)
                     fs/fs-theme-file.repository.ts  registry/json-theme-registry.repository.ts
    core.module.ts   index.ts
  views/src/         text-view.ts  text.ts  12 × *.view.ts
  cli/src/           run.ts  cli.module.ts  cli.router.ts  cli-input.ts  cli.exception-filter.ts  cli.types.ts
                     usage.error.ts  help.ts  package-paths.ts  setup.ts  web-root.ts  controllers/ (14)
  mcp/src/           index.ts  mcp.module.ts  mcp.router.ts  mcp.exception-filter.ts  theme-runner.ts
                     instructions.ts  tools/ (tool.ts + 6 tool)
  server/src/        index.ts  main.ts  server.module.ts  http.router.ts  http.exception-filter.ts  http.errors.ts
                     api.types.ts  theme-id.ts  static.ts  controllers/  pipes/  guards/
  web/               không đổi
```

## 7. Đọc code theo một request

`themegraph impact snippets/card.liquid`:

```
cli.ts → run.ts: new CliModule(paths)                     cli/src/cli.module.ts
  → CliRouter.run: parseCliArgs → CliInput                 cli/src/cli.router.ts, cli-input.ts
  → ImpactController.run                                   cli/src/controllers/impact.controller.ts
      → GraphScopeFactory.use(themeRoot, scope => …)       core/src/graph/graph-scope.ts
          → SqliteGraphStore.open                          core/src/infrastructure/sqlite/sqlite-graph.store.ts
          → scope.impact.findImpact(target)                core/src/graph/impact.service.ts
              → NodeFinder.find, GraphRepository.reach     core/src/graph/node-finder.service.ts
                  → SqliteGraphRepository.reach (WITH RECURSIVE)   core/src/infrastructure/sqlite/
      → CliInput.print(result, ImpactView)                 views/src/impact.view.ts
  lỗi? → CliExceptionFilter.catch                          cli/src/cli.exception-filter.ts
```

Tool MCP `impact` ([impact.tool.ts](packages/mcp/src/tools/impact.tool.ts)) và
`GET /api/themes/:id/file` ([themes.controller.ts](packages/server/src/controllers/themes.controller.ts)) đi cùng
đường đó; chỉ khác router, controller và filter.

## 8. Quy ước

- **Class** cho thứ có phụ thuộc hoặc có vai trò: module, controller, service, repository, parser, view, guard, filter, lỗi.
- **`interface`/`type`** cho dữ liệu: model, DTO. Không biến dữ liệu thành class.
- **Hàm thuần** cho việc nhỏ không phụ thuộc gì (`hashContent`, `stripJsonComments`, `resolveRef`, `classifyFiles`,
  các hàm trích trong `parsers/`): không bọc class chỉ để cho có.
- **Interface chỉ dành cho chỗ cần thay được**: bốn repository. Parser có interface `FileParser` vì đó là một Strategy.
- Service không bao giờ `new` một repository. Module được tạo trong hàm khởi động hoặc trong test, không ở top-level
  của file, vì `CoreModule` đọc `THEMEGRAPH_HOME` lúc tạo.

## 9. Khác với bản đề xuất ban đầu

| Đề xuất | Đã làm | Vì sao |
|---|---|---|
| `RefResolver`, `SettingResolver`, `SchemaParser`, `SectionLoadsParser`, `CustomElementsParser` là class | Giữ là hàm thuần; chỉ năm parser theo định dạng file là class `FileParser` | Chúng không có trạng thái hay phụ thuộc; bọc class trái với quy ước ở mục 8 |
| `reach()` nhận nhiều điểm xuất phát | `reach()` giữ một điểm xuất phát; thêm `reachableFrom(startIds)` chỉ trả tập node | Dead-code chỉ cần tập node, không cần độ sâu; câu SQL riêng nhẹ hơn hẳn |
| `ThemeFileRepository { scan, read }` | `{ listFiles, readFile }`; phân loại file là hàm thuần `classifyFiles` trong `theme-layout.ts`, `ThemeScanner` nối hai thứ | Quy ước thư mục của Shopify là luật nghiệp vụ, không phải việc của hạ tầng |
| `UsageError` trong `common/errors.ts` của core | Trong gói cli | Sai cú pháp dòng lệnh là chuyện của CLI |
| Test của lớp vỏ "không phải sửa dòng nào" | Phải sửa phần tính kết quả mong đợi (gọi CoreModule thay cho hàm cũ); phần gọi lớp vỏ và các khẳng định giữ nguyên | Các test đó dùng chính API của core để tính đáp án |
| Đường dẫn của gói tính trong controller | `package-paths.ts` nằm cạnh `cli.js` | Tính từ `controllers/` thì sai ở bản `dist/` hoặc ở gói phát hành (rolldown gộp phẳng) |
| — | Lệnh build xoá `dist/` trước khi biên dịch | Phát hiện một test của registry nạp nhầm file build cũ còn sót mà vẫn đạt; đã sửa test |

## 10. Kiểm chứng

- **Test:** mốc trước khi viết lại 985 đạt / 1 bỏ qua (38 file). Sau B7: **991 đạt / 1 bỏ qua (41 file)**.
  Số tăng là test mới (3 test của `OverviewView`, 3 test service trên repository trong bộ nhớ); không test cũ nào bị bỏ.
  `pnpm -r typecheck` và `pnpm lint` sạch.
- **Golden master** ([golden.mjs](tools/accept/golden.mjs), [golden-compare.mjs](tools/accept/golden-compare.mjs)):
  chạy CLI, MCP và API HTTP của bản đã build trên ba theme (mini, Dawn 1299 node, Purity 3811 node), ghi đầu ra của
  analyze, toàn bộ nội dung `graph.db`, impact và context cho MỌI node (cả `--json` lẫn chữ), render-flow mọi trang,
  lỗi người dùng, sáu tool MCP, mọi route HTTP, status khi file đổi, clean.
  - Hai lần chạy bản gốc với nhau: trùng khớp 21.679/21.679 mục (thước đo ổn định; chỉ bỏ qua mili giây và giờ địa phương).
  - Bản gốc so với bản viết lại: **trùng khớp 21.679/21.679 mục** (mini 309, Dawn 5.632, Purity 15.730, status/clean 8). Chạy trên bản build của B6 (`29cfd66`); B7 chỉ thêm test và luật lint, không đổi mã nguồn.
- **Gói phát hành:** `node tools/release/pack.mjs` rồi cài `.tgz` vào prefix tạm; `tools/release/smoke.mjs` trên Dawn:
  **13 đạt, 0 hỏng** (analyze, list/status, overview/search, impact, render-flow/context, dead-code/verify, lỗi người
  dùng, serve, mcp, setup, clean).

## 11. Còn lại

- `GraphRepository` có khoảng 20 hàm: cái giá của việc gom SQL về một chỗ. Chia nhóm bằng chú thích trong interface.
- `cli/src/setup.ts` (nối vào Claude Code, Cursor) giữ dạng hàm như cũ; `SetupController` gọi nó.
- Golden master chậm (khoảng 40 phút cho ba theme) vì chạy impact và context cho mọi node; chỉ cần chạy khi đổi lớn.

## 12. Gọi tên trong báo cáo

> ThemeGraph được tổ chức theo **kiến trúc module phong cách NestJS: Module – Controller – Service – Repository**.
> Ba kênh vào (CLI, MCP, HTTP) là ba bộ controller dùng chung tầng service của gói lõi. Tầng service truy cập dữ liệu
> qua các interface repository, hiện thực bằng SQLite và file system. Phụ thuộc được tiêm qua constructor và nối tập
> trung trong các file module (Pure DI, composition root), không dùng framework DI. Luồng phân tích theo mô hình
> **Pipes and Filters**; bộ phân tích file dùng mẫu **Strategy**. Quy tắc phụ thuộc giữa các tầng được kiểm tra tự động
> bằng ESLint, và việc viết lại được kiểm chứng bằng golden master trên ba theme thật.
