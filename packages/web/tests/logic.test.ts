import { describe, expect, it } from 'vitest';

import { ApiFailure, apiUrl, createApi, getJson } from '../src/api.js';
import type { Fetcher } from '../src/api.js';
import { displayName, edgeLabel, formatTime, kindLabel, linesText, sortedCounts } from '../src/labels.js';
import { formatRoute, parseRoute } from '../src/route.js';
import type { Route } from '../src/route.js';

describe('parseRoute', () => {
  it('hash rỗng hoặc "#/" là danh sách theme', () => {
    for (const hash of ['', '#', '#/', '/']) expect(parseRoute(hash)).toEqual({ name: 'themes' });
  });

  it('đọc màn tổng quan, tìm kiếm và chi tiết file', () => {
    expect(parseRoute('#/t/ab12')).toEqual({ name: 'overview', themeId: 'ab12' });
    expect(parseRoute('#/t/ab12/search?q=card&kind=snippet')).toEqual({
      name: 'search',
      themeId: 'ab12',
      q: 'card',
      kind: 'snippet',
    });
    expect(parseRoute('#/t/ab12/search')).toEqual({ name: 'search', themeId: 'ab12', q: '', kind: '' });
    expect(parseRoute('#/t/ab12/file?path=snippets%2Fcard.liquid')).toEqual({
      name: 'file',
      themeId: 'ab12',
      path: 'snippets/card.liquid',
    });
  });

  it('giữ nguyên dấu ? và & nằm trong giá trị đã mã hoá', () => {
    expect(parseRoute('#/t/x/search?q=a%3Fb%26c')).toMatchObject({ q: 'a?b&c' });
    // Người dùng gõ tay địa chỉ có dấu ? chưa mã hoá: chỉ dấu ? đầu tiên ngăn phần tham số.
    expect(parseRoute('#/t/x/search?q=a?b')).toMatchObject({ q: 'a?b' });
  });

  it('không nhận ra thì là not_found', () => {
    for (const hash of ['#/khac', '#/t', '#/t/ab12/khong-co', '#/t/ab12/file', '#/t/ab12/file?path=', '#/t/ab12/search/thua']) {
      expect(parseRoute(hash)).toEqual({ name: 'not_found' });
    }
  });
});

describe('formatRoute', () => {
  const routes: Route[] = [
    { name: 'themes' },
    { name: 'overview', themeId: 'ab12' },
    { name: 'search', themeId: 'ab12', q: '', kind: '' },
    { name: 'search', themeId: 'ab12', q: 'card product', kind: 'snippet' },
    { name: 'search', themeId: 'ab12', q: '', kind: 'section' },
    { name: 'file', themeId: 'ab12', path: 'snippets/card.liquid' },
    { name: 'file', themeId: 'ab12', path: 'page:customers/login' },
    { name: 'file', themeId: 'ab12', path: 'setting:sections/a.liquid#section.title' },
    { name: 'file', themeId: 'ab12', path: 't:a.b?c&d=e' },
    { name: 'graph', themeId: 'ab12', kinds: '', node: '', near: false },
    { name: 'graph', themeId: 'ab12', kinds: 'section,snippet', node: '', near: false },
    { name: 'graph', themeId: 'ab12', kinds: '', node: 'snippets/card.liquid', near: false },
    { name: 'graph', themeId: 'ab12', kinds: 'asset', node: 'page:customers/login', near: true },
    { name: 'flow', themeId: 'ab12', page: '' },
    { name: 'flow', themeId: 'ab12', page: 'customers/login' },
  ];

  it('đọc lại được đúng route đã viết ra, với mọi ký tự đặc biệt', () => {
    for (const route of routes) expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('viết ra địa chỉ gọn: bỏ tham số rỗng', () => {
    expect(formatRoute({ name: 'themes' })).toBe('#/');
    expect(formatRoute({ name: 'overview', themeId: 'ab12' })).toBe('#/t/ab12');
    expect(formatRoute({ name: 'search', themeId: 'ab12', q: '', kind: '' })).toBe('#/t/ab12/search');
    expect(formatRoute({ name: 'search', themeId: 'ab12', q: 'card', kind: '' })).toBe('#/t/ab12/search?q=card');
    expect(formatRoute({ name: 'not_found' })).toBe('#/');
  });

  it('màn đồ thị và cây render: địa chỉ gọn khi không có tham số', () => {
    expect(formatRoute({ name: 'graph', themeId: 'ab12', kinds: '', node: '', near: false })).toBe('#/t/ab12/graph');
    expect(formatRoute({ name: 'graph', themeId: 'ab12', kinds: 'asset', node: '', near: false })).toBe('#/t/ab12/graph?kinds=asset');
    expect(formatRoute({ name: 'graph', themeId: 'ab12', kinds: '', node: 'snippets/a.liquid', near: true })).toBe(
      '#/t/ab12/graph?node=snippets%2Fa.liquid&near=1',
    );
    expect(formatRoute({ name: 'flow', themeId: 'ab12', page: '' })).toBe('#/t/ab12/flow');
    expect(formatRoute({ name: 'flow', themeId: 'ab12', page: 'product' })).toBe('#/t/ab12/flow?page=product');
  });

  it('near chỉ có nghĩa khi có node: không có node thì không ghi ra và không đọc vào', () => {
    expect(formatRoute({ name: 'graph', themeId: 'ab12', kinds: '', node: '', near: true })).toBe('#/t/ab12/graph');
    expect(parseRoute('#/t/ab12/graph?near=1')).toEqual({ name: 'graph', themeId: 'ab12', kinds: '', node: '', near: false });
    // Chỉ đúng giá trị "1" mới bật.
    expect(parseRoute('#/t/ab12/graph?node=a&near=0')).toMatchObject({ node: 'a', near: false });
    expect(parseRoute('#/t/ab12/graph?node=a&near=true')).toMatchObject({ near: false });
    expect(parseRoute('#/t/ab12/graph?node=a&near=1')).toMatchObject({ near: true });
  });

  it('mã hoá dấu # trong id của setting, để nó không cắt ngang hash', () => {
    const hash = formatRoute({ name: 'file', themeId: 'x', path: 'setting:a.liquid#section.t' });

    expect(hash.slice(1)).not.toContain('#');
  });
});

describe('nhãn', () => {
  it('kindLabel và edgeLabel dịch mã đã biết, giữ nguyên mã lạ', () => {
    expect(kindLabel('page_type')).toBe('trang');
    expect(kindLabel('translation_key')).toBe('khoá dịch');
    expect(kindLabel('loai_moi')).toBe('loai_moi');
    expect(edgeLabel('RENDERS')).toBe('render');
    expect(edgeLabel('LOADS_SECTION')).toBe('tải bằng JavaScript');
    expect(edgeLabel('CANH_MOI')).toBe('CANH_MOI');
  });

  it('displayName bỏ tiền tố kỹ thuật, chỉ ở đầu id', () => {
    expect(displayName('page:product')).toBe('product');
    expect(displayName('t:general.cart.title')).toBe('general.cart.title');
    expect(displayName('setting:sections/a.liquid#section.title')).toBe('sections/a.liquid#section.title');
    expect(displayName('snippets/card.liquid')).toBe('snippets/card.liquid');
    // "t:" ở giữa không phải tiền tố.
    expect(displayName('snippets/t:x.liquid')).toBe('snippets/t:x.liquid');
  });

  it('formatTime in theo giờ của máy, giữ nguyên chuỗi không phải thời điểm', () => {
    const local = new Date(2026, 9, 5, 7, 3);

    expect(formatTime(local.toISOString())).toBe('2026-10-05 07:03');
    expect(formatTime('khong-phai-ngay')).toBe('khong-phai-ngay');
  });

  it('sortedCounts xếp nhiều nhất trước, bằng nhau thì theo tên', () => {
    expect(sortedCounts({ b: 2, a: 2, c: 9, d: 1 })).toEqual([
      ['c', 9],
      ['a', 2],
      ['b', 2],
      ['d', 1],
    ]);
  });

  it('linesText', () => {
    expect(linesText([])).toBe('');
    expect(linesText([12, 30])).toBe('dòng 12, 30');
  });
});

/** Một hàm fetch giả: ghi lại URL được gọi và trả câu trả lời cho sẵn. */
function fakeFetch(status: number, body: unknown): { fetcher: Fetcher; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetcher: async (url) => {
      urls.push(url);
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
  };
}

describe('apiUrl', () => {
  it('ghép tham số, mã hoá ký tự đặc biệt, bỏ tham số rỗng', () => {
    expect(apiUrl('/api/x')).toBe('/api/x');
    expect(apiUrl('/api/x', { q: '', kind: '' })).toBe('/api/x');
    expect(apiUrl('/api/x', { q: 'a b', kind: '' })).toBe('/api/x?q=a+b');
    expect(apiUrl('/api/x', { path: 'setting:a.liquid#b&c' })).toBe('/api/x?path=setting%3Aa.liquid%23b%26c');
  });
});

describe('getJson', () => {
  it('trả thân JSON khi server trả mã 2xx', async () => {
    const { fetcher } = fakeFetch(200, [{ id: 'a' }]);

    expect(await getJson('/api/themes', fetcher)).toEqual([{ id: 'a' }]);
  });

  it('ném ApiFailure mang mã, thông báo và gợi ý của server', async () => {
    const { fetcher } = fakeFetch(404, {
      error: { code: 'node_not_found', message: 'Không có node "x".', suggestions: ['snippets/x.liquid'] },
    });

    const error = await getJson('/api/x', fetcher).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiFailure);
    expect(error).toMatchObject({
      status: 404,
      code: 'node_not_found',
      message: 'Không có node "x".',
      suggestions: ['snippets/x.liquid'],
    });
  });

  it('thân lỗi không đúng dạng thì vẫn ra một ApiFailure đọc được', async () => {
    const { fetcher } = fakeFetch(500, {});

    const error = (await getJson('/api/x', fetcher).catch((thrown: unknown) => thrown)) as ApiFailure;

    expect(error).toMatchObject({ status: 500, code: 'unknown', suggestions: [] });
    expect(error.message).toContain('500');
  });

  it('không nối được tới server thì báo cách chữa', async () => {
    const error = (await getJson('/api/x', async () => {
      throw new TypeError('Failed to fetch');
    }).catch((thrown: unknown) => thrown)) as ApiFailure;

    expect(error).toMatchObject({ status: 0, code: 'unreachable' });
    expect(error.message).toContain('themegraph serve');
  });

  it('thân không phải JSON thì báo bad_response kèm mã HTTP', async () => {
    const error = (await getJson('/api/x', async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    })).catch((thrown: unknown) => thrown)) as ApiFailure;

    expect(error).toMatchObject({ status: 200, code: 'bad_response' });
  });
});

describe('createApi', () => {
  it('gọi đúng đường dẫn và tham số của từng route', async () => {
    const { fetcher, urls } = fakeFetch(200, {});
    const api = createApi(fetcher);

    await api.themes();
    await api.overview('ab12');
    await api.search('ab12', 'card product', 'snippet');
    await api.search('ab12', '', '');
    await api.file('ab12', 'setting:sections/a.liquid#section.title');
    await api.graph('ab12');
    await api.flow('ab12', 'customers/login');
    await api.deadCode('ab12');

    expect(urls.pop()).toBe('/api/themes/ab12/dead-code');
    expect(urls.pop()).toBe('/api/themes/ab12/flow?page=customers%2Flogin');
    expect(urls.pop()).toBe('/api/themes/ab12/graph');
    expect(urls).toEqual([
      '/api/themes',
      '/api/themes/ab12/overview',
      '/api/themes/ab12/search?q=card+product&kind=snippet&limit=100',
      '/api/themes/ab12/search?limit=100',
      '/api/themes/ab12/file?path=setting%3Asections%2Fa.liquid%23section.title',
    ]);
  });
});
