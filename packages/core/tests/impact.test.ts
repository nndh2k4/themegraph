import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeNotFoundError } from '../src/find-node.js';
import { impact } from '../src/impact.js';
import { openGraph } from '../src/open.js';
import type { GraphHandle } from '../src/open.js';
import type { Reached } from '../src/traverse.js';
import { buildGraph } from '../src/graph.js';
import { file, queryGraph, ref, removeTempTheme, saveToTempTheme } from './helpers.js';

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

describe('impact — trang nào đi qua file nào', () => {
  const viaOf = (name: string) => impact(graph, name).pages.map((page) => [page.id, page.via]);

  it('mỗi trang ghi các file gọi target trực tiếp mà nó đi tới được', () => {
    // card được gọi trực tiếp bởi main-product và grid; trang product chỉ có
    // main-product, trang collection chỉ có grid.
    expect(viaOf('snippets/card.liquid')).toEqual([
      ['page:collection', ['sections/grid.liquid']],
      ['page:product', ['sections/main-product.liquid']],
    ]);
  });

  it('via là file gọi TRỰC TIẾP, không phải file nằm sát trang', () => {
    // price chỉ được card gọi; hai trang đều đi tới price qua card, dù giữa
    // chúng còn section và template.
    expect(viaOf('snippets/price.liquid')).toEqual([
      ['page:collection', ['snippets/card.liquid']],
      ['page:product', ['snippets/card.liquid']],
    ]);
  });

  it('via rỗng khi target là template của chính trang đó', () => {
    expect(viaOf('templates/cart.json')).toEqual([['page:cart', []]]);
  });

  it('giữ nguyên độ sâu và mức chắc chắn của trang', () => {
    const [collection] = impact(graph, 'snippets/card.liquid').pages;

    expect(collection).toEqual({
      id: 'page:collection',
      kind: 'page_type',
      depth: 3,
      certain: false,
      via: ['sections/grid.liquid'],
    });
  });

  it('không có file ngoài trang khi mọi file bị ảnh hưởng đều nằm trên một trang', () => {
    expect(impact(graph, 'snippets/card.liquid').offPage).toEqual([]);
  });

  it('gom vào offPage mọi file bị ảnh hưởng khi không trang nào bị ảnh hưởng', () => {
    // featured có preset nhưng không template nào chứa nó.
    const result = impact(graph, 'snippets/featured-item.liquid');

    expect(result.pages).toEqual([]);
    expect(result.offPage).toEqual(['sections/featured.liquid']);
  });

  describe('đồ thị vừa có file trên trang vừa có file ngoài trang', () => {
    let mixedRoot: string;
    let mixed: GraphHandle;

    beforeEach(async () => {
      //   page:index -> templates/index.json -> sections/on-b.liquid -> snippets/x.liquid
      //                                      -> sections/on-a.liquid -> snippets/x.liquid
      //                                      -> sections/other.liquid            (không gọi x)
      //   sections/off.liquid -> snippets/x.liquid          (không template nào chứa off)
      //   snippets/off-parent.liquid -> snippets/mid.liquid -> snippets/x.liquid   (cũng ngoài mọi trang)
      mixedRoot = await saveToTempTheme(
        buildGraph(
          [
            file('templates/index.json', 'template'),
            file('sections/on-a.liquid', 'section'),
            file('sections/on-b.liquid', 'section'),
            file('sections/other.liquid', 'section'),
            file('sections/off.liquid', 'section'),
            file('snippets/x.liquid', 'snippet'),
            file('snippets/mid.liquid', 'snippet'),
            file('snippets/off-parent.liquid', 'snippet'),
          ],
          [
            ref('templates/index.json', 'section', 'on-b', { source: 'json', line: 0 }),
            ref('templates/index.json', 'section', 'on-a', { source: 'json', line: 0 }),
            ref('templates/index.json', 'section', 'other', { source: 'json', line: 0 }),
            ref('sections/on-a.liquid', 'render', 'x'),
            ref('sections/on-b.liquid', 'render', 'x'),
            ref('sections/off.liquid', 'render', 'x'),
            ref('snippets/mid.liquid', 'render', 'x'),
            ref('snippets/off-parent.liquid', 'render', 'mid'),
          ],
          {},
        ),
      );
      mixed = openGraph(mixedRoot);
    });

    afterEach(async () => {
      mixed.close();
      await removeTempTheme(mixedRoot);
    });

    it('via liệt kê mọi lối, xếp theo id, không gồm file ngoài trang hay file không gọi target', () => {
      const result = impact(mixed, 'snippets/x.liquid');

      expect(result.pages.map((page) => [page.id, page.via])).toEqual([
        ['page:index', ['sections/on-a.liquid', 'sections/on-b.liquid']],
      ]);
    });

    it('offPage gồm file ngoài trang ở mọi độ sâu, theo thứ tự của affected, không gồm trang', () => {
      const result = impact(mixed, 'snippets/x.liquid');

      // off và mid gọi x trực tiếp (độ sâu 1); off-parent ở độ sâu 2.
      expect(result.offPage).toEqual(['sections/off.liquid', 'snippets/mid.liquid', 'snippets/off-parent.liquid']);
      // File trên trang không lọt vào.
      expect(result.offPage).not.toContain('sections/on-a.liquid');
      expect(result.offPage).not.toContain('templates/index.json');
    });
  });
});
