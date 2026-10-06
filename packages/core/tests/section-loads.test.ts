import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { analyze } from '../src/analyze.js';
import { context } from '../src/context.js';
import { deadCode } from '../src/dead-code.js';
import { extractFile } from '../src/extract.js';
import { impact } from '../src/impact.js';
import { openGraph } from '../src/open.js';
import type { GraphHandle } from '../src/open.js';
import { renderFlow } from '../src/render-flow.js';
import { resolveRef } from '../src/resolver.js';
import { themeStatus } from '../src/status.js';
import { file, ref } from './helpers.js';

/**
 * Các test ở đây đi từ đầu tới cuối: file thật trên đĩa -> analyze -> truy vấn.
 * Chúng kiểm việc NỐI bộ trích section-do-JavaScript-tải vào đồ thị; bản thân
 * các mẫu chữ được kiểm ở extract-section-loads.test.ts.
 */
const FIXTURE = path.join(import.meta.dirname, 'fixtures/mini-theme');

let tmp: string;
let themeRoot: string;
let graph: GraphHandle | null = null;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-loads-'));
  themeRoot = path.join(tmp, 'mini-theme');
  await cp(FIXTURE, themeRoot, { recursive: true });

  // Một section không template nào chứa và không có preset: trước đây luôn bị
  // xếp vào "cần xem lại".
  await writeFile(path.join(themeRoot, 'sections', 'drawer.liquid'), "<p>d</p>{% render 'card' %}");
});

afterEach(async () => {
  graph?.close();
  graph = null;
  await rm(tmp, { recursive: true, force: true });
});

const write = (relative: string, content: string) => writeFile(path.join(themeRoot, relative), content);

/** Cho layout nạp một file trong assets/, tức đưa file đó lên mọi trang dùng layout. */
const loadFromLayout = (asset: string) =>
  appendFile(path.join(themeRoot, 'layout', 'theme.liquid'), `\n{{ '${asset}' | asset_url | script_tag }}`);

async function analyzed(): Promise<GraphHandle> {
  graph?.close();
  await analyze(themeRoot);
  graph = openGraph(themeRoot);
  return graph;
}

const edgesTo = (handle: GraphHandle, dst: string) =>
  handle.db
    .prepare('SELECT src, type, conditional, sources, count FROM edges WHERE dst = ? ORDER BY src')
    .all(dst)
    .map((row) => [row.src, row.type, row.conditional, row.sources, row.count]);

describe('section do JavaScript tải — thành cạnh trong đồ thị', () => {
  it('file .js có ?section_id=ten sinh cạnh LOADS_SECTION có điều kiện tới section đó', async () => {
    await write('assets/cart.js', 'fetch(`/cart?section_id=drawer`);\nfetch(`/cart?section_id=drawer`);');
    const handle = await analyzed();

    expect(edgesTo(handle, 'sections/drawer.liquid')).toEqual([['assets/cart.js', 'LOADS_SECTION', 1, 'js', 2]]);
  });

  it('đếm cạnh mới trong thống kê của analyze', async () => {
    await write('assets/cart.js', 'fetch(`/cart?section_id=drawer`);');
    const result = await analyze(themeRoot);

    expect(result.stats.edgesByType.LOADS_SECTION).toBe(1);
  });

  it('tên không ứng với section nào thì bị bỏ, không thành tham chiếu hỏng', async () => {
    await write('assets/cart.js', "fetch(`/cart?section_id=khong-co`);\nconst x = { section: 'cung-khong-co' };");
    const result = await analyze(themeRoot);
    const handle = await analyzed();

    expect(result.stats.edgesByType.LOADS_SECTION).toBeUndefined();
    expect(result.missing.map((entry) => entry.to)).not.toContain('khong-co');
    expect(handle.db.prepare("SELECT count(*) AS n FROM refs WHERE kind = 'section_load'").get()?.n).toBe(0);
  });

  it('ref tới section có thật được ghi vào bảng refs kèm số dòng', async () => {
    await write('assets/cart.js', '// dòng 1\nfetch(`/cart?section_id=drawer`);');
    const handle = await analyzed();

    expect(handle.db.prepare("SELECT src, name, source, line, status, target FROM refs WHERE kind = 'section_load'").all()).toEqual([
      { src: 'assets/cart.js', name: 'drawer', source: 'js', line: 2, status: 'resolved', target: 'sections/drawer.liquid' },
    ]);
  });

  it('một section tự xin lại chính nó không sinh cạnh', async () => {
    await write('sections/drawer.liquid', '<div data-url="/search?section_id=drawer"></div>');
    const handle = await analyzed();

    expect(edgesTo(handle, 'sections/drawer.liquid')).toEqual([]);
  });

  it('URL trong file Liquid cũng sinh cạnh, với nguồn là liquid', async () => {
    await appendFile(path.join(themeRoot, 'sections', 'hero.liquid'), '\n<div data-url="/recommendations?section_id=drawer"></div>');
    const handle = await analyzed();

    expect(edgesTo(handle, 'sections/drawer.liquid')).toEqual([['sections/hero.liquid', 'LOADS_SECTION', 1, 'liquid', 1]]);
  });

  it('file assets/*.js.liquid được quét như JavaScript', async () => {
    await write('assets/app.js.liquid', "const sections = [{ section: 'drawer' }];");
    const handle = await analyzed();

    expect(edgesTo(handle, 'sections/drawer.liquid')).toEqual([['assets/app.js.liquid', 'LOADS_SECTION', 1, 'js', 1]]);
  });

  it('trong file Liquid thường thì section: không được coi là tải section', async () => {
    await write('snippets/note.liquid', "{% render 'card', section: 'drawer' %}");
    const handle = await analyzed();

    expect(edgesTo(handle, 'sections/drawer.liquid')).toEqual([]);
  });
});

describe('section do JavaScript tải — hệ quả ở các truy vấn', () => {
  beforeEach(async () => {
    await write('assets/cart.js', 'fetch(`/cart?section_id=drawer`);');
  });

  it('dead-code: section hết bị báo khi file .js tải nó nằm trên một trang', async () => {
    await loadFromLayout('cart.js');
    const result = deadCode(await analyzed());

    expect(result.files.map((entry) => entry.id)).not.toContain('sections/drawer.liquid');
    expect(result.files.map((entry) => entry.id)).not.toContain('assets/cart.js');
  });

  it('dead-code: file .js không ai nạp thì cả nó lẫn section vẫn bị báo, section ghi rõ ai gọi nó', async () => {
    const result = deadCode(await analyzed());
    const drawer = result.files.find((entry) => entry.id === 'sections/drawer.liquid');

    expect(drawer).toEqual({
      id: 'sections/drawer.liquid',
      kind: 'section',
      confidence: 'review',
      reason: 'only_used_by_unused',
      usedBy: ['assets/cart.js'],
    });
    expect(result.files.map((entry) => entry.id)).toContain('assets/cart.js');
  });

  it('render-flow: section hiện trong cây của trang, dưới file .js, ở dạng có điều kiện', async () => {
    await loadFromLayout('cart.js');
    const result = renderFlow(await analyzed(), 'index');
    const drawer = result.files.find((entry) => entry.id === 'sections/drawer.liquid');

    // page -> template -> layout -> assets/cart.js -> section
    expect(drawer).toEqual({ id: 'sections/drawer.liquid', kind: 'section', depth: 4, certain: false });
  });

  it('impact: trang đi tới một snippet qua section được JavaScript tải', async () => {
    // Một snippet chỉ section drawer gọi.
    await write('snippets/drawer-only.liquid', '<p>x</p>');
    await write('sections/drawer.liquid', "{% render 'drawer-only' %}");
    await loadFromLayout('cart.js');

    const result = impact(await analyzed(), 'snippets/drawer-only.liquid');

    expect(result.pages.map((page) => [page.id, page.certain, page.via])).toContainEqual([
      'page:index',
      false,
      ['sections/drawer.liquid'],
    ]);
    expect(result.offPage).toEqual([]);
    // Không trang nào render drawer bằng Liquid hay JSON: mọi trang đều chỉ qua JavaScript.
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.pages.every((page) => page.scriptOnly)).toBe(true);
  });

  it('impact: tách trang render target ngay khi tải khỏi trang chỉ dính qua JavaScript', async () => {
    // Một snippet có đúng hai đường lên trang:
    //   - tĩnh:        templates/gift_card.liquid -> snippets/both.liquid
    //                  (template này không dùng layout, nên không có cart.js)
    //   - JavaScript:  layout -> assets/cart.js -> sections/drawer.liquid -> snippets/both.liquid
    await write('snippets/both.liquid', '<p>x</p>');
    await appendFile(path.join(themeRoot, 'templates', 'gift_card.liquid'), "\n{% render 'both' %}");
    await write('sections/drawer.liquid', "{% render 'both' %}");
    await loadFromLayout('cart.js');

    const result = impact(await analyzed(), 'snippets/both.liquid');
    const byPage = Object.fromEntries(result.pages.map((page) => [page.id, page.scriptOnly]));

    expect(byPage['page:gift_card']).toBe(false);
    expect(byPage['page:index']).toBe(true);
    expect(byPage['page:product']).toBe(true);
  });

  it('impact: target là khoá dịch vẫn phân biệt được hai loại trang', async () => {
    // Thêm một khoá dịch chỉ có hai nơi dùng: template gift_card và section drawer.
    const localePath = path.join(themeRoot, 'locales', 'en.default.json');
    const locale = JSON.parse(await readFile(localePath, 'utf8')) as Record<string, unknown>;
    await writeFile(localePath, JSON.stringify({ ...locale, only: { here: 'x' } }));
    await appendFile(path.join(themeRoot, 'templates', 'gift_card.liquid'), "\n{{ 'only.here' | t }}");
    await write('sections/drawer.liquid', "{{ 'only.here' | t }}");
    await loadFromLayout('cart.js');

    const result = impact(await analyzed(), 't:only.here');
    const byPage = Object.fromEntries(result.pages.map((page) => [page.id, page.scriptOnly]));

    expect(byPage['page:gift_card']).toBe(false);
    expect(byPage['page:index']).toBe(true);
  });

  it('context: file .js hiện trong "được gọi bởi" của section, kèm số dòng và loại cạnh', async () => {
    const result = context(await analyzed(), 'sections/drawer.liquid');

    expect(result.usedBy).toEqual([
      { id: 'assets/cart.js', kind: 'asset', type: 'LOADS_SECTION', conditional: true, count: 1, sources: 'js', lines: [1] },
    ]);
  });
});

describe('section do JavaScript tải — status', () => {
  it('sửa một file .js làm đồ thị cũ đi; sửa file css thì không', async () => {
    await write('assets/cart.js', 'fetch(`/cart?section_id=drawer`);');
    await analyze(themeRoot);

    await appendFile(path.join(themeRoot, 'assets', 'base.css'), '\nbody { margin: 0 }');
    expect((await themeStatus(themeRoot)).stale).toBe(false);

    await appendFile(path.join(themeRoot, 'assets', 'cart.js'), '\n// sửa');
    const status = await themeStatus(themeRoot);

    expect(status.stale).toBe(true);
    expect(status.modified).toEqual(['assets/cart.js']);
  });
});

describe('section do JavaScript tải — tầng trích và resolver', () => {
  it('extractFile trả ref section_load cho file .js, và không trích gì khác từ nó', () => {
    const extraction = extractFile(file('assets/cart.js', 'asset'), "fetch(`?section_id=a`); {% render 'x' %}");

    expect(extraction).toEqual({
      refs: [{ from: 'assets/cart.js', to: 'a', kind: 'section_load', source: 'js', conditional: true, line: 1 }],
      schema: null,
      translationKeys: [],
      settings: [],
    });
  });

  it('extractFile vẫn không đọc file css', () => {
    expect(extractFile(file('assets/base.css', 'asset'), 'a { b: url(?section_id=a) }').refs).toEqual([]);
  });

  it('extractFile giữ nguyên các ref Liquid và thêm ref section_load vào sau', () => {
    const refs = extractFile(file('sections/a.liquid', 'section'), "{% render 'x' %}\n<a href=\"?section_id=b\">").refs;

    expect(refs.map((entry) => [entry.kind, entry.to, entry.source, entry.line])).toEqual([
      ['render', 'x', 'liquid', 1],
      ['section_load', 'b', 'liquid', 2],
    ]);
  });

  it('resolver: tên có file thì ra sections/<tên>.liquid, không có thì "none" chứ không "missing"', () => {
    const known = new Set(['sections/drawer.liquid']);
    const load = (to: string) => ({ ...ref('assets/cart.js', 'section_load', to), source: 'js' as const });

    expect(resolveRef(load('drawer'), known)).toEqual({ status: 'resolved', path: 'sections/drawer.liquid' });
    expect(resolveRef(load('khong-co'), known)).toEqual({ status: 'none' });
  });
});
