import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { context } from '../src/context.js';
import { NodeNotFoundError } from '../src/find-node.js';
import { openGraph } from '../src/open.js';
import type { GraphHandle } from '../src/open.js';
import { queryGraph, removeTempTheme, saveToTempTheme } from './helpers.js';

let themeRoot: string;
let graph: GraphHandle;

beforeEach(async () => {
  themeRoot = await saveToTempTheme(queryGraph());
  graph = openGraph(themeRoot);
});

afterEach(async () => {
  graph.close();
  await removeTempTheme(themeRoot);
});

describe('context', () => {
  it('trả về node đang hỏi', () => {
    expect(context(graph, 'snippets/card.liquid').node).toEqual({ id: 'snippets/card.liquid', kind: 'snippet' });
  });

  it('liệt kê ai gọi file này, kèm dòng gọi trong file gọi', () => {
    const { usedBy } = context(graph, 'snippets/card.liquid');

    expect(usedBy).toEqual([
      {
        id: 'sections/grid.liquid',
        kind: 'section',
        type: 'RENDERS',
        conditional: true,
        count: 1,
        sources: 'liquid',
        lines: [7],
      },
      {
        id: 'sections/main-product.liquid',
        kind: 'section',
        type: 'RENDERS',
        conditional: false,
        count: 1,
        sources: 'liquid',
        lines: [5],
      },
    ]);
  });

  it('liệt kê file này gọi ai, gộp các lời gọi trùng và giữ đủ số dòng', () => {
    const { uses } = context(graph, 'snippets/card.liquid');

    expect(uses).toEqual([
      {
        id: 'snippets/price.liquid',
        kind: 'snippet',
        type: 'RENDERS',
        conditional: false,
        count: 2,
        sources: 'liquid',
        lines: [12, 30],
      },
    ]);
  });

  it('không có số dòng cho quan hệ lấy từ JSON hoặc suy từ quy ước', () => {
    const { usedBy, uses } = context(graph, 'templates/product.json');

    expect(usedBy.map((l) => [l.id, l.type, l.sources, l.lines])).toEqual([
      ['page:product', 'USES_TEMPLATE', 'convention', []],
    ]);
    expect(uses.map((l) => [l.id, l.type, l.sources, l.lines])).toEqual([
      ['layout/theme.liquid', 'USES_LAYOUT', 'convention', []],
      ['sections/main-product.liquid', 'RENDERS', 'json', []],
    ]);
  });

  it('không lẫn số dòng của lời gọi tới file khác', () => {
    const { uses } = context(graph, 'sections/main-product.liquid');

    expect(uses.map((l) => [l.id, l.sources, l.conditional, l.lines])).toEqual([
      ['blocks/_used.liquid', 'schema', true, [20]],
      ['snippets/card.liquid', 'liquid', false, [5]],
    ]);
  });

  it('liệt kê tham chiếu hỏng của file này', () => {
    const { broken } = context(graph, 'sections/main-product.liquid');

    expect(broken).toEqual([
      { name: 'da-xoa', kind: 'render', line: 9, conditional: false, expected: 'snippets/da-xoa.liquid' },
    ]);
  });

  it('trả mảng rỗng khi file không có tham chiếu hỏng', () => {
    expect(context(graph, 'snippets/card.liquid').broken).toEqual([]);
  });

  it('cho biết file thuộc những trang nào, trên tổng số trang', () => {
    const result = context(graph, 'snippets/card.liquid');

    expect(result.pages.map((p) => [p.id, p.certain])).toEqual([
      ['page:collection', false],
      ['page:product', true],
    ]);
    expect(result.totalPages).toBe(3);
  });

  it('hiện cạnh tự trỏ ở cả hai phía', () => {
    const { usedBy, uses } = context(graph, 'snippets/menu.liquid');

    expect(usedBy.map((l) => [l.id, l.lines])).toEqual([
      ['sections/header.liquid', [3]],
      ['snippets/menu.liquid', [6]],
    ]);
    expect(uses.map((l) => [l.id, l.lines])).toEqual([['snippets/menu.liquid', [6]]]);
  });

  it('trả các danh sách rỗng cho file không dính tới ai', () => {
    const result = context(graph, 'assets/unused.png');

    expect(result.usedBy).toEqual([]);
    expect(result.uses).toEqual([]);
    expect(result.pages).toEqual([]);
  });

  it('chạy được với node loại trang', () => {
    const result = context(graph, 'product');

    expect(result.node.id).toBe('page:product');
    expect(result.usedBy).toEqual([]);
    expect(result.uses.map((l) => [l.id, l.conditional])).toEqual([
      ['templates/product.alt.json', true],
      ['templates/product.json', false],
    ]);
  });

  it('hiểu đường dẫn tương đối theo baseDir', () => {
    const result = context(graph, 'card.liquid', { baseDir: `${themeRoot}/snippets` });

    expect(result.node.id).toBe('snippets/card.liquid');
  });

  it('ném NodeNotFoundError cho tên không có trong đồ thị', () => {
    expect(() => context(graph, 'snippets/khong-co.liquid')).toThrow(NodeNotFoundError);
  });
});
