import type { EdgeType, ExportedGraph, FlowNode, NodeKind } from '@themegraph/core';
import { describe, expect, it } from 'vitest';

import { deepestFile, defaultPage, flowStats, OPEN_DEPTH, opensByDefault } from '../src/flow-model.js';
import { layoutGraph } from '../src/graph-layout.js';
import {
  DEFAULT_KINDS,
  drawGraph,
  DRAWN_KINDS,
  formatKinds,
  kindColor,
  neighborhood,
  nodeLabel,
  nodeSize,
  parseKinds,
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
    const before = layoutGraph(draw, 0);
    const after = layoutGraph(draw);

    // page:index và templates/index.json nằm xa nhau trên vòng tròn (thứ tự theo id) nhưng có cạnh nối.
    expect(distance(after, 'page:index', 'templates/index.json')).toBeLessThan(distance(before, 'page:index', 'templates/index.json'));
  });

  it('0 vòng thì các node nằm trên một vòng tròn quanh gốc toạ độ', () => {
    const graph = layoutGraph(draw, 0);
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
