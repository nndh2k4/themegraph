import { describe, expect, it } from 'vitest';

import { buildGraph } from '../src/graph.js';
import type { FileKind, RawRef, RefKind, RefSource, ThemeFile } from '../src/types.js';

const file = (path: string, kind: FileKind): ThemeFile => ({
  path,
  kind,
  ext: path.slice(path.lastIndexOf('.') + 1),
});

const ref = (
  from: string,
  kind: RefKind,
  to: string,
  extra: { source?: RefSource; conditional?: boolean; line?: number } = {},
): RawRef => ({
  from,
  to,
  kind,
  source: extra.source ?? 'liquid',
  conditional: extra.conditional ?? false,
  line: extra.line ?? 1,
});

/** Một theme nhỏ dùng chung cho nhiều test. */
const FILES: ThemeFile[] = [
  file('layout/theme.liquid', 'layout'),
  file('layout/password.liquid', 'layout'),
  file('templates/product.json', 'template'),
  file('templates/product.2-columns.json', 'template'),
  file('templates/customers/login.json', 'template'),
  file('templates/gift_card.liquid', 'template'),
  file('templates/password.json', 'template'),
  file('sections/main-product.liquid', 'section'),
  file('sections/header-group.json', 'section_group'),
  file('snippets/card.liquid', 'snippet'),
  file('snippets/price.liquid', 'snippet'),
  file('blocks/_text.liquid', 'block'),
  file('assets/base.css', 'asset'),
];

type Graph = ReturnType<typeof buildGraph>;

/** Viết gọn một cạnh thành chuỗi để so sánh cho dễ đọc. */
const edgeKeys = (graph: Graph) => graph.edges.map((e) => `${e.from} -${e.type}-> ${e.to}`);

describe('buildGraph — node', () => {
  it('tạo một node cho mỗi file, id là đường dẫn', () => {
    const graph = buildGraph(FILES, []);

    for (const f of FILES) {
      expect(graph.nodes).toContainEqual({ id: f.path, kind: f.kind });
    }
  });

  it('suy page type từ tên template, gộp các template thay thế vào cùng một trang', () => {
    const graph = buildGraph(FILES, []);

    const pages = graph.nodes.filter((n) => n.kind === 'page_type').map((n) => n.id);

    expect(pages).toEqual([
      'page:customers/login',
      'page:gift_card',
      'page:password',
      'page:product',
    ]);
  });

  it('nối page type tới template; template thay thế là có điều kiện', () => {
    const graph = buildGraph(FILES, []);

    const uses = graph.edges
      .filter((e) => e.type === 'USES_TEMPLATE' && e.from === 'page:product')
      .map((e) => [e.to, e.conditional]);

    // product.json luôn được dùng cho trang product; product.2-columns.json
    // chỉ được dùng khi merchant gán nó cho một sản phẩm cụ thể.
    expect(uses).toEqual([
      ['templates/product.2-columns.json', true],
      ['templates/product.json', false],
    ]);
  });
});

describe('buildGraph — cạnh từ ref', () => {
  it('đổi ref thành cạnh đúng loại, trỏ tới file đã phân giải', () => {
    const graph = buildGraph(FILES, [
      ref('templates/product.json', 'section', 'main-product', { source: 'json' }),
      ref('sections/main-product.liquid', 'render', 'card'),
      ref('sections/main-product.liquid', 'block', '_text', { source: 'schema', conditional: true }),
      ref('sections/main-product.liquid', 'asset', 'base.css'),
      ref('layout/theme.liquid', 'section_group', 'header-group'),
    ]);

    expect(edgeKeys(graph)).toEqual(
      expect.arrayContaining([
        'templates/product.json -RENDERS-> sections/main-product.liquid',
        'sections/main-product.liquid -RENDERS-> snippets/card.liquid',
        'sections/main-product.liquid -RENDERS-> blocks/_text.liquid',
        'sections/main-product.liquid -USES_ASSET-> assets/base.css',
        'layout/theme.liquid -RENDERS-> sections/header-group.json',
      ]),
    );
  });

  it('gộp các lời gọi trùng thành một cạnh và đếm số lần', () => {
    const graph = buildGraph(FILES, [
      ref('snippets/card.liquid', 'render', 'price', { line: 3 }),
      ref('snippets/card.liquid', 'render', 'price', { line: 9 }),
      ref('snippets/card.liquid', 'render', 'price', { line: 20 }),
    ]);

    const edges = graph.edges.filter((e) => e.from === 'snippets/card.liquid');

    expect(edges).toEqual([
      {
        from: 'snippets/card.liquid',
        to: 'snippets/price.liquid',
        type: 'RENDERS',
        conditional: false,
        sources: 'liquid',
        count: 3,
      },
    ]);
  });

  it('cạnh gộp chỉ có điều kiện khi MỌI lời gọi đều có điều kiện', () => {
    const allConditional = buildGraph(FILES, [
      ref('snippets/card.liquid', 'render', 'price', { conditional: true }),
      ref('snippets/card.liquid', 'render', 'price', { conditional: true }),
    ]);
    const mixed = buildGraph(FILES, [
      ref('snippets/card.liquid', 'render', 'price', { conditional: true }),
      ref('snippets/card.liquid', 'render', 'price', { conditional: false }),
    ]);

    const flag = (g: Graph) => g.edges.find((e) => e.from === 'snippets/card.liquid')?.conditional;

    expect(flag(allConditional)).toBe(true);
    // Chỉ cần một lời gọi không điều kiện là file đích chắc chắn được render.
    expect(flag(mixed)).toBe(false);
  });

  it('ghi lại mọi nguồn của một cạnh gộp', () => {
    const graph = buildGraph(FILES, [
      ref('sections/main-product.liquid', 'block', '_text', { source: 'schema', conditional: true }),
      ref('sections/main-product.liquid', 'block', '_text', { source: 'liquid' }),
    ]);

    const edge = graph.edges.find((e) => e.to === 'blocks/_text.liquid');

    expect(edge?.sources).toBe('liquid,schema');
    expect(edge?.count).toBe(2);
  });

  it('không tạo cạnh cho block cục bộ và tham chiếu hỏng, nhưng vẫn ghi vào refs', () => {
    const graph = buildGraph(FILES, [
      ref('templates/product.json', 'block', 'heading', { source: 'json' }),
      ref('snippets/card.liquid', 'render', 'da-xoa', { line: 7 }),
    ]);

    expect(graph.edges.filter((e) => e.type === 'RENDERS')).toEqual([]);
    expect(graph.refs.map((r) => [r.to, r.status, r.target])).toEqual([
      ['da-xoa', 'missing', 'snippets/da-xoa.liquid'],
      ['heading', 'local_block', null],
    ]);
  });
});

describe('buildGraph — layout', () => {
  const layoutOf = (graph: Graph, template: string) =>
    graph.edges
      .filter((e) => e.type === 'USES_LAYOUT' && e.from === template)
      .map((e) => [e.to, e.sources]);

  it('gán layout/theme.liquid cho template không khai layout', () => {
    const graph = buildGraph(FILES, []);

    expect(layoutOf(graph, 'templates/product.json')).toEqual([
      ['layout/theme.liquid', 'convention'],
    ]);
  });

  it('dùng layout được khai thay cho mặc định', () => {
    const graph = buildGraph(FILES, [
      ref('templates/password.json', 'layout', 'password', { source: 'json' }),
    ]);

    expect(layoutOf(graph, 'templates/password.json')).toEqual([['layout/password.liquid', 'json']]);
  });

  it('không gán layout nào cho template khai no_layout', () => {
    const graph = buildGraph(FILES, [ref('templates/gift_card.liquid', 'no_layout', '')]);

    expect(layoutOf(graph, 'templates/gift_card.liquid')).toEqual([]);
  });

  it('không gán layout mặc định khi theme không có layout/theme.liquid', () => {
    const files = FILES.filter((f) => f.path !== 'layout/theme.liquid');
    const graph = buildGraph(files, []);

    expect(graph.edges.filter((e) => e.type === 'USES_LAYOUT')).toEqual([]);
  });
});

describe('buildGraph — bất biến', () => {
  const REFS = [
    ref('templates/product.json', 'section', 'main-product', { source: 'json' }),
    ref('sections/main-product.liquid', 'render', 'card'),
    ref('snippets/card.liquid', 'render', 'price'),
    ref('snippets/card.liquid', 'render', 'da-xoa'),
    ref('snippets/card.liquid', 'asset', 'base.css'),
  ];

  it('mọi đầu mút của mọi cạnh đều là một node có thật', () => {
    const graph = buildGraph(FILES, REFS);
    const ids = new Set(graph.nodes.map((n) => n.id));

    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });

  it('cho cùng kết quả dù file và ref được đưa vào theo thứ tự nào', () => {
    const forward = buildGraph(FILES, REFS);
    const backward = buildGraph([...FILES].reverse(), [...REFS].reverse());

    expect(backward).toEqual(forward);
  });

  it('sắp refs ổn định cả khi hai lời gọi chỉ khác nhau ở conditional', () => {
    // Ca thật ở Purity: một template JSON dùng cùng một block hai lần, một lần
    // bị disabled. Cả hai có line 0 nên mọi trường khác đều giống nhau.
    const twins = [
      ref('templates/product.json', 'block', '_text', { source: 'json', line: 0, conditional: true }),
      ref('templates/product.json', 'block', '_text', { source: 'json', line: 0, conditional: false }),
    ];

    const forward = buildGraph(FILES, twins);
    const backward = buildGraph(FILES, [...twins].reverse());

    expect(backward.refs).toEqual(forward.refs);
    expect(forward.refs.map((r) => r.conditional)).toEqual([false, true]);
  });

  it('cho phép cạnh tự trỏ khi snippet gọi chính nó', () => {
    // Menu nhiều cấp thường được viết bằng snippet đệ quy.
    const graph = buildGraph(FILES, [ref('snippets/card.liquid', 'render', 'card')]);

    expect(edgeKeys(graph)).toContain('snippets/card.liquid -RENDERS-> snippets/card.liquid');
  });
});
