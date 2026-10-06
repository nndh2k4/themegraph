import type { EdgeType, ExportedGraph, FlowNode, NodeKind } from '@themegraph/core';
import type { FileTreeNode } from '../src/graph-model.js';
import { describe, expect, it } from 'vitest';

import { deepestFile, defaultPage, flowStats, OPEN_DEPTH, opensByDefault } from '../src/flow-model.js';
import { KIND_LAYERS, layeredPositions, layoutGraph, MAX_PER_ROW, TREE_SIZE_SCALE } from '../src/graph-layout.js';
import {
  buildFileTree,
  DEFAULT_KINDS,
  dimColor,
  drawGraph,
  DRAWN_EDGE_TYPES,
  DRAWN_KINDS,
  filterFileTree,
  formatEdgeTypes,
  formatKinds,
  kindColor,
  neighborhood,
  nodeLabel,
  nodeSize,
  PAGES_FOLDER,
  parseEdgeTypes,
  parseKinds,
  searchNodes,
  toggleEdgeType,
  toggleKind,
} from '../src/graph-model.js';

const node = (id: string, kind: NodeKind) => ({ id, kind });
const edge = (from: string, to: string, type: EdgeType = 'RENDERS', conditional = false) => ({
  from,
  to,
  type,
  conditional,
  sources: 'liquid',
  count: 1,
});

/**
 * Đồ thị mẫu:
 *   page:index -> templates/index.json -> layout/theme.liquid -> assets/base.css
 *                                      -> sections/hero.liquid -> snippets/card.liquid -> snippets/price.liquid
 *                                                              -(if)-> snippets/badge.liquid
 *   sections/hero.liquid -> snippets/card.liquid còn một quan hệ thứ hai (tải bằng JavaScript, có điều kiện)
 *   snippets/menu.liquid tự gọi mình
 *   snippets/alone.liquid không ai gọi
 */
const SAMPLE: ExportedGraph = {
  nodes: [
    node('assets/base.css', 'asset'),
    node('config/settings_schema.json', 'config'),
    node('layout/theme.liquid', 'layout'),
    node('page:index', 'page_type'),
    node('sections/hero.liquid', 'section'),
    node('snippets/alone.liquid', 'snippet'),
    node('snippets/badge.liquid', 'snippet'),
    node('snippets/card.liquid', 'snippet'),
    node('snippets/menu.liquid', 'snippet'),
    node('snippets/price.liquid', 'snippet'),
    node('templates/index.json', 'template'),
  ],
  edges: [
    edge('layout/theme.liquid', 'assets/base.css', 'USES_ASSET'),
    edge('page:index', 'templates/index.json', 'USES_TEMPLATE'),
    edge('sections/hero.liquid', 'snippets/badge.liquid', 'RENDERS', true),
    edge('sections/hero.liquid', 'snippets/card.liquid', 'LOADS_SECTION', true),
    edge('sections/hero.liquid', 'snippets/card.liquid', 'RENDERS'),
    edge('snippets/card.liquid', 'snippets/price.liquid'),
    edge('snippets/menu.liquid', 'snippets/menu.liquid'),
    edge('templates/index.json', 'layout/theme.liquid', 'USES_LAYOUT'),
    edge('templates/index.json', 'sections/hero.liquid'),
  ],
};

const ids = (draw: { nodes: { id: string }[] }) => draw.nodes.map((entry) => entry.id);
const pairs = (draw: { edges: { from: string; to: string }[] }) => draw.edges.map((entry) => `${entry.from} -> ${entry.to}`);

describe('loại node của màn đồ thị', () => {
  it('bộ mặc định là mọi loại vẽ được trừ asset', () => {
    expect(DEFAULT_KINDS).toEqual(['page_type', 'template', 'layout', 'section_group', 'section', 'block', 'snippet']);
    expect(DRAWN_KINDS).toEqual([...DEFAULT_KINDS, 'asset']);
  });

  it('parseKinds: rỗng là bộ mặc định; còn lại giữ loại hợp lệ, theo thứ tự chuẩn, không trùng', () => {
    expect(parseKinds('')).toEqual(DEFAULT_KINDS);
    expect(parseKinds('   ')).toEqual(DEFAULT_KINDS);
    expect(parseKinds('snippet,section')).toEqual(['section', 'snippet']);
    expect(parseKinds(' snippet , snippet,asset')).toEqual(['snippet', 'asset']);
    // Loại lạ và loại không vẽ được bị bỏ; không còn gì thì là danh sách rỗng, không phải bộ mặc định.
    expect(parseKinds('snippet,khong-co,setting,locale')).toEqual(['snippet']);
    expect(parseKinds('khong-co')).toEqual([]);
  });

  it('parseKinds trả một mảng mới mỗi lần, không phải chính bộ mặc định', () => {
    const first = parseKinds('');
    first.pop();

    expect(parseKinds('')).toEqual(DEFAULT_KINDS);
  });

  it('formatKinds: bộ mặc định thành chuỗi rỗng, còn lại theo thứ tự chuẩn', () => {
    expect(formatKinds(DEFAULT_KINDS)).toBe('');
    expect(formatKinds([...DEFAULT_KINDS].reverse())).toBe('');
    expect(formatKinds(['snippet', 'section'])).toBe('section,snippet');
    expect(formatKinds(DRAWN_KINDS)).toBe('page_type,template,layout,section_group,section,block,snippet,asset');
    // Thiếu một loại so với mặc định, hoặc cùng số lượng nhưng khác loại, đều không phải mặc định.
    expect(formatKinds(DEFAULT_KINDS.slice(1))).toBe('template,layout,section_group,section,block,snippet');
    expect(formatKinds([...DEFAULT_KINDS.slice(1), 'asset'])).toBe('template,layout,section_group,section,block,snippet,asset');
  });

  it('formatKinds: phần đầu của bộ mặc định không phải là bộ mặc định', () => {
    expect(formatKinds(['page_type'])).toBe('page_type');
    expect(formatKinds(['page_type', 'template', 'layout'])).toBe('page_type,template,layout');
  });

  it('bỏ chọn hết có cách viết riêng, để không bị đọc lại thành bộ mặc định', () => {
    expect(formatKinds([])).toBe('none');
    expect(parseKinds('none')).toEqual([]);
    // Bỏ chọn ô cuối cùng rồi đọc lại địa chỉ: vẫn là không có ô nào.
    expect(parseKinds(formatKinds(toggleKind(['asset'], 'asset')))).toEqual([]);
  });

  it('formatKinds và parseKinds đọc lại được nhau', () => {
    for (const kinds of [DEFAULT_KINDS, DRAWN_KINDS, ['asset'], ['section', 'snippet'], []] as NodeKind[][]) {
      expect(parseKinds(formatKinds(kinds))).toEqual(kinds);
    }
  });

  it('toggleKind bật loại đang tắt, tắt loại đang bật, giữ thứ tự chuẩn', () => {
    expect(toggleKind(['section', 'snippet'], 'snippet')).toEqual(['section']);
    expect(toggleKind(['section', 'snippet'], 'page_type')).toEqual(['page_type', 'section', 'snippet']);
    expect(toggleKind([], 'asset')).toEqual(['asset']);
  });

  it('mỗi loại vẽ được có một màu riêng; loại lạ vẫn có màu', () => {
    const colors = DRAWN_KINDS.map(kindColor);

    expect(new Set(colors).size).toBe(DRAWN_KINDS.length);
    expect(kindColor('khong-co')).toMatch(/^#[0-9a-f]{6}$/);
    expect(colors).not.toContain(kindColor('khong-co'));
  });
});

describe('nodeLabel và nodeSize', () => {
  it('bỏ thư mục và đuôi .liquid / .json; trang bỏ tiền tố; asset giữ đuôi', () => {
    expect(nodeLabel('snippets/card-product.liquid', 'snippet')).toBe('card-product');
    expect(nodeLabel('templates/customers/login.json', 'template')).toBe('customers/login');
    expect(nodeLabel('templates/product.alt.json', 'template')).toBe('product.alt');
    expect(nodeLabel('page:customers/login', 'page_type')).toBe('customers/login');
    expect(nodeLabel('assets/base.css', 'asset')).toBe('base.css');
    expect(nodeLabel('assets/icon.liquid', 'asset')).toBe('icon.liquid');
    // Chỉ bỏ đuôi ở CUỐI tên.
    expect(nodeLabel('snippets/icon.json.liquid', 'snippet')).toBe('icon.json');
  });

  it('cỡ lớn dần theo số nơi gọi, có sàn và trần', () => {
    expect(nodeSize(0)).toBe(4);
    expect(nodeSize(1)).toBe(6);
    expect(nodeSize(16)).toBe(12);
    expect(nodeSize(49)).toBe(18);
    expect(nodeSize(10000)).toBe(18);
  });
});

describe('neighborhood', () => {
  const EDGES = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'x', to: 'b' },
    { from: 'c', to: 'a' },
  ];

  it('đi theo cạnh ở cả hai chiều, gồm cả node tâm', () => {
    expect([...neighborhood(EDGES, 'b', 1)].sort()).toEqual(['a', 'b', 'c', 'x']);
  });

  it('dừng đúng ở số bước được cho', () => {
    expect([...neighborhood(EDGES, 'x', 0)]).toEqual(['x']);
    expect([...neighborhood(EDGES, 'x', 1)].sort()).toEqual(['b', 'x']);
    expect([...neighborhood(EDGES, 'x', 2)].sort()).toEqual(['a', 'b', 'c', 'x']);
    expect([...neighborhood(EDGES, 'x', 3)].sort()).toEqual(['a', 'b', 'c', 'd', 'x']);
  });

  it('có vòng thì vẫn dừng; node không có cạnh thì chỉ có chính nó', () => {
    expect([...neighborhood(EDGES, 'a', 99)].sort()).toEqual(['a', 'b', 'c', 'd', 'x']);
    expect([...neighborhood(EDGES, 'khong-co', 5)]).toEqual(['khong-co']);
  });
});

describe('drawGraph', () => {
  it('chỉ vẽ node thuộc loại đang chọn, và cạnh còn cả hai đầu', () => {
    const draw = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS });

    expect(ids(draw)).toEqual([
      'layout/theme.liquid',
      'page:index',
      'sections/hero.liquid',
      'snippets/alone.liquid',
      'snippets/badge.liquid',
      'snippets/card.liquid',
      'snippets/menu.liquid',
      'snippets/price.liquid',
      'templates/index.json',
    ]);
    // Cạnh tới assets/base.css rơi mất vì asset đang tắt.
    expect(pairs(draw)).toEqual([
      'page:index -> templates/index.json',
      'sections/hero.liquid -> snippets/badge.liquid',
      'sections/hero.liquid -> snippets/card.liquid',
      'snippets/card.liquid -> snippets/price.liquid',
      'templates/index.json -> layout/theme.liquid',
      'templates/index.json -> sections/hero.liquid',
    ]);
    expect(draw.available).toBe(9);
    expect(draw.center).toBeNull();
  });

  it('bật asset thì có thêm node và cạnh của nó; loại không vẽ được không bao giờ hiện', () => {
    const draw = drawGraph(SAMPLE, { kinds: DRAWN_KINDS });

    expect(ids(draw)).toContain('assets/base.css');
    expect(ids(draw)).not.toContain('config/settings_schema.json');
    expect(pairs(draw)).toContain('layout/theme.liquid -> assets/base.css');
    expect(draw.available).toBe(10);
  });

  it('bỏ cạnh tự trỏ vào chính nó, nhưng vẫn giữ node', () => {
    const draw = drawGraph(SAMPLE, { kinds: ['snippet'] });

    expect(ids(draw)).toContain('snippets/menu.liquid');
    expect(pairs(draw)).toEqual(['snippets/card.liquid -> snippets/price.liquid']);
  });

  it('gộp các quan hệ cùng hai đầu thành một cạnh; chỉ là có điều kiện khi mọi quan hệ đều có điều kiện', () => {
    const draw = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS });
    const merged = draw.edges.find((entry) => entry.to === 'snippets/card.liquid');
    const single = draw.edges.find((entry) => entry.to === 'snippets/badge.liquid');

    expect(merged).toEqual({
      key: 'sections/hero.liquid\nsnippets/card.liquid',
      from: 'sections/hero.liquid',
      to: 'snippets/card.liquid',
      types: ['LOADS_SECTION', 'RENDERS'],
      conditional: false,
    });
    expect(single).toMatchObject({ types: ['RENDERS'], conditional: true });
  });

  it('hai quan hệ đều có điều kiện thì cạnh gộp có điều kiện, bất kể thứ tự', () => {
    const both: ExportedGraph = {
      nodes: [node('snippets/a.liquid', 'snippet'), node('snippets/b.liquid', 'snippet')],
      edges: [
        edge('snippets/a.liquid', 'snippets/b.liquid', 'LOADS_SECTION', true),
        edge('snippets/a.liquid', 'snippets/b.liquid', 'RENDERS', true),
      ],
    };
    const mixed: ExportedGraph = { ...both, edges: [both.edges[1]!, { ...both.edges[0]!, conditional: false }] };

    expect(drawGraph(both, { kinds: ['snippet'] }).edges[0]?.conditional).toBe(true);
    expect(drawGraph(mixed, { kinds: ['snippet'] }).edges[0]).toMatchObject({
      conditional: false,
      types: ['LOADS_SECTION', 'RENDERS'],
    });
  });

  it('hai chiều ngược nhau là hai cạnh riêng', () => {
    const cycle: ExportedGraph = {
      nodes: [node('snippets/a.liquid', 'snippet'), node('snippets/b.liquid', 'snippet')],
      edges: [edge('snippets/a.liquid', 'snippets/b.liquid'), edge('snippets/b.liquid', 'snippets/a.liquid')],
    };

    expect(pairs(drawGraph(cycle, { kinds: ['snippet'] }))).toEqual([
      'snippets/a.liquid -> snippets/b.liquid',
      'snippets/b.liquid -> snippets/a.liquid',
    ]);
  });

  it('mỗi node mang nhãn, màu và cỡ theo số nơi gọi đang hiện', () => {
    const draw = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS });
    const card = draw.nodes.find((entry) => entry.id === 'snippets/card.liquid');
    const alone = draw.nodes.find((entry) => entry.id === 'snippets/alone.liquid');

    // Hai quan hệ từ hero tới card đã gộp, nên card chỉ có MỘT nơi gọi.
    expect(card).toEqual({
      id: 'snippets/card.liquid',
      kind: 'snippet',
      label: 'card',
      color: kindColor('snippet'),
      size: nodeSize(1),
      callers: 1,
    });
    expect(alone).toMatchObject({ callers: 0, size: nodeSize(0) });
  });

  it('số nơi gọi chỉ đếm node đang hiện', () => {
    const all = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS });
    const snippetsOnly = drawGraph(SAMPLE, { kinds: ['snippet'] });
    const callersOf = (draw: typeof all, id: string) => draw.nodes.find((entry) => entry.id === id)?.callers;

    expect(callersOf(all, 'snippets/card.liquid')).toBe(1);
    // Section đang tắt: không còn ai đang hiện gọi tới card.
    expect(callersOf(snippetsOnly, 'snippets/card.liquid')).toBe(0);
    expect(callersOf(snippetsOnly, 'snippets/price.liquid')).toBe(1);
  });

  it('không loại nào được chọn thì không vẽ gì', () => {
    expect(drawGraph(SAMPLE, { kinds: [] })).toEqual({ nodes: [], edges: [], available: 0, center: null });
  });

  it('kết quả không phụ thuộc thứ tự của dữ liệu vào', () => {
    const shuffled: ExportedGraph = { nodes: [...SAMPLE.nodes].reverse(), edges: [...SAMPLE.edges].reverse() };

    expect(drawGraph(shuffled, { kinds: DRAWN_KINDS })).toEqual(drawGraph(SAMPLE, { kinds: DRAWN_KINDS }));
  });

  it('không sửa dữ liệu được đưa vào', () => {
    const before = JSON.stringify(SAMPLE);
    drawGraph(SAMPLE, { kinds: DRAWN_KINDS, center: 'snippets/card.liquid' });

    expect(JSON.stringify(SAMPLE)).toBe(before);
  });
});

describe('drawGraph — thu về lân cận của một node', () => {
  it('chỉ giữ node tâm, những gì gọi nó và những gì nó gọi', () => {
    const draw = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS, center: 'snippets/card.liquid' });

    expect(ids(draw)).toEqual(['sections/hero.liquid', 'snippets/card.liquid', 'snippets/price.liquid']);
    expect(pairs(draw)).toEqual(['sections/hero.liquid -> snippets/card.liquid', 'snippets/card.liquid -> snippets/price.liquid']);
    expect(draw.center).toBe('snippets/card.liquid');
    // available vẫn là số node của các loại đang chọn trong cả theme.
    expect(draw.available).toBe(9);
  });

  it('giữ cả cạnh nối các node lân cận với nhau', () => {
    const draw = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS, center: 'sections/hero.liquid' });

    expect(ids(draw)).toEqual(['sections/hero.liquid', 'snippets/badge.liquid', 'snippets/card.liquid', 'templates/index.json']);
    expect(pairs(draw)).toHaveLength(3);
  });

  it('depth mở rộng lân cận; mặc định là một bước', () => {
    const one = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS, center: 'snippets/price.liquid' });
    const two = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS, center: 'snippets/price.liquid', depth: 2 });

    expect(ids(one)).toEqual(['snippets/card.liquid', 'snippets/price.liquid']);
    expect(ids(two)).toEqual(['sections/hero.liquid', 'snippets/card.liquid', 'snippets/price.liquid']);
  });

  it('số nơi gọi tính trên phần lân cận đang hiện', () => {
    const draw = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS, center: 'snippets/price.liquid' });

    expect(draw.nodes.map((entry) => [entry.id, entry.callers])).toEqual([
      ['snippets/card.liquid', 0],
      ['snippets/price.liquid', 1],
    ]);
  });

  it('node tâm luôn được vẽ, kể cả khi loại của nó đang tắt', () => {
    const draw = drawGraph(SAMPLE, { kinds: ['layout'], center: 'assets/base.css' });

    expect(ids(draw)).toEqual(['assets/base.css', 'layout/theme.liquid']);
    expect(draw.center).toBe('assets/base.css');
    // Node tâm không thuộc loại đang chọn nên không tính vào available.
    expect(draw.available).toBe(1);
  });

  it('node tâm không có trong theme thì bỏ qua, vẽ như không có tâm', () => {
    const draw = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS, center: 'snippets/khong-co.liquid' });

    expect(draw.center).toBeNull();
    expect(ids(draw)).toHaveLength(9);
  });

  it('node tâm không có quan hệ nào thì chỉ còn một mình nó', () => {
    const draw = drawGraph(SAMPLE, { kinds: DEFAULT_KINDS, center: 'snippets/alone.liquid' });

    expect(ids(draw)).toEqual(['snippets/alone.liquid']);
    expect(draw.edges).toEqual([]);
  });
});

describe('layoutGraph', () => {
  const draw = drawGraph(SAMPLE, { kinds: DRAWN_KINDS });

  it('dựng đủ node và cạnh, mang theo thuộc tính để vẽ', () => {
    const graph = layoutGraph(draw);

    expect(graph.order).toBe(draw.nodes.length);
    expect(graph.size).toBe(draw.edges.length);
    expect(graph.getNodeAttributes('snippets/card.liquid')).toMatchObject({
      label: 'card',
      kind: 'snippet',
      color: kindColor('snippet'),
      size: nodeSize(1),
    });
    expect(graph.getEdgeAttributes('sections/hero.liquid\nsnippets/card.liquid')).toEqual({
      conditional: false,
      types: 'LOADS_SECTION,RENDERS',
    });
    expect(graph.getEdgeAttribute('sections/hero.liquid\nsnippets/badge.liquid', 'conditional')).toBe(true);
    expect(graph.source('sections/hero.liquid\nsnippets/card.liquid')).toBe('sections/hero.liquid');
    expect(graph.target('sections/hero.liquid\nsnippets/card.liquid')).toBe('snippets/card.liquid');
  });

  it('mọi node có toạ độ hữu hạn, và không hai node nào trùng chỗ', () => {
    const graph = layoutGraph(draw);
    const positions = graph.mapNodes((_, attributes) => `${attributes.x.toFixed(3)},${attributes.y.toFixed(3)}`);

    graph.forEachNode((_, attributes) => {
      expect(Number.isFinite(attributes.x)).toBe(true);
      expect(Number.isFinite(attributes.y)).toBe(true);
    });
    expect(new Set(positions).size).toBe(graph.order);
  });

  it('cùng một đồ thị luôn ra cùng một hình', () => {
    const first = layoutGraph(draw).export();
    const second = layoutGraph(drawGraph(SAMPLE, { kinds: DRAWN_KINDS })).export();

    expect(second).toEqual(first);
  });

  it('kéo hai file gọi nhau lại gần hơn so với vị trí ban đầu', () => {
    const distance = (graph: ReturnType<typeof layoutGraph>, a: string, b: string): number => {
      const from = graph.getNodeAttributes(a);
      const to = graph.getNodeAttributes(b);
      return Math.hypot(from.x - to.x, from.y - to.y);
    };
    // 0 vòng: giữ nguyên vòng tròn ban đầu.
    const before = layoutGraph(draw, 'force', 0);
    const after = layoutGraph(draw);

    // page:index và templates/index.json nằm xa nhau trên vòng tròn (thứ tự theo id) nhưng có cạnh nối.
    expect(distance(after, 'page:index', 'templates/index.json')).toBeLessThan(distance(before, 'page:index', 'templates/index.json'));
  });

  it('0 vòng thì các node nằm trên một vòng tròn quanh gốc toạ độ', () => {
    const graph = layoutGraph(draw, 'force', 0);
    const radii = graph.mapNodes((_, attributes) => Math.hypot(attributes.x, attributes.y));

    for (const radius of radii) expect(radius).toBeCloseTo(radii[0]!, 6);
    expect(radii[0]).toBeGreaterThan(0);
  });

  it('đồ thị rỗng, một node, và không có cạnh đều không làm hỏng', () => {
    const empty = layoutGraph(drawGraph(SAMPLE, { kinds: [] }));
    const single = layoutGraph(drawGraph(SAMPLE, { kinds: DEFAULT_KINDS, center: 'snippets/alone.liquid' }));
    const noEdges = layoutGraph(drawGraph(SAMPLE, { kinds: ['layout', 'page_type'] }));

    expect(empty.order).toBe(0);
    expect(single.order).toBe(1);
    expect(Number.isFinite(single.getNodeAttribute('snippets/alone.liquid', 'x'))).toBe(true);
    expect(noEdges.order).toBe(2);
    expect(noEdges.size).toBe(0);
    noEdges.forEachNode((_, attributes) => expect(Number.isFinite(attributes.x + attributes.y)).toBe(true));
  });
});

describe('flow-model', () => {
  const flowNode = (id: string, depth: number, extra: Partial<FlowNode> = {}): FlowNode => ({
    id,
    kind: 'snippet',
    depth,
    edge: depth === 0 ? null : 'RENDERS',
    conditional: false,
    count: depth === 0 ? 0 : 1,
    repeated: false,
    hidden: 0,
    children: [],
    ...extra,
  });

  it('defaultPage: trang chủ nếu có, không thì trang đầu, không có trang nào thì null', () => {
    expect(defaultPage(['404', 'cart', 'index', 'product'])).toBe('index');
    expect(defaultPage(['404', 'cart'])).toBe('404');
    expect(defaultPage([])).toBeNull();
  });

  it('opensByDefault: mở sẵn các tầng trên, và chỉ node có con', () => {
    const child = flowNode('c', 1);

    expect(OPEN_DEPTH).toBe(2);
    expect(opensByDefault(flowNode('a', 0, { children: [child] }))).toBe(true);
    expect(opensByDefault(flowNode('a', 1, { children: [child] }))).toBe(true);
    expect(opensByDefault(flowNode('a', 2, { children: [child] }))).toBe(false);
    expect(opensByDefault(flowNode('a', 0))).toBe(false);
  });

  it('deepestFile: tầng của file xa nhất, không phụ thuộc thứ tự; không có file thì là 0', () => {
    expect(deepestFile([{ depth: 1 }, { depth: 5 }, { depth: 2 }])).toBe(5);
    expect(deepestFile([{ depth: 5 }, { depth: 1 }])).toBe(5);
    expect(deepestFile([])).toBe(0);
  });

  it('flowStats đếm dòng, dòng lặp và dòng có điều kiện', () => {
    const tree = flowNode('page:index', 0, {
      children: [
        flowNode('templates/index.json', 1, {
          children: [
            flowNode('sections/hero.liquid', 2, {
              children: [flowNode('snippets/card.liquid', 3, { conditional: true }), flowNode('snippets/price.liquid', 3)],
            }),
            flowNode('snippets/card.liquid', 2, { repeated: true, conditional: true }),
          ],
        }),
      ],
    });

    expect(flowStats(tree)).toEqual({ rows: 6, repeated: 1, conditional: 2 });
    expect(flowStats(flowNode('page:index', 0))).toEqual({ rows: 1, repeated: 0, conditional: 0 });
  });
});

describe('searchNodes', () => {
  const NODES = [
    node('assets/card.js', 'asset'),
    node('blocks/card.liquid', 'block'),
    node('config/card.json', 'config'),
    node('layout/theme.liquid', 'layout'),
    node('page:product', 'page_type'),
    node('sections/header.liquid', 'section'),
    node('sections/main-product.liquid', 'section'),
    node('snippets/card-product.liquid', 'snippet'),
    node('snippets/card.liquid', 'snippet'),
    node('snippets/product-card-wide.liquid', 'snippet'),
    node('templates/product.json', 'template'),
  ];
  const found = (query: string) => searchNodes(NODES, query).map((hit) => hit.id);

  it('từ khoá rỗng hoặc toàn khoảng trắng thì không có kết quả', () => {
    expect(found('')).toEqual([]);
    expect(found('   ')).toEqual([]);
  });

  it('trả id, loại và tên ngắn của node', () => {
    expect(searchNodes(NODES, 'header')).toEqual([{ id: 'sections/header.liquid', kind: 'section', label: 'header' }]);
  });

  it('tên bắt đầu bằng từ khoá đứng trước (ngắn hơn trước), rồi tới tên chỉ chứa từ khoá', () => {
    expect(found('card')).toEqual([
      // Tên đúng bằng "card" là ngắn nhất; hai file cùng tên xếp theo id.
      'blocks/card.liquid',
      'snippets/card.liquid',
      'assets/card.js',
      'snippets/card-product.liquid',
      // Chỉ chứa "card".
      'snippets/product-card-wide.liquid',
    ]);
  });

  it('không phân biệt hoa thường, bỏ khoảng trắng thừa', () => {
    expect(found('  HEADER ')).toEqual(['sections/header.liquid']);
  });

  it('tên file viết hoa vẫn được xếp hạng như tên viết thường', () => {
    const mixed = [node('snippets/a-card-x.liquid', 'snippet'), node('snippets/Card-Longer-Name.liquid', 'snippet')];

    // "Card-Longer-Name" bắt đầu bằng từ khoá nên đứng trước, dù tên dài hơn.
    expect(searchNodes(mixed, 'card').map((hit) => hit.id)).toEqual(['snippets/Card-Longer-Name.liquid', 'snippets/a-card-x.liquid']);
  });

  it('khớp bằng tên đứng trước khớp nhờ tên thư mục, dù tên dài hơn', () => {
    const nodes = [node('sections/a.liquid', 'section'), node('snippets/all-sections.liquid', 'snippet')];

    expect(searchNodes(nodes, 'sections').map((hit) => hit.id)).toEqual(['snippets/all-sections.liquid', 'sections/a.liquid']);
  });

  it('kết quả không phụ thuộc thứ tự của danh sách đưa vào', () => {
    expect(searchNodes([...NODES].reverse(), 'card')).toEqual(searchNodes(NODES, 'card'));
    expect(searchNodes([...NODES].reverse(), 'product')).toEqual(searchNodes(NODES, 'product'));
  });

  it('nhiều từ: node phải chứa mọi từ, theo thứ tự nào cũng được', () => {
    expect(found('product card')).toEqual(['snippets/card-product.liquid', 'snippets/product-card-wide.liquid']);
    expect(found('card   product')).toEqual(['snippets/card-product.liquid', 'snippets/product-card-wide.liquid']);
    expect(found('card khong-co')).toEqual([]);
  });

  it('gõ kèm tên thư mục để thu hẹp theo loại file; kết quả đó đứng sau kết quả khớp bằng tên', () => {
    expect(found('snippets card')).toEqual([
      'snippets/card.liquid',
      'snippets/card-product.liquid',
      'snippets/product-card-wide.liquid',
    ]);
    expect(found('sections')).toEqual(['sections/header.liquid', 'sections/main-product.liquid']);
    // "product" khớp bằng tên với nhiều file; sections/main-product khớp bằng tên (hạng 2), không phải nhờ thư mục.
    expect(found('product')).toEqual([
      'page:product',
      'templates/product.json',
      'snippets/product-card-wide.liquid',
      // Hai tên dài bằng nhau: xếp theo id.
      'sections/main-product.liquid',
      'snippets/card-product.liquid',
    ]);
  });

  it('tìm cả trong loại đang tắt trên hình (asset), nhưng không tìm loại không vẽ được', () => {
    expect(found('card.js')).toEqual(['assets/card.js']);
    expect(found('card.json')).toEqual([]);
    expect(found('config')).toEqual([]);
  });

  it('tìm được trang bằng tên và bằng tiền tố page:', () => {
    expect(found('page:product')).toEqual(['page:product']);
    expect(found('theme')).toEqual(['layout/theme.liquid']);
  });

  it('không sửa danh sách được đưa vào', () => {
    const before = JSON.stringify(NODES);
    searchNodes(NODES, 'card');

    expect(JSON.stringify(NODES)).toBe(before);
  });
});

describe('loại quan hệ của màn đồ thị', () => {
  it('parseEdgeTypes: rỗng là tất cả; còn lại giữ loại hợp lệ theo thứ tự chuẩn', () => {
    expect(DRAWN_EDGE_TYPES).toEqual(['USES_TEMPLATE', 'USES_LAYOUT', 'RENDERS', 'LOADS_SECTION', 'USES_ASSET']);
    expect(parseEdgeTypes('')).toEqual(DRAWN_EDGE_TYPES);
    expect(parseEdgeTypes('  ')).toEqual(DRAWN_EDGE_TYPES);
    expect(parseEdgeTypes('USES_ASSET,RENDERS,RENDERS')).toEqual(['RENDERS', 'USES_ASSET']);
    expect(parseEdgeTypes(' USES_ASSET , RENDERS ')).toEqual(['RENDERS', 'USES_ASSET']);
    expect(parseEdgeTypes('RENDERS,READS_SETTING,khong-co')).toEqual(['RENDERS']);
    expect(parseEdgeTypes('none')).toEqual([]);
  });

  it('parseEdgeTypes trả một mảng mới mỗi lần', () => {
    parseEdgeTypes('').pop();

    expect(parseEdgeTypes('')).toEqual(DRAWN_EDGE_TYPES);
  });

  it('formatEdgeTypes: đủ mọi loại là chuỗi rỗng, không loại nào là "none"', () => {
    expect(formatEdgeTypes(DRAWN_EDGE_TYPES)).toBe('');
    expect(formatEdgeTypes([...DRAWN_EDGE_TYPES].reverse())).toBe('');
    expect(formatEdgeTypes(['USES_ASSET', 'RENDERS'])).toBe('RENDERS,USES_ASSET');
    expect(formatEdgeTypes(DRAWN_EDGE_TYPES.slice(1))).toBe('USES_LAYOUT,RENDERS,LOADS_SECTION,USES_ASSET');
    expect(formatEdgeTypes([])).toBe('none');
  });

  it('formatEdgeTypes và parseEdgeTypes đọc lại được nhau', () => {
    for (const types of [DRAWN_EDGE_TYPES, ['RENDERS'], ['USES_TEMPLATE', 'USES_ASSET'], []] as EdgeType[][]) {
      expect(parseEdgeTypes(formatEdgeTypes(types))).toEqual(types);
    }
  });

  it('toggleEdgeType bật loại đang tắt, tắt loại đang bật, giữ thứ tự chuẩn', () => {
    expect(toggleEdgeType(['RENDERS', 'USES_ASSET'], 'RENDERS')).toEqual(['USES_ASSET']);
    expect(toggleEdgeType(['USES_ASSET'], 'USES_TEMPLATE')).toEqual(['USES_TEMPLATE', 'USES_ASSET']);
  });

  it('drawGraph chỉ vẽ quan hệ thuộc loại đang chọn; không nêu thì vẽ mọi loại', () => {
    const all = drawGraph(SAMPLE, { kinds: DRAWN_KINDS });
    const rendersOnly = drawGraph(SAMPLE, { kinds: DRAWN_KINDS, edgeTypes: ['RENDERS'] });
    const none = drawGraph(SAMPLE, { kinds: DRAWN_KINDS, edgeTypes: [] });

    expect(pairs(drawGraph(SAMPLE, { kinds: DRAWN_KINDS, edgeTypes: DRAWN_EDGE_TYPES }))).toEqual(pairs(all));
    expect(pairs(rendersOnly)).toEqual([
      'sections/hero.liquid -> snippets/badge.liquid',
      'sections/hero.liquid -> snippets/card.liquid',
      'snippets/card.liquid -> snippets/price.liquid',
      'templates/index.json -> sections/hero.liquid',
    ]);
    // Node vẫn còn đủ; chỉ cạnh mất.
    expect(ids(rendersOnly)).toEqual(ids(all));
    expect(none.edges).toEqual([]);
    expect(ids(none)).toEqual(ids(all));
  });

  it('lọc loại quan hệ xảy ra trước khi gộp: cạnh gộp chỉ mang loại còn lại', () => {
    const draw = drawGraph(SAMPLE, { kinds: DRAWN_KINDS, edgeTypes: ['LOADS_SECTION'] });

    // hero -> card có hai quan hệ; chỉ còn quan hệ tải bằng JavaScript, vốn có điều kiện.
    expect(draw.edges).toEqual([
      {
        key: 'sections/hero.liquid\nsnippets/card.liquid',
        from: 'sections/hero.liquid',
        to: 'snippets/card.liquid',
        types: ['LOADS_SECTION'],
        conditional: true,
      },
    ]);
  });

  it('lân cận của một node tính trên các quan hệ đang chọn', () => {
    const draw = drawGraph(SAMPLE, { kinds: DRAWN_KINDS, edgeTypes: ['USES_ASSET'], center: 'layout/theme.liquid' });

    // Với mọi loại quan hệ thì còn templates/index.json; ở đây chỉ còn asset nó dùng.
    expect(ids(draw)).toEqual(['assets/base.css', 'layout/theme.liquid']);
  });
});

describe('dimColor', () => {
  it('trộn màu với nền theo tỉ lệ', () => {
    expect(dimColor('#ffffff', '#000000', 1)).toBe('#ffffff');
    expect(dimColor('#ffffff', '#000000', 0)).toBe('#000000');
    expect(dimColor('#ff8000', '#000000', 0.5)).toBe('#804000');
    // Nền không đen: mỗi kênh đi từ nền về phía màu.
    expect(dimColor('#f43f5e', '#06060a', 0.25)).toBe('#42141f');
    // Kênh nhỏ vẫn đủ hai chữ số.
    expect(dimColor('#0a0000', '#000000', 0.5)).toBe('#050000');
  });
});

describe('buildFileTree', () => {
  const NODES = [
    node('assets/base.css', 'asset'),
    node('config/settings_schema.json', 'config'),
    node('layout/theme.liquid', 'layout'),
    node('page:customers/login', 'page_type'),
    node('page:index', 'page_type'),
    node('sections/hero.liquid', 'section'),
    node('snippets/card.liquid', 'snippet'),
    node('templates/customers/login.json', 'template'),
    node('templates/index.json', 'template'),
    node('templates/404.json', 'template'),
  ];
  /** Viết cây thành các dòng thụt lề: "thư mục/ (số file)" hoặc "file". */
  const outline = (tree: readonly FileTreeNode[], level = 0): string[] =>
    tree.flatMap((entry) => [
      '  '.repeat(level) + (entry.id === null ? `${entry.name}/ (${entry.files})` : entry.name),
      ...outline(entry.children, level + 1),
    ]);

  it('xếp file theo thư mục của theme; thư mục ảo của các trang đứng đầu; thư mục trước file', () => {
    expect(outline(buildFileTree(NODES))).toEqual([
      'trang/ (2)',
      '  customers/ (1)',
      '    login',
      '  index',
      'assets/ (1)',
      '  base.css',
      'layout/ (1)',
      '  theme.liquid',
      'sections/ (1)',
      '  hero.liquid',
      'snippets/ (1)',
      '  card.liquid',
      'templates/ (3)',
      '  customers/ (1)',
      '    login.json',
      '  404.json',
      '  index.json',
    ]);
    expect(PAGES_FOLDER).toBe('trang');
  });

  it('dòng file mang id và loại của node; dòng thư mục thì không', () => {
    const tree = buildFileTree(NODES);
    const pages = tree[0];
    const templates = tree.find((entry) => entry.name === 'templates');

    expect(pages).toMatchObject({ name: 'trang', path: 'trang', id: null, kind: null, files: 2 });
    expect(pages?.children[1]).toEqual({ name: 'index', path: 'page:index', id: 'page:index', kind: 'page_type', children: [], files: 1 });
    expect(templates?.children[0]).toMatchObject({ name: 'customers', path: 'templates/customers', id: null });
    expect(templates?.children[0]?.children[0]).toMatchObject({ id: 'templates/customers/login.json', kind: 'template' });
  });

  it('bỏ loại không vẽ được; không phụ thuộc thứ tự đầu vào; danh sách rỗng ra cây rỗng', () => {
    expect(outline(buildFileTree(NODES)).join('\n')).not.toContain('config');
    expect(buildFileTree([...NODES].reverse())).toEqual(buildFileTree(NODES));
    expect(buildFileTree([])).toEqual([]);
  });

  it('hai thư mục cùng tên ở hai nơi là hai thư mục riêng', () => {
    const tree = buildFileTree(NODES);
    const underPages = tree[0]?.children[0];
    const underTemplates = tree.find((entry) => entry.name === 'templates')?.children[0];

    expect(underPages?.path).toBe('trang/customers');
    expect(underTemplates?.path).toBe('templates/customers');
  });

  it('filterFileTree: giữ file có đường dẫn chứa mọi từ, và thư mục còn file bên dưới', () => {
    const tree = buildFileTree(NODES);

    expect(outline(filterFileTree(tree, 'LOGIN'))).toEqual([
      'trang/ (1)',
      '  customers/ (1)',
      '    login',
      'templates/ (1)',
      '  customers/ (1)',
      '    login.json',
    ]);
    // Từ khoá khớp cả tên thư mục: "templates index" chỉ ra file trong templates/.
    expect(outline(filterFileTree(tree, 'templates  index'))).toEqual(['templates/ (1)', '  index.json']);
    expect(filterFileTree(tree, 'khong-co')).toEqual([]);
  });

  it('một trang và một thư mục trang cùng tên đứng cạnh nhau, không gộp vào nhau', () => {
    const tree = buildFileTree([node('page:blog', 'page_type'), node('page:blog/tagged', 'page_type')]);

    expect(outline(tree)).toEqual(['trang/ (2)', '  blog/ (1)', '    tagged', '  blog']);
  });

  it('filterFileTree không phân biệt hoa thường ở cả từ khoá lẫn tên file', () => {
    const tree = buildFileTree([node('snippets/Card-Big.liquid', 'snippet'), node('snippets/price.liquid', 'snippet')]);

    expect(outline(filterFileTree(tree, 'card-big'))).toEqual(['snippets/ (1)', '  Card-Big.liquid']);
    expect(outline(filterFileTree(tree, 'CARD'))).toEqual(['snippets/ (1)', '  Card-Big.liquid']);
  });

  it('filterFileTree: từ khoá rỗng trả nguyên cây, và không sửa cây gốc', () => {
    const tree = buildFileTree(NODES);
    const before = JSON.stringify(tree);

    expect(filterFileTree(tree, '   ')).toEqual(tree);
    filterFileTree(tree, 'login');
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('bố cục theo tầng', () => {
  const draw = drawGraph(SAMPLE, { kinds: DRAWN_KINDS });
  const positions = layeredPositions(draw);
  const at = (id: string) => positions.get(id) ?? { x: NaN, y: NaN };

  it('mỗi loại node một tầng, đi từ trang xuống asset', () => {
    expect(KIND_LAYERS).toEqual({ page_type: 0, template: 1, layout: 2, section_group: 2, section: 3, block: 4, snippet: 5, asset: 6 });
    expect(positions.size).toBe(draw.nodes.length);

    const order = ['page:index', 'templates/index.json', 'layout/theme.liquid', 'sections/hero.liquid', 'snippets/card.liquid', 'assets/base.css'];
    for (let i = 1; i < order.length; i++) expect(at(order[i]!).y).toBeGreaterThan(at(order[i - 1]!).y);
  });

  it('các node cùng loại nằm trên cùng một hàng, cách đều, canh giữa quanh 0', () => {
    const snippets = draw.nodes.filter((entry) => entry.kind === 'snippet').map((entry) => at(entry.id));
    const xs = snippets.map((position) => position.x).sort((a, b) => a - b);

    expect(new Set(snippets.map((position) => position.y)).size).toBe(1);
    expect(xs.length).toBe(5);
    expect(xs[0]! + xs[4]!).toBeCloseTo(0, 6);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(xs[1]! - xs[0]!, 6);
    expect(xs[1]! - xs[0]!).toBeGreaterThan(0);
  });

  it('node được xếp gần những node gọi nó ở tầng trên; node không ai gọi đứng cuối tầng, theo id', () => {
    // badge và card được hero gọi; price được card gọi (cùng tầng, chưa đặt nên không tính);
    // alone, menu, price không có ai ở tầng trên gọi.
    const order = draw.nodes
      .filter((entry) => entry.kind === 'snippet')
      .sort((a, b) => at(a.id).x - at(b.id).x)
      .map((entry) => entry.id);

    expect(order).toEqual(['snippets/badge.liquid', 'snippets/card.liquid', 'snippets/alone.liquid', 'snippets/menu.liquid', 'snippets/price.liquid']);
  });

  it('con của node bên trái đứng bên trái con của node bên phải', () => {
    const two: ExportedGraph = {
      nodes: [
        node('sections/a.liquid', 'section'),
        node('sections/b.liquid', 'section'),
        node('snippets/x.liquid', 'snippet'),
        node('snippets/y.liquid', 'snippet'),
      ],
      // x là con của b (bên phải), y là con của a (bên trái): thứ tự theo id bị đảo.
      edges: [edge('sections/b.liquid', 'snippets/x.liquid'), edge('sections/a.liquid', 'snippets/y.liquid')],
    };
    const placed = layeredPositions(drawGraph(two, { kinds: DRAWN_KINDS }));

    expect(placed.get('sections/a.liquid')!.x).toBeLessThan(placed.get('sections/b.liquid')!.x);
    expect(placed.get('snippets/y.liquid')!.x).toBeLessThan(placed.get('snippets/x.liquid')!.x);
  });

  it('tầng đông hơn MAX_PER_ROW thì chia đều thành nhiều hàng, và tầng dưới lùi xuống theo', () => {
    const many: ExportedGraph = {
      nodes: [
        ...Array.from({ length: MAX_PER_ROW + 2 }, (_, i) => node(`sections/s${String(i).padStart(3, '0')}.liquid`, 'section')),
        node('snippets/x.liquid', 'snippet'),
      ],
      edges: [],
    };
    const placed = layeredPositions(drawGraph(many, { kinds: DRAWN_KINDS }));
    const sections = [...placed].filter(([id]) => id.startsWith('sections/')).map(([, position]) => position);
    const rows = [...new Set(sections.map((position) => position.y))].sort((a, b) => a - b);
    const perRow = rows.map((y) => sections.filter((position) => position.y === y).length);

    expect(MAX_PER_ROW).toBe(32);
    // 34 node chia hai hàng 17 và 17, không phải 32 và 2.
    expect(perRow).toEqual([17, 17]);
    expect(placed.get('snippets/x.liquid')!.y).toBeGreaterThan(rows[1]!);
    // Hàng trong một tầng sát nhau hơn khoảng cách giữa hai tầng.
    expect(rows[1]! - rows[0]!).toBeLessThan(placed.get('snippets/x.liquid')!.y - rows[1]!);
    // Không hai node nào trùng chỗ.
    expect(new Set(sections.map((position) => `${position.x},${position.y}`)).size).toBe(MAX_PER_ROW + 2);
  });

  it('hàng cuối ít node hơn vẫn được canh giữa; tầng dưới cách hàng cuối đúng một khoảng tầng', () => {
    const sectionsOf = (count: number): ExportedGraph => ({
      nodes: [
        ...Array.from({ length: count }, (_, i) => node(`sections/s${String(i).padStart(3, '0')}.liquid`, 'section')),
        node('snippets/x.liquid', 'snippet'),
      ],
      edges: [],
    });
    const place = (count: number) => layeredPositions(drawGraph(sectionsOf(count), { kinds: DRAWN_KINDS }));

    // 33 node: hai hàng 17 và 16.
    const placed = place(MAX_PER_ROW + 1);
    const sections = [...placed].filter(([id]) => id.startsWith('sections/')).map(([, position]) => position);
    const lastRowY = Math.max(...sections.map((position) => position.y));
    const lastRow = sections.filter((position) => position.y === lastRowY).map((position) => position.x);

    expect(lastRow).toHaveLength(16);
    expect(Math.min(...lastRow) + Math.max(...lastRow)).toBeCloseTo(0, 6);

    // Khoảng cách tới tầng dưới giống hệt trường hợp tầng trên chỉ có một hàng.
    const single = place(3);
    const layerGap = single.get('snippets/x.liquid')!.y - single.get('sections/s000.liquid')!.y;
    expect(placed.get('snippets/x.liquid')!.y - lastRowY).toBe(layerGap);
  });

  it('node có nhiều nơi gọi được đặt theo vị trí TRUNG BÌNH của chúng', () => {
    const fan: ExportedGraph = {
      nodes: [
        node('sections/a.liquid', 'section'),
        node('sections/b.liquid', 'section'),
        node('sections/c.liquid', 'section'),
        node('snippets/p.liquid', 'snippet'),
        node('snippets/q.liquid', 'snippet'),
      ],
      // p được a (trái nhất) và c (phải nhất) gọi: trung bình ở giữa. q chỉ được a gọi: nằm bên trái.
      edges: [edge('sections/a.liquid', 'snippets/p.liquid'), edge('sections/c.liquid', 'snippets/p.liquid'), edge('sections/a.liquid', 'snippets/q.liquid')],
    };
    const placed = layeredPositions(drawGraph(fan, { kinds: DRAWN_KINDS }));

    expect(placed.get('snippets/q.liquid')!.x).toBeLessThan(placed.get('snippets/p.liquid')!.x);
  });

  it('đúng MAX_PER_ROW node thì vẫn là một hàng', () => {
    const full: ExportedGraph = {
      nodes: Array.from({ length: MAX_PER_ROW }, (_, i) => node(`sections/s${String(i).padStart(3, '0')}.liquid`, 'section')),
      edges: [],
    };
    const placed = layeredPositions(drawGraph(full, { kinds: DRAWN_KINDS }));

    expect(new Set([...placed.values()].map((position) => position.y)).size).toBe(1);
  });

  it('đồ thị rỗng ra bảng vị trí rỗng', () => {
    expect(layeredPositions(drawGraph(SAMPLE, { kinds: [] })).size).toBe(0);
  });

  it('layoutGraph ở chế độ tầng: dùng đúng các vị trí đó, y đảo dấu, node vẽ nhỏ lại', () => {
    const graph = layoutGraph(draw, 'tree');
    const card = graph.getNodeAttributes('snippets/card.liquid');

    expect(card.x).toBe(at('snippets/card.liquid').x);
    expect(card.y).toBe(-at('snippets/card.liquid').y);
    // Trang nằm trên cùng: Sigma vẽ trục y hướng lên, nên y của nó lớn nhất.
    expect(graph.getNodeAttribute('page:index', 'y')).toBeGreaterThan(graph.getNodeAttribute('assets/base.css', 'y'));
    expect(card.size).toBeCloseTo(nodeSize(1) * TREE_SIZE_SCALE, 6);
    expect(layoutGraph(draw, 'force').getNodeAttribute('snippets/card.liquid', 'size')).toBe(nodeSize(1));
    expect(graph.size).toBe(draw.edges.length);
  });

  it('layoutGraph ở chế độ tầng cho cùng một hình mỗi lần', () => {
    expect(layoutGraph(draw, 'tree').export()).toEqual(layoutGraph(draw, 'tree').export());
  });
});
