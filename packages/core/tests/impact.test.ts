import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeNotFoundError } from '../src/find-node.js';
import { impact } from '../src/impact.js';
import { openGraph } from '../src/open.js';
import type { GraphHandle } from '../src/open.js';
import type { Reached } from '../src/traverse.js';
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

/** Viết gọn danh sách node thành [id, độ sâu, chắc chắn] cho dễ so sánh. */
const rows = (list: Reached[]) => list.map((n) => [n.id, n.depth, n.certain]);

describe('impact', () => {
  it('đi ngược từ một snippet lên tới các trang, kèm độ sâu', () => {
    const result = impact(graph, 'snippets/price.liquid');

    expect(result.target).toEqual({ id: 'snippets/price.liquid', kind: 'snippet' });
    expect(rows(result.affected)).toEqual([
      ['snippets/card.liquid', 1, true],
      ['sections/grid.liquid', 2, false],
      ['sections/main-product.liquid', 2, true],
      ['templates/collection.json', 3, false],
      ['templates/product.json', 3, true],
      ['page:collection', 4, false],
      ['page:product', 4, true],
    ]);
  });

  it('tách riêng danh sách trang và đếm tổng số trang của theme', () => {
    const result = impact(graph, 'snippets/price.liquid');

    // Trang cart không dùng card hay price.
    expect(rows(result.pages)).toEqual([
      ['page:collection', 4, false],
      ['page:product', 4, true],
    ]);
    expect(result.totalPages).toBe(3);
  });

  it('ghi kind của từng node bị ảnh hưởng', () => {
    const result = impact(graph, 'snippets/price.liquid');

    expect(result.affected.map((n) => n.kind)).toEqual([
      'snippet',
      'section',
      'section',
      'template',
      'template',
      'page_type',
      'page_type',
    ]);
  });

  it('chỉ chắc chắn khi có một đường đi toàn cạnh không điều kiện', () => {
    // page:collection chỉ tới được price qua lời gọi nằm trong {% if %}.
    const viaIf = impact(graph, 'snippets/price.liquid').pages.find((p) => p.id === 'page:collection');
    // page:product chỉ tới được promo qua một template thay thế.
    const viaAlternate = impact(graph, 'sections/promo.liquid').pages;

    expect(viaIf?.certain).toBe(false);
    expect(rows(viaAlternate)).toEqual([['page:product', 2, false]]);
  });

  it('một đường đi chắc chắn là đủ, dù còn đường khác có điều kiện', () => {
    // card được gọi có điều kiện từ grid nhưng không điều kiện từ main-product.
    const result = impact(graph, 'snippets/card.liquid');

    expect(rows(result.pages)).toEqual([
      ['page:collection', 3, false],
      ['page:product', 3, true],
    ]);
  });

  it('đi qua mọi loại cạnh: asset -> layout -> template -> trang', () => {
    const result = impact(graph, 'assets/base.css');

    expect(rows(result.affected)).toEqual([
      ['layout/theme.liquid', 1, true],
      ['templates/cart.json', 2, true],
      ['templates/collection.json', 2, true],
      ['templates/product.alt.json', 2, true],
      ['templates/product.json', 2, true],
      ['page:cart', 3, true],
      ['page:collection', 3, true],
      ['page:product', 3, true],
    ]);
  });

  it('dừng được khi đồ thị có vòng, và không kể chính file đang hỏi', () => {
    // a và b gọi lẫn nhau: a -> b -> a.
    const result = impact(graph, 'snippets/a.liquid');

    expect(rows(result.affected)).toEqual([
      ['sections/cart.liquid', 1, true],
      ['snippets/b.liquid', 1, false],
      ['templates/cart.json', 2, true],
      ['page:cart', 3, true],
    ]);
  });

  it('dừng được với snippet tự gọi chính nó', () => {
    const result = impact(graph, 'snippets/menu.liquid');

    expect(result.affected.map((n) => n.id)).not.toContain('snippets/menu.liquid');
    expect(result.affected[0]).toEqual({ id: 'sections/header.liquid', kind: 'section', depth: 1, certain: true });
    expect(result.pages).toHaveLength(3);
  });

  it('trả danh sách trang rỗng cho file không trang nào dùng', () => {
    const result = impact(graph, 'snippets/orphan-child.liquid');

    expect(rows(result.affected)).toEqual([['snippets/orphan.liquid', 1, true]]);
    expect(result.pages).toEqual([]);
  });

  it('trả danh sách rỗng cho node không ai trỏ tới', () => {
    expect(impact(graph, 'page:product').affected).toEqual([]);
    expect(impact(graph, 'assets/unused.png').affected).toEqual([]);
  });

  it('đi ngược từ một khoá dịch lên các file và trang dùng nó', () => {
    const result = impact(graph, 't:product.price');

    expect(result.target).toEqual({ id: 't:product.price', kind: 'translation_key' });
    expect(rows(result.affected).slice(0, 3)).toEqual([
      ['snippets/card.liquid', 1, true],
      ['sections/grid.liquid', 2, false],
      ['sections/main-product.liquid', 2, true],
    ]);
    expect(rows(result.pages)).toEqual([
      ['page:collection', 4, false],
      ['page:product', 4, true],
    ]);
  });

  it('đi ngược từ một setting lên các file đọc nó và các trang', () => {
    const result = impact(graph, 'setting:sections/main-product.liquid#section.title');

    expect(rows(result.affected).slice(0, 2)).toEqual([
      ['sections/main-product.liquid', 1, true],
      ['snippets/card.liquid', 1, false],
    ]);
    expect(result.pages.map((p) => p.id)).toEqual(['page:product', 'page:collection']);
  });

  it('khoá dịch không lọt vào kết quả khi hỏi về một file', () => {
    // Khoá dịch chỉ nhận cạnh vào, nên đi ngược từ một file không bao giờ gặp nó.
    const kinds = impact(graph, 'snippets/price.liquid').affected.map((n) => n.kind);

    expect(kinds).not.toContain('translation_key');
  });

  it('nhận tên theo mọi cách findNode hiểu', () => {
    expect(impact(graph, 'snippets\\price.liquid').target.id).toBe('snippets/price.liquid');
    expect(impact(graph, 'price.liquid', { baseDir: `${themeRoot}/snippets` }).target.id).toBe(
      'snippets/price.liquid',
    );
  });

  it('ném NodeNotFoundError cho tên không có trong đồ thị', () => {
    expect(() => impact(graph, 'snippets/khong-co.liquid')).toThrow(NodeNotFoundError);
  });
});
