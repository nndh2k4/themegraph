import { describe, expect, it } from 'vitest';

import { GraphScope } from '../src/graph/graph-scope.js';
import type {
  Direction,
  ElementPair,
  GraphCounts,
  GraphMeta,
  GraphRepository,
  IntegrityReport,
  NeighborEdge,
  Reached,
  ReferenceCount,
} from '../src/graph/graph.repository.js';
import type {
  EdgeType,
  FileElement,
  FileHash,
  FileSchema,
  GraphEdge,
  GraphNode,
  NodeKind,
  ResolvedRef,
} from '../src/models/index.js';

/**
 * Một GraphRepository giữ đồ thị trong bộ nhớ, không SQLite, không đĩa.
 *
 * Mục đích của file test này: chứng minh các service chỉ phụ thuộc INTERFACE
 * GraphRepository. Thay bản SQLite bằng bản này mà ImpactService, NodeFinder,
 * SearchService vẫn chạy y như cũ.
 */
class InMemoryGraphRepository implements GraphRepository {
  readonly meta: GraphMeta = { schemaVersion: 6, toolVersion: 'test', analyzedAt: '2026-10-14T00:00:00.000Z' };

  constructor(
    readonly themeRoot: string,
    private readonly nodes: GraphNode[],
    private readonly edges: GraphEdge[],
  ) {}

  close(): void {}

  private kindOf(id: string): NodeKind {
    const node = this.getNode(id);
    if (node === null) throw new Error(`không có node ${id}`);
    return node.kind;
  }

  getNode(id: string): GraphNode | null {
    return this.nodes.find((node) => node.id === id) ?? null;
  }

  allNodes(): GraphNode[] {
    return [...this.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  nodesOfKinds(kinds: readonly NodeKind[]): GraphNode[] {
    return this.allNodes().filter((node) => kinds.includes(node.kind));
  }

  findNodes(text: string, options: { ignoreCase: boolean; limit?: number }): GraphNode[] {
    const found = this.allNodes().filter((node) => (options.ignoreCase ? node.id.toLowerCase() : node.id).includes(text));
    return options.limit === undefined ? found : found.slice(0, options.limit);
  }

  nodesWithoutIncomingEdges(kind: NodeKind): GraphNode[] {
    return this.nodesOfKinds([kind]).filter((node) => !this.edges.some((edge) => edge.to === node.id));
  }

  countNodes(kind?: NodeKind): number {
    return kind === undefined ? this.nodes.length : this.nodesOfKinds([kind]).length;
  }

  allEdges(): GraphEdge[] {
    return [...this.edges];
  }

  edgesFrom(id: string): NeighborEdge[] {
    return this.edges.filter((edge) => edge.from === id).map((edge) => ({ ...edge, neighborKind: this.kindOf(edge.to) }));
  }

  edgesTo(id: string): NeighborEdge[] {
    return this.edges.filter((edge) => edge.to === id).map((edge) => ({ ...edge, neighborKind: this.kindOf(edge.from) }));
  }

  mostReferenced(): ReferenceCount[] {
    return [];
  }

  /** Duyệt theo chiều rộng, giống hợp đồng của reach(): độ sâu nhỏ nhất, xếp theo (độ sâu, id). */
  reach(startId: string, direction: Direction, edgeTypes?: readonly EdgeType[]): Reached[] {
    if (this.getNode(startId) === null) return [];
    const usable = this.edges.filter((edge) => edgeTypes === undefined || edgeTypes.includes(edge.type));
    const step = (id: string, onlySure: boolean) =>
      usable
        .filter((edge) => (direction === 'forward' ? edge.from : edge.to) === id && (!onlySure || !edge.conditional))
        .map((edge) => (direction === 'forward' ? edge.to : edge.from));

    const walk = (onlySure: boolean): Map<string, number> => {
      const depth = new Map([[startId, 0]]);
      for (const queue = [startId]; queue.length > 0; ) {
        const id = queue.shift() as string;
        for (const next of step(id, onlySure)) {
          if (depth.has(next)) continue;
          depth.set(next, (depth.get(id) ?? 0) + 1);
          queue.push(next);
        }
      }
      return depth;
    };

    const all = walk(false);
    const sure = walk(true);
    return [...all]
      .map(([id, depth]) => ({ id, kind: this.kindOf(id), depth, certain: sure.has(id) }))
      .sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  reachableFrom(startIds: readonly string[]): Set<string> {
    return new Set(startIds.flatMap((id) => this.reach(id, 'forward').map((node) => node.id)));
  }

  refLines(): number[] {
    return [];
  }

  missingRefsFrom(): ResolvedRef[] {
    return [];
  }

  schemas(): FileSchema[] {
    return [];
  }

  elements(): FileElement[] {
    return [];
  }

  elementPairs(): ElementPair[] {
    return [];
  }

  fileHashes(): FileHash[] {
    return [];
  }

  counts(): GraphCounts {
    return { nodesByKind: {}, edgesByType: {}, refsByStatus: {} };
  }

  checkIntegrity(): IntegrityReport {
    return { problems: [], brokenLinks: [] };
  }
}

const edge = (from: string, to: string, type: EdgeType, conditional = false): GraphEdge => ({
  from,
  to,
  type,
  conditional,
  sources: 'liquid',
  count: 1,
});

/**
 *   page:product -> templates/product.json -> sections/main.liquid -> snippets/card.liquid
 *   page:search  -> templates/search.json  -> sections/results.liquid -(if)-> snippets/card.liquid
 *   snippets/unused.liquid -> snippets/card.liquid    (không trang nào dùng)
 */
const repository = () =>
  new InMemoryGraphRepository(
    '/themes/mau',
    [
      { id: 'page:product', kind: 'page_type' },
      { id: 'page:search', kind: 'page_type' },
      { id: 'templates/product.json', kind: 'template' },
      { id: 'templates/search.json', kind: 'template' },
      { id: 'sections/main.liquid', kind: 'section' },
      { id: 'sections/results.liquid', kind: 'section' },
      { id: 'snippets/card.liquid', kind: 'snippet' },
      { id: 'snippets/unused.liquid', kind: 'snippet' },
    ],
    [
      edge('page:product', 'templates/product.json', 'USES_TEMPLATE'),
      edge('page:search', 'templates/search.json', 'USES_TEMPLATE'),
      edge('templates/product.json', 'sections/main.liquid', 'RENDERS'),
      edge('templates/search.json', 'sections/results.liquid', 'RENDERS'),
      edge('sections/main.liquid', 'snippets/card.liquid', 'RENDERS'),
      edge('sections/results.liquid', 'snippets/card.liquid', 'RENDERS', true),
      edge('snippets/unused.liquid', 'snippets/card.liquid', 'RENDERS'),
    ],
  );

describe('service trên một GraphRepository trong bộ nhớ', () => {
  it('ImpactService tìm đúng trang, lối đi và file không nằm trên trang nào', () => {
    const result = new GraphScope(repository()).impact.findImpact('card');

    expect(result.target).toEqual({ id: 'snippets/card.liquid', kind: 'snippet' });
    expect(result.totalPages).toBe(2);
    expect(result.pages.map((page) => [page.id, page.certain, page.via])).toEqual([
      ['page:product', true, ['sections/main.liquid']],
      ['page:search', false, ['sections/results.liquid']],
    ]);
    expect(result.offPage).toEqual(['snippets/unused.liquid']);
  });

  it('NodeFinder hiểu tên trang thiếu tiền tố và gợi ý khi gõ sai', () => {
    const scope = new GraphScope(repository());

    expect(scope.nodes.find('product')).toEqual({ id: 'page:product', kind: 'page_type' });
    expect(() => scope.nodes.find('snippets/car')).toThrow(/Có phải ý bạn là: snippets\/card.liquid/);
  });

  it('SearchService xếp kết quả sát nhất trước', () => {
    const { hits } = new GraphScope(repository()).search.search('card');

    expect(hits[0]).toEqual({ id: 'snippets/card.liquid', kind: 'snippet', match: 'exact' });
  });
});
