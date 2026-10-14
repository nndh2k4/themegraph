import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openGraph, queryGraph, removeTempTheme, saveToTempTheme, scopeOf } from './helpers.js';
import { NodeNotFoundError } from '../src/common/errors.js';
import type { GraphRepository } from '../src/graph/graph.repository.js';

let themeRoot: string;
let graph: GraphRepository;

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
    expect(scopeOf(graph).context.describe('snippets/card.liquid').node).toEqual({ id: 'snippets/card.liquid', kind: 'snippet' });
  });

  it('liệt kê ai gọi file này, kèm dòng gọi trong file gọi', () => {
    const { usedBy } = scopeOf(graph).context.describe('snippets/card.liquid');

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
    const { uses } = scopeOf(graph).context.describe('snippets/card.liquid');

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
    const { usedBy, uses } = scopeOf(graph).context.describe('templates/product.json');

    expect(usedBy.map((l) => [l.id, l.type, l.sources, l.lines])).toEqual([
      ['page:product', 'USES_TEMPLATE', 'convention', []],
    ]);
    expect(uses.map((l) => [l.id, l.type, l.sources, l.lines])).toEqual([
      ['layout/theme.liquid', 'USES_LAYOUT', 'convention', []],
      ['sections/main-product.liquid', 'RENDERS', 'json', []],
    ]);
  });

  it('không lẫn số dòng của lời gọi tới file khác', () => {
    const { uses } = scopeOf(graph).context.describe('sections/main-product.liquid');

    expect(uses.map((l) => [l.id, l.sources, l.conditional, l.lines])).toEqual([
      ['blocks/_used.liquid', 'schema', true, [20]],
      ['snippets/card.liquid', 'liquid', false, [5]],
    ]);
  });

  it('liệt kê tham chiếu hỏng của file này', () => {
    const { broken } = scopeOf(graph).context.describe('sections/main-product.liquid');

    expect(broken).toEqual([
      { name: 'da-xoa', kind: 'render', line: 9, conditional: false, expected: 'snippets/da-xoa.liquid' },
    ]);
  });

  it('trả mảng rỗng khi file không có tham chiếu hỏng', () => {
    expect(scopeOf(graph).context.describe('snippets/card.liquid').broken).toEqual([]);
  });

  it('cho biết file thuộc những trang nào, trên tổng số trang', () => {
    const result = scopeOf(graph).context.describe('snippets/card.liquid');

    expect(result.pages.map((p) => [p.id, p.certain])).toEqual([
      ['page:collection', false],
      ['page:product', true],
    ]);
    expect(result.totalPages).toBe(3);
  });

  it('tách khoá dịch khỏi danh sách file được gọi', () => {
    const result = scopeOf(graph).context.describe('snippets/card.liquid');

    expect(result.uses.map((l) => l.id)).toEqual(['snippets/price.liquid']);
    expect(result.translations).toEqual([
      {
        id: 't:product.price',
        kind: 'translation_key',
        type: 'USES_TRANSLATION',
        conditional: false,
        count: 2,
        sources: 'liquid',
        lines: [14, 31],
      },
    ]);
  });

  it('trả mảng khoá dịch rỗng cho file không dùng khoá nào', () => {
    expect(scopeOf(graph).context.describe('snippets/price.liquid').translations).toEqual([]);
  });

  it('cho biết file nào dùng một khoá dịch', () => {
    const result = scopeOf(graph).context.describe('t:product.title');

    expect(result.node).toEqual({ id: 't:product.title', kind: 'translation_key' });
    expect(result.usedBy.map((l) => [l.id, l.type, l.conditional, l.lines])).toEqual([
      ['sections/main-product.liquid', 'USES_TRANSLATION', true, [3]],
    ]);
    expect(result.uses).toEqual([]);
    expect(result.translations).toEqual([]);
  });

  it('tách setting được đọc khỏi danh sách file, và cho biết setting thuộc section nào', () => {
    const result = scopeOf(graph).context.describe('snippets/card.liquid');

    // card đọc section.settings.title; trong hai section gọi nó chỉ
    // main-product khai setting này.
    expect(result.uses.map((l) => l.id)).toEqual(['snippets/price.liquid']);
    expect(result.settings).toEqual([
      {
        id: 'setting:sections/main-product.liquid#section.title',
        kind: 'setting',
        type: 'READS_SETTING',
        conditional: true,
        count: 1,
        sources: 'liquid',
        lines: [6],
      },
    ]);
  });

  it('không lẫn setting vào danh sách khoá dịch và ngược lại', () => {
    const result = scopeOf(graph).context.describe('sections/main-product.liquid');

    expect(result.translations.map((l) => l.id)).toEqual(['t:product.title']);
    expect(result.settings.map((l) => l.id)).toEqual(['setting:sections/main-product.liquid#section.title']);
  });

  it('cho biết file nào đọc một setting', () => {
    const result = scopeOf(graph).context.describe('setting:sections/main-product.liquid#section.title');

    expect(result.node.kind).toBe('setting');
    expect(result.usedBy.map((l) => [l.id, l.lines])).toEqual([
      ['sections/main-product.liquid', [2]],
      ['snippets/card.liquid', [6]],
    ]);
    expect(result.settings).toEqual([]);
  });

  it('hiện cạnh tự trỏ ở cả hai phía', () => {
    const { usedBy, uses } = scopeOf(graph).context.describe('snippets/menu.liquid');

    expect(usedBy.map((l) => [l.id, l.lines])).toEqual([
      ['sections/header.liquid', [3]],
      ['snippets/menu.liquid', [6]],
    ]);
    expect(uses.map((l) => [l.id, l.lines])).toEqual([['snippets/menu.liquid', [6]]]);
  });

  it('trả các danh sách rỗng cho file không dính tới ai', () => {
    const result = scopeOf(graph).context.describe('assets/unused.png');

    expect(result.usedBy).toEqual([]);
    expect(result.uses).toEqual([]);
    expect(result.pages).toEqual([]);
  });

  it('chạy được với node loại trang', () => {
    const result = scopeOf(graph).context.describe('product');

    expect(result.node.id).toBe('page:product');
    expect(result.usedBy).toEqual([]);
    expect(result.uses.map((l) => [l.id, l.conditional])).toEqual([
      ['templates/product.alt.json', true],
      ['templates/product.json', false],
    ]);
  });

  it('hiểu đường dẫn tương đối theo baseDir', () => {
    const result = scopeOf(graph).context.describe('card.liquid', { baseDir: `${themeRoot}/snippets` });

    expect(result.node.id).toBe('snippets/card.liquid');
  });

  it('ném NodeNotFoundError cho tên không có trong đồ thị', () => {
    expect(() => scopeOf(graph).context.describe('snippets/khong-co.liquid')).toThrow(NodeNotFoundError);
  });
});
