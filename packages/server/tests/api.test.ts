import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  analyze,
  context,
  deadCode,
  exportGraph,
  impact,
  listThemes,
  openGraph,
  overview,
  readRegistry,
  renderFlow,
  search,
  themeStatus,
  unregisterTheme,
} from '@themegraph/core';
import type { GraphHandle } from '@themegraph/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleApi, themeId } from '../src/api.js';
import type { ApiError, ApiTheme } from '../src/api.js';

const FIXTURE = path.join(import.meta.dirname, '../../core/tests/fixtures/mini-theme');

let tmp: string;
let themeRoot: string;
let id: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-api-'));
  themeRoot = path.join(tmp, 'mini-theme');
  await cp(FIXTURE, themeRoot, { recursive: true });
  // Sổ đăng ký tạm của file test dùng chung giữa các test: bắt đầu từ sổ trống.
  for (const entry of readRegistry()) unregisterTheme(entry.path);
  await analyze(themeRoot);
  id = themeId(themeRoot);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Gọi API bằng một URL tương đối, như trình duyệt sẽ gọi. */
async function get(url: string, method = 'GET') {
  const parsed = new URL(url, 'http://localhost');
  return handleApi({ method, path: parsed.pathname, query: parsed.searchParams });
}

/** Gọi một hàm của lõi trên theme đang test, để đối chiếu với API. */
function core<T>(body: (graph: GraphHandle) => T): T {
  const graph = openGraph(themeRoot);
  try {
    return body(graph);
  } finally {
    graph.close();
  }
}

const errorOf = (response: { body: unknown }) => (response.body as ApiError).error;

describe('themeId', () => {
  it('là 12 ký tự hex, chỉ phụ thuộc đường dẫn', () => {
    expect(themeId(themeRoot)).toMatch(/^[0-9a-f]{12}$/);
    expect(themeId(themeRoot)).toBe(themeId(path.join(themeRoot, '.')));
    expect(themeId(themeRoot)).not.toBe(themeId(path.join(tmp, 'other')));
  });

  it('đường dẫn tương đối và đường dẫn đầy đủ của cùng một thư mục cho cùng một mã', () => {
    expect(themeId('theme-nao-do')).toBe(themeId(path.resolve('theme-nao-do')));
  });

  it.runIf(process.platform === 'win32')('trên Windows không phân biệt hoa thường', () => {
    expect(themeId(themeRoot.toUpperCase())).toBe(themeId(themeRoot.toLowerCase()));
  });
});

describe('GET /api/themes', () => {
  it('trả danh sách của sổ đăng ký, mỗi theme kèm mã', async () => {
    const response = await get('/api/themes');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(listThemes().map((theme) => ({ id: themeId(theme.path), ...theme })));
    expect((response.body as ApiTheme[])[0]).toMatchObject({ id, name: 'mini-theme', path: themeRoot, present: true });
  });

  it('trả mảng rỗng khi chưa có theme nào', async () => {
    unregisterTheme(themeRoot);

    expect((await get('/api/themes')).body).toEqual([]);
  });

  it('hai theme trùng tên ở hai nơi có hai mã khác nhau', async () => {
    const second = path.join(tmp, 'elsewhere', 'mini-theme');
    await cp(FIXTURE, second, { recursive: true });
    await analyze(second);

    const themes = (await get('/api/themes')).body as ApiTheme[];

    expect(themes.map((theme) => theme.name)).toEqual(['mini-theme', 'mini-theme']);
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(2);
  });
});

describe('các route của một theme trả đúng kết quả của lõi', () => {
  it('overview: tổng quan kèm tình trạng đồ thị', async () => {
    const response = await get(`/api/themes/${id}/overview`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ overview: core(overview), status: await themeStatus(themeRoot) });
  });

  it('overview: báo đồ thị cũ khi một file đã đổi', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'card.liquid'), '<p>moi</p>');

    const body = (await get(`/api/themes/${id}/overview`)).body as { status: { stale: boolean; modified: string[] } };

    expect(body.status.stale).toBe(true);
    expect(body.status.modified).toEqual(['snippets/card.liquid']);
  });

  it('search: từ khoá, lọc loại, giới hạn', async () => {
    expect((await get(`/api/themes/${id}/search?q=card`)).body).toEqual(core((graph) => search(graph, 'card')));
    expect((await get(`/api/themes/${id}/search?q=card&limit=1`)).body).toEqual(
      core((graph) => search(graph, 'card', { limit: 1 })),
    );
    expect((await get(`/api/themes/${id}/search?kind=section,block`)).body).toEqual(
      core((graph) => search(graph, '', { kinds: ['section', 'block'] })),
    );
    // Không có q: liệt kê.
    expect((await get(`/api/themes/${id}/search`)).body).toEqual(core((graph) => search(graph, '')));
  });

  it('file: quan hệ trực tiếp và phạm vi ảnh hưởng của một file', async () => {
    const response = await get(`/api/themes/${id}/file?path=snippets/card.liquid`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      context: core((graph) => context(graph, 'snippets/card.liquid')),
      impact: core((graph) => impact(graph, 'snippets/card.liquid')),
    });
  });

  it('file: nhận cả tên trang, tên trần và id có ký tự đặc biệt', async () => {
    const page = (await get(`/api/themes/${id}/file?path=${encodeURIComponent('page:index')}`)).body as {
      context: { node: { id: string } };
    };
    const bare = (await get(`/api/themes/${id}/file?path=card`)).body as { context: { node: { id: string } } };
    const setting = await get(
      `/api/themes/${id}/file?path=${encodeURIComponent('setting:sections/hero.liquid#section.show_card')}`,
    );

    expect(page.context.node.id).toBe('page:index');
    expect(bare.context.node.id).toBe('snippets/card.liquid');
    expect(setting.status).toBe(200);
  });

  it('flow: cây render của một trang, có và không có giới hạn độ sâu', async () => {
    expect((await get(`/api/themes/${id}/flow?page=index`)).body).toEqual(core((graph) => renderFlow(graph, 'index')));
    expect((await get(`/api/themes/${id}/flow?page=index&depth=1`)).body).toEqual(
      core((graph) => renderFlow(graph, 'index', { maxDepth: 1 })),
    );
  });

  it('graph: mặc định chỉ file và trang; xin thêm nhóm bằng include', async () => {
    expect((await get(`/api/themes/${id}/graph`)).body).toEqual(core((graph) => exportGraph(graph)));
    expect((await get(`/api/themes/${id}/graph?include=translations,settings`)).body).toEqual(
      core((graph) => exportGraph(graph, { include: ['translations', 'settings'] })),
    );

    const translations = (await get(`/api/themes/${id}/graph?include=translations`)).body as {
      nodes: { kind: string }[];
    };
    expect(translations.nodes.some((node) => node.kind === 'translation_key')).toBe(true);
    expect(translations.nodes.some((node) => node.kind === 'setting')).toBe(false);
  });

  it('dead-code: danh sách file không dùng', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'old.liquid'), '<p>cu</p>');
    await analyze(themeRoot);

    const response = await get(`/api/themes/${id}/dead-code`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(core(deadCode));
    expect((response.body as { files: { id: string }[] }).files.map((entry) => entry.id)).toEqual(['snippets/old.liquid']);
  });

  it('HEAD được xử lý như GET', async () => {
    expect((await get('/api/themes', 'HEAD')).status).toBe(200);
  });
});

describe('lỗi', () => {
  it('404 theme_not_found khi mã không ứng với theme nào', async () => {
    const response = await get('/api/themes/000000000000/overview');

    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('theme_not_found');
    expect(errorOf(response).message).toContain('000000000000');
  });

  it('404 node_not_found kèm gợi ý khi không có file', async () => {
    const response = await get(`/api/themes/${id}/file?path=snippets/car`);

    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('node_not_found');
    expect(errorOf(response).suggestions).toContain('snippets/card.liquid');

    expect((await get(`/api/themes/${id}/flow?page=khong-co`)).status).toBe(404);
  });

  it('409 graph_not_ready khi theme trong sổ không còn graph.db', async () => {
    await rm(path.join(themeRoot, '.themegraph'), { recursive: true });

    const response = await get(`/api/themes/${id}/search?q=card`);

    expect(response.status).toBe(409);
    expect(errorOf(response)).toMatchObject({ code: 'graph_not_ready', reason: 'not_analyzed' });
    expect(errorOf(response).message).toContain('themegraph analyze');
    // Danh sách theme vẫn trả được, đánh dấu theme này là không còn.
    expect(((await get('/api/themes')).body as ApiTheme[])[0]?.present).toBe(false);
  });

  it('400 khi thiếu tham số bắt buộc', async () => {
    for (const url of [`/api/themes/${id}/file`, `/api/themes/${id}/file?path=`, `/api/themes/${id}/flow`]) {
      const response = await get(url);

      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('bad_request');
      expect(errorOf(response).message).toMatch(/Thiếu tham số "(path|page)"/);
    }
  });

  it('400 khi tham số số không hợp lệ', async () => {
    for (const url of [
      `/api/themes/${id}/flow?page=index&depth=0`,
      `/api/themes/${id}/flow?page=index&depth=abc`,
      `/api/themes/${id}/flow?page=index&depth=1.5`,
      `/api/themes/${id}/search?q=a&limit=-1`,
      `/api/themes/${id}/search?q=a&limit=1e3`,
    ]) {
      const response = await get(url);

      expect(response.status).toBe(400);
      expect(errorOf(response).message).toContain('phải là số nguyên');
    }
    // limit=0 hợp lệ.
    expect((await get(`/api/themes/${id}/search?q=card&limit=0`)).status).toBe(200);
  });

  it('400 khi kind hoặc include có giá trị lạ, và liệt kê các giá trị đúng', async () => {
    const kind = await get(`/api/themes/${id}/search?kind=snippets`);
    const include = await get(`/api/themes/${id}/graph?include=translations,all`);

    expect(kind.status).toBe(400);
    expect(errorOf(kind).message).toContain('"snippets"');
    expect(errorOf(kind).message).toContain('snippet, asset');
    expect(include.status).toBe(400);
    expect(errorOf(include).message).toContain('"all"');
    expect(errorOf(include).message).toContain('translations, settings');
  });

  it('404 not_found với đường dẫn không có', async () => {
    for (const url of ['/api', '/api/khac', '/khac/themes', `/khac/themes/${id}/overview`, `/api/themes/${id}`, `/api/themes/${id}/khong-co`, `/api/themes/${id}/search/thua`]) {
      const response = await get(url);

      expect(response.status).toBe(404);
      expect(errorOf(response).code).toBe('not_found');
    }
  });

  it('405 với mọi phương thức ngoài GET và HEAD, kể cả trên đường dẫn đúng', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await get('/api/themes', method);

      expect(response.status).toBe(405);
      expect(errorOf(response).code).toBe('method_not_allowed');
    }
  });

  it('không giữ graph.db sau khi trả lời, kể cả khi lỗi', async () => {
    await get(`/api/themes/${id}/file?path=snippets/card.liquid`);
    await get(`/api/themes/${id}/file?path=khong-co`);
    await get(`/api/themes/${id}/overview`);

    // Nếu database còn mở, Windows sẽ từ chối xoá file này.
    await expect(rm(path.join(themeRoot, '.themegraph', 'graph.db'))).resolves.toBeUndefined();
  });
});
