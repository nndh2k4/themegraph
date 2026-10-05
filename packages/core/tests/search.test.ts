import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openGraph } from '../src/open.js';
import type { GraphHandle } from '../src/open.js';
import { DEFAULT_SEARCH_LIMIT, search } from '../src/search.js';
import type { SearchHit } from '../src/search.js';
import { buildGraph } from '../src/graph.js';
import { NODE_KINDS } from '../src/types.js';
import type { NodeKind } from '../src/types.js';
import { file, queryGraph, removeTempTheme, saveToTempTheme } from './helpers.js';

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

/** Viết gọn danh sách kết quả thành [id, mức khớp]. */
const rows = (hits: SearchHit[]) => hits.map((hit) => [hit.id, hit.match]);

describe('search', () => {
  it('xếp tên trùng hẳn trước, rồi tên bắt đầu bằng, rồi tên chứa, rồi đường dẫn chứa', () => {
    // "cart": trang cart và section cart trùng tên; templates/cart.json cũng
    // trùng tên. Không node nào khác chứa "cart". Cùng mức khớp thì id ngắn
    // đứng trước: templates/cart.json ngắn hơn sections/cart.liquid một ký tự.
    expect(rows(search(graph, 'cart').hits)).toEqual([
      ['page:cart', 'exact'],
      ['templates/cart.json', 'exact'],
      ['sections/cart.liquid', 'exact'],
    ]);

    // "product": trùng tên (trang, hai template), bắt đầu bằng (khoá dịch
    // product.price, product.title), nằm giữa tên (main-product), và chỉ nằm
    // trong đường dẫn (setting của section main-product).
    expect(rows(search(graph, 'product').hits)).toEqual([
      ['page:product', 'exact'],
      ['templates/product.json', 'exact'],
      ['templates/product.alt.json', 'exact'],
      ['t:product.price', 'prefix'],
      ['t:product.title', 'prefix'],
      ['sections/main-product.liquid', 'name'],
      ['setting:sections/main-product.liquid#section.title', 'path'],
    ]);
  });

  it('trong cùng mức khớp thì id ngắn trước, rồi theo bảng chữ cái', () => {
    expect(rows(search(graph, 'orphan').hits)).toEqual([
      ['snippets/orphan.liquid', 'exact'],
      ['snippets/orphan-child.liquid', 'prefix'],
    ]);

    // Hai id dài bằng nhau: so theo chữ cái.
    expect(search(graph, 'snippets/', { limit: 2 }).hits.map((hit) => hit.id)).toEqual([
      'snippets/a.liquid',
      'snippets/b.liquid',
    ]);
  });

  it('cùng mức khớp thì file và trang đứng trước khoá dịch và setting, dù id dài hơn', async () => {
    const root = await saveToTempTheme(
      buildGraph([file('snippets/card-product-with-a-long-name.liquid', 'snippet')], [], {
        translationKeys: ['card_a'],
        settings: ['setting:settings.card_b'],
      }),
    );
    const handle = openGraph(root);
    try {
      expect(rows(search(handle, 'card').hits)).toEqual([
        ['snippets/card-product-with-a-long-name.liquid', 'prefix'],
        ['t:card_a', 'prefix'],
        ['setting:settings.card_b', 'prefix'],
      ]);
    } finally {
      handle.close();
      await removeTempTheme(root);
    }
  });

  it('không phân biệt hoa thường, ở cả từ khoá lẫn id', async () => {
    expect(search(graph, 'CART').hits.map((hit) => hit.id)).toContain('sections/cart.liquid');

    const upperRoot = await saveToTempTheme(buildGraph([file('snippets/Icon-Cart.liquid', 'snippet')], [], {}));
    const upper = openGraph(upperRoot);
    try {
      expect(rows(search(upper, 'icon-cart').hits)).toEqual([['snippets/Icon-Cart.liquid', 'exact']]);
      // Cả khi từ khoá chỉ khớp ở phần đường dẫn (ở đây là tên kèm đuôi).
      expect(rows(search(upper, 'cart.LIQUID').hits)).toEqual([['snippets/Icon-Cart.liquid', 'path']]);
    } finally {
      upper.close();
      await removeTempTheme(upperRoot);
    }
  });

  it('nhiều từ: mọi từ phải có mặt, mức khớp là mức lỏng nhất', () => {
    // "main" bắt đầu tên main-product, "product" nằm giữa tên -> mức "name".
    // Setting của section đó có cả hai từ nhưng chỉ trong đường dẫn -> "path".
    expect(rows(search(graph, 'product  main').hits)).toEqual([
      ['sections/main-product.liquid', 'name'],
      ['setting:sections/main-product.liquid#section.title', 'path'],
    ]);

    expect(search(graph, 'product khong-co').hits).toEqual([]);
  });

  it('tìm được khoá dịch và setting theo tên của chúng', () => {
    expect(rows(search(graph, 'general.unused').hits)).toEqual([['t:general.unused', 'exact']]);

    expect(rows(search(graph, 'accent').hits)).toEqual([['setting:settings.accent', 'exact']]);
    expect(rows(search(graph, 'title', { kinds: ['setting'] }).hits)).toEqual([
      ['setting:sections/main-product.liquid#section.title', 'exact'],
    ]);
  });

  it('lọc theo loại node', () => {
    expect(search(graph, 'product', { kinds: ['template', 'section'] }).hits.map((hit) => hit.id)).toEqual([
      'templates/product.json',
      'templates/product.alt.json',
      'sections/main-product.liquid',
    ]);

    // Mảng rỗng nghĩa là không lọc.
    expect(search(graph, 'cart', { kinds: [] }).total).toBe(3);
  });

  it('từ khoá rỗng liệt kê mọi node của loại được chọn', () => {
    const result = search(graph, '  ', { kinds: ['page_type'] });

    expect(rows(result.hits)).toEqual([
      ['page:cart', 'path'],
      ['page:collection', 'path'],
      ['page:product', 'path'],
    ]);

    // Không lọc loại: mọi node, theo bảng chữ cái của id.
    const all = search(graph, '', { limit: 1000 }).hits.map((hit) => hit.id);
    expect(all).toEqual([...all].sort());
    expect(all).toContain('snippets/card.liquid');
    expect(all).toContain('t:product.price');
  });

  it('cắt theo limit nhưng vẫn đếm đủ số node khớp', () => {
    const all = search(graph, '', { limit: 1000 });
    expect(all.hits.length).toBe(all.total);
    expect(all.total).toBeGreaterThan(DEFAULT_SEARCH_LIMIT);

    const byDefault = search(graph, '');
    expect(byDefault.hits.length).toBe(DEFAULT_SEARCH_LIMIT);
    expect(byDefault.total).toBe(all.total);
    // Phần giữ lại là phần đầu của danh sách đã xếp hạng.
    expect(byDefault.hits).toEqual(all.hits.slice(0, DEFAULT_SEARCH_LIMIT));

    expect(search(graph, 'product', { limit: 2 }).hits.map((hit) => hit.id)).toEqual([
      'page:product',
      'templates/product.json',
    ]);
    expect(search(graph, 'product', { limit: 0 }).hits).toEqual([]);
    expect(search(graph, 'product', { limit: -3 }).hits).toEqual([]);
  });

  it('trả lại từ khoá nguyên văn và danh sách rỗng khi không có gì khớp', () => {
    expect(search(graph, 'Khong-Co-Gi')).toEqual({ query: 'Khong-Co-Gi', hits: [], total: 0 });
  });

  it('tên của file nhiều đuôi và file trong thư mục con là phần trước dấu chấm đầu tiên', async () => {
    const root = await saveToTempTheme(
      buildGraph(
        [file('templates/customers/login.json', 'template'), file('assets/theme.min.js', 'asset')],
        [],
        {},
      ),
    );
    const handle = openGraph(root);
    try {
      expect(rows(search(handle, 'login', { kinds: ['template'] }).hits)).toEqual([
        ['templates/customers/login.json', 'exact'],
      ]);
      expect(rows(search(handle, 'theme', { kinds: ['asset'] }).hits)).toEqual([['assets/theme.min.js', 'exact']]);
      // "customers" chỉ là tên thư mục.
      expect(rows(search(handle, 'customers', { kinds: ['template'] }).hits)).toEqual([
        ['templates/customers/login.json', 'path'],
      ]);
    } finally {
      handle.close();
      await removeTempTheme(root);
    }
  });
});

describe('NODE_KINDS', () => {
  it('liệt kê đủ mọi NodeKind, mỗi loại một lần', () => {
    // Kiểm lúc biên dịch (pnpm typecheck): nếu có NodeKind chưa nằm trong
    // NODE_KINDS thì kiểu của `complete` thành false và phép gán này báo lỗi.
    const complete: [Exclude<NodeKind, (typeof NODE_KINDS)[number]>] extends [never] ? true : false = true;

    expect(complete).toBe(true);
    expect(new Set(NODE_KINDS).size).toBe(NODE_KINDS.length);
  });

  it('chứa mọi loại node mà đồ thị mẫu sinh ra', () => {
    const kinds = graph.db
      .prepare('SELECT DISTINCT kind FROM nodes')
      .all()
      .map((row) => String(row.kind));
    const known: readonly string[] = NODE_KINDS;

    expect(kinds.filter((kind) => !known.includes(kind))).toEqual([]);
  });
});
