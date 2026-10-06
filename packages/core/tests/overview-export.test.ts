import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deadCode } from '../src/dead-code.js';
import { exportGraph } from '../src/export-graph.js';
import { formatOverview } from '../src/format.js';
import { buildGraph } from '../src/graph.js';
import { openGraph } from '../src/open.js';
import type { GraphHandle } from '../src/open.js';
import { overview } from '../src/overview.js';
import type { ThemeGraph } from '../src/types.js';
import { file, queryGraph, ref, removeTempTheme, saveToTempTheme } from './helpers.js';

let themeRoot: string;
let graph: GraphHandle;
let memory: ThemeGraph; // cùng đồ thị, ở dạng đối tượng trong bộ nhớ, để đối chiếu

beforeEach(async () => {
  memory = queryGraph();
  themeRoot = await saveToTempTheme(memory);
  graph = openGraph(themeRoot);
});

afterEach(async () => {
  graph.close();
  await removeTempTheme(themeRoot);
});

/** Đếm các phần tử theo một khoá, cho ra object xếp theo tên khoá. */
function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

describe('overview', () => {
  it('đếm node, cạnh và tham chiếu đúng như đồ thị trong bộ nhớ', () => {
    const result = overview(graph);

    expect(result.nodes).toBe(memory.nodes.length);
    expect(result.edges).toBe(memory.edges.length);
    expect(result.nodesByKind).toEqual(countBy(memory.nodes, (node) => node.kind));
    expect(result.edgesByType).toEqual(countBy(memory.edges, (edge) => edge.type));
    expect(result.refsByStatus).toEqual(countBy(memory.refs, (entry) => entry.status));
    // Thứ tự khoá cũng phải ổn định: theo tên.
    expect(Object.keys(result.nodesByKind)).toEqual(Object.keys(result.nodesByKind).sort());
  });

  it('ghi theme và lần phân tích', () => {
    const result = overview(graph);

    expect(result.themeRoot).toBe(graph.themeRoot);
    expect(result.meta).toEqual(graph.meta);
  });

  it('liệt kê tên các loại trang, không có tiền tố, theo bảng chữ cái', () => {
    expect(overview(graph).pages).toEqual(['cart', 'collection', 'product']);
  });

  it('đếm tham chiếu hỏng', () => {
    // Đồ thị mẫu có đúng một lời gọi tới snippet không tồn tại ('da-xoa').
    expect(overview(graph).brokenRefs).toBe(1);
    expect(overview(graph).brokenRefs).toBe(memory.refs.filter((entry) => entry.status === 'missing').length);
  });

  it('brokenRefs là 0 khi không có tham chiếu hỏng nào', async () => {
    const root = await saveToTempTheme(buildGraph([file('snippets/a.liquid', 'snippet')], [], {}));
    const handle = openGraph(root);
    try {
      expect(overview(handle).brokenRefs).toBe(0);
      expect(overview(handle).mostUsed).toEqual([]);
      expect(overview(handle).pages).toEqual([]);
      // Phần trình bày: không có mục file được gọi nhiều, và không trang nào.
      const lines = formatOverview(overview(handle));
      expect(lines.some((line) => line.includes('File được nhiều nơi gọi nhất'))).toBe(false);
      expect(lines).toContain('Trang            0  ()');
    } finally {
      handle.close();
      await removeTempTheme(root);
    }
  });

  it('phần file không dùng trùng với deadCode()', () => {
    const dead = deadCode(graph);
    const { unused } = overview(graph);

    expect(unused).toEqual({
      certain: dead.certain,
      review: dead.review,
      notLoaded: dead.notLoaded.length,
      translationKeys: dead.unusedTranslationKeys.length,
      settings: dead.unusedSettings.length,
    });
    // Đồ thị mẫu có cả bốn loại, nên không con số nào bằng 0 một cách tình cờ.
    const { notLoaded, ...counts } = unused;
    expect(Object.values(counts).every((n) => n > 0)).toBe(true);
    // Đồ thị mẫu không có custom element nào.
    expect(notLoaded).toBe(0);
  });

  it('không lẫn số khoá dịch với số setting, hay số chắc chắn với số cần xem lại', async () => {
    // Hai khoá dịch và một setting, không file nào dùng; một snippet chết
    // (chắc chắn) và hai asset chết (cần xem lại).
    const root = await saveToTempTheme(
      buildGraph(
        [file('snippets/dead.liquid', 'snippet'), file('assets/a.png', 'asset'), file('assets/b.png', 'asset')],
        [],
        { translationKeys: ['a.b', 'a.c'], settings: ['setting:settings.x'] },
      ),
    );
    const handle = openGraph(root);
    try {
      const result = overview(handle);

      expect(result.unused).toEqual({ certain: 1, review: 2, notLoaded: 0, translationKeys: 2, settings: 1 });
      expect(formatOverview(result)).toContain('File không dùng  1 chắc chắn, 2 cần xem lại');
      expect(formatOverview(result)).toContain('Không thấy dùng  2 khoá dịch, 1 setting');
    } finally {
      handle.close();
      await removeTempTheme(root);
    }
  });

  it('xếp file được dùng nhiều nhất: theo số nơi gọi khác nhau, bằng nhau thì theo id', () => {
    const { mostUsed } = overview(graph);

    // layout được bốn template dùng; a được cart và b gọi; card được
    // main-product và grid gọi. a đứng trước card vì cùng số nơi gọi.
    expect(mostUsed.slice(0, 3)).toEqual([
      { id: 'layout/theme.liquid', kind: 'layout', usedBy: 4 },
      { id: 'snippets/a.liquid', kind: 'snippet', usedBy: 2 },
      { id: 'snippets/card.liquid', kind: 'snippet', usedBy: 2 },
    ]);
    // Phần còn lại mỗi file một nơi gọi, xếp theo id.
    const rest = mostUsed.slice(3);
    expect(rest.every((entry) => entry.usedBy === 1)).toBe(true);
    expect(rest.map((entry) => entry.id)).toEqual(rest.map((entry) => entry.id).sort());
  });

  it('đếm nơi gọi chứ không cộng số lời gọi, và không tính file tự gọi mình', async () => {
    // a gọi x hai lần; x tự gọi mình; b gọi x một lần.
    const root = await saveToTempTheme(
      buildGraph(
        [file('snippets/a.liquid', 'snippet'), file('snippets/b.liquid', 'snippet'), file('snippets/x.liquid', 'snippet')],
        [
          ref('snippets/a.liquid', 'render', 'x', { line: 1 }),
          ref('snippets/a.liquid', 'render', 'x', { line: 2 }),
          ref('snippets/b.liquid', 'render', 'x'),
          ref('snippets/x.liquid', 'render', 'x'),
        ],
        {},
      ),
    );
    const handle = openGraph(root);
    try {
      expect(overview(handle).mostUsed).toEqual([{ id: 'snippets/x.liquid', kind: 'snippet', usedBy: 2 }]);
    } finally {
      handle.close();
      await removeTempTheme(root);
    }
  });

  it('không đưa loại trang, template, khoá dịch hay setting vào danh sách dùng nhiều', () => {
    const kinds = new Set(overview(graph).mostUsed.map((entry) => entry.kind));

    // Đồ thị mẫu có assets/base.css được layout dùng: nó không được lọt vào.
    for (const kind of ['page_type', 'template', 'asset', 'translation_key', 'setting']) {
      expect(kinds.has(kind as never)).toBe(false);
    }
  });

  it('chỉ nêu mười file dùng nhiều nhất', async () => {
    // 12 snippet, snippet thứ i được i section gọi.
    const snippets = Array.from({ length: 12 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`);
    const sections = Array.from({ length: 12 }, (_, i) => `sec${String(i + 1).padStart(2, '0')}`);
    const refs = snippets.flatMap((snippet, i) =>
      sections.slice(0, i + 1).map((section) => ref(`sections/${section}.liquid`, 'render', snippet)),
    );
    const root = await saveToTempTheme(
      buildGraph(
        [
          ...snippets.map((name) => file(`snippets/${name}.liquid`, 'snippet')),
          ...sections.map((name) => file(`sections/${name}.liquid`, 'section')),
        ],
        refs,
        {},
      ),
    );
    const handle = openGraph(root);
    try {
      const { mostUsed } = overview(handle);

      expect(mostUsed).toHaveLength(10);
      expect(mostUsed[0]).toEqual({ id: 'snippets/s12.liquid', kind: 'snippet', usedBy: 12 });
      expect(mostUsed.at(-1)).toEqual({ id: 'snippets/s03.liquid', kind: 'snippet', usedBy: 3 });
    } finally {
      handle.close();
      await removeTempTheme(root);
    }
  });
});

describe('exportGraph', () => {
  const FILE_KINDS_EXCLUDED = ['translation_key', 'setting'];

  it('mặc định chỉ xuất file và loại trang, cùng các cạnh giữa chúng', () => {
    const result = exportGraph(graph);

    const expectedNodes = memory.nodes.filter((node) => !FILE_KINDS_EXCLUDED.includes(node.kind));
    const ids = new Set(expectedNodes.map((node) => node.id));

    expect(result.nodes).toHaveLength(expectedNodes.length);
    expect(result.nodes.some((node) => FILE_KINDS_EXCLUDED.includes(node.kind))).toBe(false);
    expect(result.edges).toHaveLength(memory.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).length);
    expect(result.edges.some((edge) => edge.type === 'USES_TRANSLATION' || edge.type === 'READS_SETTING')).toBe(false);
  });

  it('mọi cạnh đều có đủ hai đầu trong danh sách node, ở mọi cách chọn nhóm', () => {
    for (const include of [[], ['translations'], ['settings'], ['translations', 'settings']] as const) {
      const result = exportGraph(graph, { include });
      const ids = new Set(result.nodes.map((node) => node.id));

      expect(result.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    }
  });

  it('xin nhóm nào thì có thêm node và cạnh của đúng nhóm đó', () => {
    const translations = exportGraph(graph, { include: ['translations'] });

    expect(translations.nodes.filter((node) => node.kind === 'translation_key').map((node) => node.id)).toEqual([
      't:general.unused',
      't:product.price',
      't:product.title',
    ]);
    expect(translations.nodes.some((node) => node.kind === 'setting')).toBe(false);
    expect(translations.edges.some((edge) => edge.type === 'USES_TRANSLATION')).toBe(true);
    expect(translations.edges.some((edge) => edge.type === 'READS_SETTING')).toBe(false);

    const settings = exportGraph(graph, { include: ['settings'] });

    expect(settings.nodes.some((node) => node.kind === 'setting')).toBe(true);
    expect(settings.nodes.some((node) => node.kind === 'translation_key')).toBe(false);
    expect(settings.edges.some((edge) => edge.type === 'READS_SETTING')).toBe(true);
  });

  it('xin cả hai nhóm thì ra toàn bộ đồ thị', () => {
    const result = exportGraph(graph, { include: ['translations', 'settings'] });

    expect(result.nodes).toHaveLength(memory.nodes.length);
    expect(result.edges).toHaveLength(memory.edges.length);
  });

  it('giữ nguyên mọi trường của cạnh', () => {
    const edge = exportGraph(graph).edges.find(
      (entry) => entry.from === 'snippets/card.liquid' && entry.to === 'snippets/price.liquid',
    );

    expect(edge).toEqual({
      from: 'snippets/card.liquid',
      to: 'snippets/price.liquid',
      type: 'RENDERS',
      conditional: false,
      sources: 'liquid',
      count: 2,
    });
    // Cạnh có điều kiện.
    expect(
      exportGraph(graph).edges.find((entry) => entry.from === 'sections/grid.liquid' && entry.to === 'snippets/card.liquid')
        ?.conditional,
    ).toBe(true);
  });

  it('xếp node theo id và cạnh theo (from, to, type)', () => {
    const { nodes, edges } = exportGraph(graph, { include: ['translations', 'settings'] });

    expect(nodes.map((node) => node.id)).toEqual(nodes.map((node) => node.id).sort());
    const keys = edges.map((edge) => `${edge.from}\u0000${edge.to}\u0000${edge.type}`);
    expect(keys).toEqual([...keys].sort());
  });
});
