import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCallContexts, contextKey } from '../src/analyze/call-context.js';
import { extractLiquid } from '../src/analyze/parsers/liquid.parser.js';
import type { GraphRepository } from '../src/graph/graph.repository.js';
import { core, file, openGraph, scopeOf } from './helpers.js';

/**
 * Ngữ cảnh gọi snippet (xem call-context.ts): những gì nơi gọi truyền vào
 * được đưa xuống snippet, để snippet hiểu tham số của nó.
 */
const callsOf = (path: string, kind: 'section' | 'snippet' | 'block', content: string) =>
  extractLiquid(file(path, kind), content).calls;

describe('lời gọi snippet và tham số', () => {
  it('ghi loại đối tượng kèm nguồn gốc, và giá trị viết sẵn', () => {
    const calls = callsOf(
      'sections/product.liquid',
      'section',
      "{%- assign st = section.settings -%}{% render 'gallery', section_st: st, icon: 'cart', size: product.size %}",
    );

    expect(calls).toEqual([
      {
        snippet: 'gallery',
        args: [
          { name: 'icon', kinds: [], values: ['cart'] },
          { name: 'section_st', kinds: [{ kind: 'section.settings', origins: ['sections/product.liquid'] }], values: null },
        ],
      },
    ]);
  });

  it('render ... for ... as ... truyền từng phần tử', () => {
    const [call] = callsOf('sections/s.liquid', 'section', "{% render 'slide' for section.blocks as slide %}");
    expect(call?.args).toEqual([{ name: 'slide', kinds: [{ kind: 'block', origins: ['sections/s.liquid'] }], values: null }]);
  });

  it('include truyền theo mọi biến của nơi gọi', () => {
    const [call] = callsOf('sections/s.liquid', 'section', "{%- assign icon = 'x' -%}{%- assign st = section.settings -%}{% include 'row' %}");
    expect(call?.args.map((arg) => arg.name)).toEqual(['icon', 'st']);
  });

  it('include truyền biến lặp block của section', () => {
    const [call] = callsOf('sections/s.liquid', 'section', "{%- for block in section.blocks -%}{% include 'row' %}{%- endfor -%}");
    expect(call?.args).toEqual([{ name: 'block', kinds: [{ kind: 'block', origins: ['sections/s.liquid'] }], values: null }]);
  });

  it('section có sẵn của snippet truyền đi mang theo file truyền nó', () => {
    const [call] = callsOf('snippets/a.liquid', 'snippet', "{% render 'x', st: section.settings %}");
    expect(call?.args).toEqual([{ name: 'st', kinds: [{ kind: 'section.settings', origins: ['@ancestor-sections:snippets/a.liquid'] }], values: null }]);
  });
});

describe('buildCallContexts', () => {
  it('gộp mọi nơi gọi theo snippet, giữ nguồn gốc của từng nơi', () => {
    const contexts = buildCallContexts([
      [{ snippet: 'card', args: [{ name: 'st', kinds: [{ kind: 'section.settings', origins: ['sections/a.liquid'] }], values: null }] }],
      [
        { snippet: 'card', args: [{ name: 'st', kinds: [{ kind: 'section.settings', origins: ['sections/b.liquid'] }], values: ['x'] }] },
        { snippet: 'icon', args: [{ name: 'name', kinds: [], values: null }] },
      ],
    ]);

    expect([...contexts.keys()]).toEqual(['snippets/card.liquid']);
    const card = contexts.get('snippets/card.liquid');
    expect(card?.kinds.get('st')).toEqual([{ kind: 'section.settings', origins: ['sections/a.liquid', 'sections/b.liquid'] }]);
    expect(card?.values.get('st')).toEqual(['x']);
    expect(contextKey(card)).toBe(contextKey(card));
    expect(contextKey(undefined)).toBe('');
  });
});

describe('ngữ cảnh gọi — từ đầu tới cuối', () => {
  const FIXTURE = path.join(import.meta.dirname, 'fixtures/mini-theme');
  let tmp: string;
  let themeRoot: string;
  let graph: GraphRepository | null = null;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-context-'));
    themeRoot = path.join(tmp, 'mini-theme');
    await cp(FIXTURE, themeRoot, { recursive: true });
    await mkdir(path.join(themeRoot, 'assets'), { recursive: true });
  });

  afterEach(async () => {
    graph?.close();
    graph = null;
    await rm(tmp, { recursive: true, force: true });
  });

  const write = (relative: string, content: string) => writeFile(path.join(themeRoot, relative), content);
  const schema = (settings: string[]) =>
    `{% schema %}${JSON.stringify({ name: 'x', presets: [{ name: 'x' }], settings: settings.map((id) => ({ id, type: 'text' })) })}{% endschema %}`;

  async function analyzed(): Promise<GraphRepository> {
    await core().analyzer.analyze(themeRoot);
    graph = openGraph(themeRoot);
    return graph;
  }

  const readers = (handle: GraphRepository, setting: string) =>
    handle
      .edgesTo(setting)
      .filter((edge) => edge.type === 'READS_SETTING')
      .map((edge) => edge.from);

  it('theo bộ setting qua nhiều tầng snippet, chỉ tới đúng section đã truyền nó', async () => {
    // product truyền section.settings xuống gallery, gallery chuyển tiếp cho media.
    // other cũng render gallery nhưng không truyền gì: setting cùng tên của nó vẫn không ai đọc.
    await write('sections/product.liquid', `{%- assign st = section.settings -%}{% render 'gallery', section_st: st %}${schema(['zoom'])}`);
    await write('sections/other.liquid', `{% render 'gallery' %}${schema(['zoom'])}`);
    await write('snippets/gallery.liquid', "{% render 'media', section_st: section_st %}");
    await write('snippets/media.liquid', '{{ section_st.zoom }}');

    const handle = await analyzed();

    expect(readers(handle, 'setting:sections/product.liquid#section.zoom')).toEqual(['snippets/media.liquid']);
    expect(readers(handle, 'setting:sections/other.liquid#section.zoom')).toEqual([]);
    expect(scopeOf(handle).deadCode.findUnused().unusedSettings).toContain('sections/other.liquid#section.zoom');
  });

  it('settings: block.settings chỉ nối tới block đã truyền bộ setting của nó', async () => {
    await write('sections/main.liquid', `{% content_for 'block', type: 'a', id: 'a' %}{% content_for 'block', type: 'b', id: 'b' %}${schema([])}`);
    await mkdir(path.join(themeRoot, 'blocks'), { recursive: true });
    await write('blocks/a.liquid', `{% render 'spacing', settings: block.settings %}${schema(['padding'])}`);
    await write('blocks/b.liquid', `{% render 'spacing' %}${schema(['padding'])}`);
    await write('snippets/spacing.liquid', '{{ settings.padding }}');

    const handle = await analyzed();

    expect(readers(handle, 'setting:blocks/a.liquid#block.padding')).toEqual(['snippets/spacing.liquid']);
    expect(readers(handle, 'setting:blocks/b.liquid#block.padding')).toEqual([]);
  });

  it('block có sẵn trong snippet chỉ là theme block đang render, không phải block cục bộ của section', async () => {
    await write('sections/list.liquid', `{%- for block in section.blocks -%}{% render 'card', block: block %}{%- endfor -%}{% schema %}{"name":"l","presets":[{"name":"l"}],"blocks":[{"type":"c","name":"c","settings":[{"id":"title","type":"text"}]}]}{% endschema %}`);
    await write('sections/header.liquid', `{%- for block in section.blocks -%}{% render 'card' %}{%- endfor -%}{% schema %}{"name":"h","presets":[{"name":"h"}],"blocks":[{"type":"c","name":"c","settings":[{"id":"title","type":"text"}]}]}{% endschema %}`);
    await write('snippets/card.liquid', '{{ block.settings.title }}');

    const handle = await analyzed();

    expect(readers(handle, 'setting:sections/list.liquid#block.title')).toEqual(['snippets/card.liquid']);
    expect(readers(handle, 'setting:sections/header.liquid#block.title')).toEqual([]);
  });

  it('include dùng chung biến lặp block của section', async () => {
    await write('sections/list.liquid', `{%- for block in section.blocks -%}{% include 'row' %}{%- endfor -%}{% schema %}{"name":"l","presets":[{"name":"l"}],"blocks":[{"type":"c","name":"c","settings":[{"id":"title","type":"text"}]}]}{% endschema %}`);
    await write('snippets/row.liquid', '{{ block.settings.title }}');

    const handle = await analyzed();

    expect(readers(handle, 'setting:sections/list.liquid#block.title')).toEqual(['snippets/row.liquid']);
  });

  it('section.settings mà snippet chuyển tiếp chỉ tới section tổ tiên của snippet đó', async () => {
    // product render outer, outer chuyển section.settings cho inner; other render inner trực tiếp mà không truyền gì.
    await write('sections/product.liquid', `{% render 'outer' %}${schema(['zoom'])}`);
    await write('sections/other.liquid', `{% render 'inner' %}${schema(['zoom'])}`);
    await write('snippets/outer.liquid', "{% render 'inner', st: section.settings %}");
    await write('snippets/inner.liquid', '{{ st.zoom }}');

    const handle = await analyzed();

    expect(readers(handle, 'setting:sections/product.liquid#section.zoom')).toEqual(['snippets/inner.liquid']);
    expect(readers(handle, 'setting:sections/other.liquid#section.zoom')).toEqual([]);
  });

  it('giá trị viết sẵn truyền vào snippet thành tên file và khoá dịch', async () => {
    await write('sections/main.liquid', `{% render 'icon', name: 'cart' %}{% render 'icon', name: 'search' %}${schema([])}`);
    await write('snippets/icon.liquid', "{{ 'icon-' | append: name | append: '.svg' | asset_url }}");
    await write('assets/icon-cart.svg', '<svg/>');
    await write('assets/icon-search.svg', '<svg/>');

    const handle = await analyzed();

    expect(handle.edgesFrom('snippets/icon.liquid').map((edge) => edge.to)).toEqual(['assets/icon-cart.svg', 'assets/icon-search.svg']);
  });
});
