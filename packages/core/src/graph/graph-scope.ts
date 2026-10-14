import { ContextService } from "./context.service.js";
import { DeadCodeService } from "./dead-code.service.js";
import { ExportGraphService } from "./export-graph.service.js";
import type { GraphRepository } from "./graph.repository.js";
import type { GraphStore } from "./graph.store.js";
import { ImpactService } from "./impact.service.js";
import { NodeFinder } from "./node-finder.service.js";
import { OverviewService } from "./overview.service.js";
import { RenderFlowService } from "./render-flow.service.js";
import { SearchService } from "./search.service.js";
import { VerifyService } from "./verify.service.js";

/**
 * Các service truy vấn của MỘT theme, sống trong một request: giống provider
 * Scope.REQUEST của NestJS. Mỗi lần một lệnh, một tool hay một route mở đồ thị
 * của một theme thì có một GraphScope mới; xong việc thì bỏ đi.
 *
 * Constructor là nơi nối các service với nhau, theo đúng phụ thuộc của chúng.
 */
export class GraphScope {
  readonly nodes: NodeFinder;
  readonly search: SearchService;
  readonly impact: ImpactService;
  readonly renderFlow: RenderFlowService;
  readonly context: ContextService;
  readonly deadCode: DeadCodeService;
  readonly overview: OverviewService;
  readonly exportGraph: ExportGraphService;
  readonly verify: VerifyService;

  constructor(readonly graph: GraphRepository) {
    this.nodes = new NodeFinder(graph);
    this.search = new SearchService(graph);
    this.impact = new ImpactService(graph, this.nodes);
    this.renderFlow = new RenderFlowService(graph, this.nodes);
    this.context = new ContextService(graph, this.nodes, this.impact);
    this.deadCode = new DeadCodeService(graph);
    this.overview = new OverviewService(graph, this.deadCode);
    this.exportGraph = new ExportGraphService(graph);
    this.verify = new VerifyService(graph);
  }
}

/**
 * Mở đồ thị của một theme thành một GraphScope. Đây là provider mà các lớp vỏ
 * nhận qua constructor.
 */
export class GraphScopeFactory {
  constructor(private readonly store: GraphStore) {}

  /**
   * Mở đồ thị, chạy `body`, rồi luôn đóng lại, kể cả khi `body` ném lỗi.
   *
   * Mở và đóng trong từng request là có chủ ý: giữ graph.db mở thì trên Windows
   * lệnh analyze không ghi đè được file đó trong lúc server đang chạy.
   *
   * Ném GraphNotReadyError nếu theme chưa có đồ thị dùng được.
   */
  use<T>(themeRoot: string, body: (scope: GraphScope) => T): T {
    const graph = this.store.open(themeRoot);
    try {
      return body(new GraphScope(graph));
    } finally {
      graph.close();
    }
  }
}
