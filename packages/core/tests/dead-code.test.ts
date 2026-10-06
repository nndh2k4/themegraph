import { afterEach, describe, expect, it } from 'vitest';

import { deadCode } from '../src/dead-code.js';
import type { DeadCodeResult } from '../src/dead-code.js';
import { buildGraph } from '../src/graph.js';
import { openGraph } from '../src/open.js';
import type { FileSchema, RawRef, ThemeFile, ThemeGraph } from '../src/types.js';
import { file, QUERY_SCHEMAS, queryGraph, ref, removeTempTheme, saveToTempTheme } from './helpers.js';

const tempThemes: string[] = [];

afterEach(async () => {
  for (const themeRoot of tempThemes.splice(0)) await removeTempTheme(themeRoot);
});

/** Ghi một đồ thị ra thư mục tạm, chạy deadCode trên nó, rồi đóng database. */
async function deadCodeOf(graph: ThemeGraph): Promise<DeadCodeResult> {
  const themeRoot = await saveToTempTheme(graph);
  tempThemes.push(themeRoot);

  const handle = openGraph(themeRoot);
  try {
    return deadCode(handle);
  } finally {
    handle.close();
  }
}

/** Một theme tối thiểu: một trang, một template, một section đang được dùng. */
const BASE_FILES: ThemeFile[] = [
  file('layout/theme.liquid', 'layout'),
  file('templates/index.json', 'template'),
  file('sections/hero.liquid', 'section'),
  file('config/settings_schema.json', 'config'),
  file('locales/en.default.json', 'locale'),
];
const BASE_REFS: RawRef[] = [ref('templates/index.json', 'section', 'hero', { source: 'json', line: 0 })];

/** Dựng theme tối thiểu cộng thêm vài file và quan hệ, rồi chạy deadCode. */
const withExtra = (files: ThemeFile[], refs: RawRef[] = [], schemas: FileSchema[] = []) =>
  deadCodeOf(buildGraph([...BASE_FILES, ...files], [...BASE_REFS, ...refs], { schemas }));

/** Viết gọn kết quả thành [id, mức tin cậy, lý do]. */
const rows = (result: DeadCodeResult) => result.files.map((f) => [f.id, f.confidence, f.reason]);

describe('deadCode — đồ thị mẫu', () => {
  it('liệt kê file không trang nào dùng, mức chắc chắn trước', async () => {
    const result = await deadCodeOf(queryGraph());

    expect(rows(result)).toEqual([
      ['blocks/_unused.liquid', 'certain', 'unreferenced'],
      ['snippets/orphan-child.liquid', 'certain', 'only_used_by_unused'],
      ['snippets/orphan.liquid', 'certain', 'unreferenced'],
      ['assets/icon.svg', 'review', 'only_used_by_unused'],
      ['assets/unused.png', 'review', 'unreferenced'],
      ['sections/api-only.liquid', 'review', 'unreferenced'],
      ['snippets/api-row.liquid', 'review', 'only_used_by_unused'],
    ]);
  });

  it('đếm số file theo từng mức', async () => {
    const result = await deadCodeOf(queryGraph());

    expect(result.certain).toBe(3);
    expect(result.review).toBe(4);
  });

  it('liệt kê khoá dịch không file nào dùng, không kèm tiền tố t:', async () => {
    const result = await deadCodeOf(queryGraph());

    expect(result.unusedTranslationKeys).toEqual(['general.unused']);
  });

  it('liệt kê setting không file nào đọc, không kèm tiền tố setting:', async () => {
    const result = await deadCodeOf(queryGraph());

    expect(result.unusedSettings).toEqual(['sections/grid.liquid#section.columns']);
  });

  it('không đưa setting vào danh sách file', async () => {
    const result = await deadCodeOf(queryGraph());

    expect(result.files.some((f) => f.kind === 'setting')).toBe(false);
  });

  it('không đưa khoá dịch vào danh sách file', async () => {
    const result = await deadCodeOf(queryGraph());

    expect(result.files.some((f) => f.kind === 'translation_key')).toBe(false);
    expect(result.certain + result.review).toBe(result.files.length);
  });

  it('ghi kind và danh sách file đang gọi tới từng file', async () => {
    const result = await deadCodeOf(queryGraph());
    const pick = (id: string) => result.files.find((f) => f.id === id);

    expect(pick('snippets/orphan.liquid')).toEqual({
      id: 'snippets/orphan.liquid',
      kind: 'snippet',
      confidence: 'certain',
      reason: 'unreferenced',
      usedBy: [],
    });
    expect(pick('snippets/orphan-child.liquid')?.usedBy).toEqual(['snippets/orphan.liquid']);
    expect(pick('assets/icon.svg')).toMatchObject({ kind: 'asset', usedBy: ['snippets/orphan.liquid'] });
  });

  it('không báo section có preset, cũng không báo những gì nó gọi', async () => {
    const ids = (await deadCodeOf(queryGraph())).files.map((f) => f.id);

    // Chưa template nào dùng featured, nhưng merchant thêm được từ theme editor.
    expect(ids).not.toContain('sections/featured.liquid');
    expect(ids).not.toContain('snippets/featured-item.liquid');
  });

  it('báo section mất preset ở mức cần xem lại, kéo theo snippet chỉ nó gọi', async () => {
    const schemas = QUERY_SCHEMAS.map((s) => (s.file === 'sections/featured.liquid' ? { ...s, presets: 0 } : s));

    const result = await deadCodeOf(queryGraph(schemas));

    expect(rows(result)).toContainEqual(['sections/featured.liquid', 'review', 'unreferenced']);
    expect(rows(result)).toContainEqual(['snippets/featured-item.liquid', 'review', 'only_used_by_unused']);
  });

  it('không báo theme block công khai khi có file nhận @theme', async () => {
    const result = await deadCodeOf(queryGraph());

    expect(result.acceptsThemeBlocks).toBe(true);
    expect(result.files.map((f) => f.id)).not.toContain('blocks/text.liquid');
  });

  it('báo theme block công khai là chắc chắn khi không file nào nhận @theme', async () => {
    const schemas = QUERY_SCHEMAS.map((s) => ({ ...s, acceptsThemeBlocks: false }));

    const result = await deadCodeOf(queryGraph(schemas));

    expect(result.acceptsThemeBlocks).toBe(false);
    expect(rows(result)).toContainEqual(['blocks/text.liquid', 'certain', 'unreferenced']);
  });

  it('luôn báo block riêng tư không ai gọi, dù có file nhận @theme', async () => {
    // "@theme" chỉ mở cửa cho block công khai; block có tên bắt đầu bằng "_"
    // phải được gọi đích danh.
    const result = await deadCodeOf(queryGraph());

    expect(rows(result)).toContainEqual(['blocks/_unused.liquid', 'certain', 'unreferenced']);
    expect(result.files.map((f) => f.id)).not.toContain('blocks/_used.liquid');
  });

  it('không báo file đang được một trang dùng, kể cả qua vòng hay lời gọi có điều kiện', async () => {
    const ids = (await deadCodeOf(queryGraph())).files.map((f) => f.id);

    for (const live of [
      'layout/theme.liquid',
      'assets/base.css',
      'sections/header-group.json',
      'sections/cart.liquid',
      'sections/promo.liquid', // chỉ tới được qua template thay thế
      'snippets/card.liquid', // có một lời gọi nằm trong {% if %}
      'snippets/a.liquid',
      'snippets/b.liquid',
      'snippets/menu.liquid',
    ]) {
      expect(ids).not.toContain(live);
    }
  });
});

describe('deadCode — từng quy tắc', () => {
  it('trả danh sách rỗng cho theme không có file thừa', async () => {
    const result = await withExtra([]);

    expect(result).toEqual({
      files: [],
      certain: 0,
      review: 0,
      acceptsThemeBlocks: false,
      unusedTranslationKeys: [],
      unusedSettings: [],
      notLoaded: [],
    });
  });

  it('xếp khoá dịch không dùng theo tên, bỏ khoá đang được dùng', async () => {
    const graph = buildGraph(
      BASE_FILES,
      [...BASE_REFS, ref('sections/hero.liquid', 'translation', 'b.used', { conditional: true })],
      { translationKeys: ['z.last', 'b.used', 'a.first'] },
    );

    expect((await deadCodeOf(graph)).unusedTranslationKeys).toEqual(['a.first', 'z.last']);
  });

  it('xếp setting không đọc theo id, bỏ setting đang được đọc', async () => {
    const graph = buildGraph(BASE_FILES, [...BASE_REFS, ref('sections/hero.liquid', 'setting', 'settings.used')], {
      settings: ['setting:settings.zeta', 'setting:settings.used', 'setting:sections/hero.liquid#section.alpha'],
    });

    expect((await deadCodeOf(graph)).unusedSettings).toEqual(['sections/hero.liquid#section.alpha', 'settings.zeta']);
  });

  it('không bao giờ báo template, config hay locale', async () => {
    // Template thay thế không trang nào khác gọi, config và locale không có
    // cạnh nào: cả ba đều không phải mã chết.
    const result = await withExtra([file('templates/page.contact.json', 'template')]);

    expect(result.files).toEqual([]);
  });

  it('mức chắc chắn: snippet và section group không ai gọi', async () => {
    const result = await withExtra([
      file('snippets/old.liquid', 'snippet'),
      file('sections/old-group.json', 'section_group'),
    ]);

    expect(rows(result)).toEqual([
      ['sections/old-group.json', 'certain', 'unreferenced'],
      ['snippets/old.liquid', 'certain', 'unreferenced'],
    ]);
  });

  it('mức cần xem lại: section không preset, asset và layout không ai gọi', async () => {
    const result = await withExtra([
      file('sections/drawer.liquid', 'section'),
      file('assets/icon-cart.svg', 'asset'),
      file('layout/password.liquid', 'layout'),
    ]);

    expect(rows(result)).toEqual([
      ['assets/icon-cart.svg', 'review', 'unreferenced'],
      ['layout/password.liquid', 'review', 'unreferenced'],
      ['sections/drawer.liquid', 'review', 'unreferenced'],
    ]);
  });

  it('mức cần xem lại lan xuống mọi tầng bên dưới một file cần xem lại', async () => {
    const result = await withExtra(
      [
        file('sections/drawer.liquid', 'section'),
        file('snippets/drawer-item.liquid', 'snippet'),
        file('snippets/drawer-price.liquid', 'snippet'),
      ],
      [ref('sections/drawer.liquid', 'render', 'drawer-item'), ref('snippets/drawer-item.liquid', 'render', 'drawer-price')],
    );

    expect(rows(result)).toEqual([
      ['sections/drawer.liquid', 'review', 'unreferenced'],
      ['snippets/drawer-item.liquid', 'review', 'only_used_by_unused'],
      ['snippets/drawer-price.liquid', 'review', 'only_used_by_unused'],
    ]);
  });

  it('một file được cả file chết lẫn file cần xem lại gọi thì là cần xem lại', async () => {
    const result = await withExtra(
      [
        file('sections/drawer.liquid', 'section'),
        file('snippets/old.liquid', 'snippet'),
        file('snippets/shared.liquid', 'snippet'),
      ],
      [ref('sections/drawer.liquid', 'render', 'shared'), ref('snippets/old.liquid', 'render', 'shared')],
    );

    const shared = result.files.find((f) => f.id === 'snippets/shared.liquid');

    expect(shared).toMatchObject({
      confidence: 'review',
      reason: 'only_used_by_unused',
      usedBy: ['sections/drawer.liquid', 'snippets/old.liquid'],
    });
  });

  it('section không preset chỉ được file chết gọi vẫn là cần xem lại', async () => {
    const result = await withExtra(
      [file('sections/old-group.json', 'section_group'), file('sections/drawer.liquid', 'section')],
      [ref('sections/old-group.json', 'section', 'drawer', { source: 'json', line: 0 })],
    );

    expect(rows(result)).toEqual([
      ['sections/old-group.json', 'certain', 'unreferenced'],
      ['sections/drawer.liquid', 'review', 'only_used_by_unused'],
    ]);
  });

  it('hai snippet chỉ gọi lẫn nhau đều là mã chết', async () => {
    const result = await withExtra(
      [file('snippets/x.liquid', 'snippet'), file('snippets/y.liquid', 'snippet')],
      [ref('snippets/x.liquid', 'render', 'y'), ref('snippets/y.liquid', 'render', 'x')],
    );

    expect(rows(result)).toEqual([
      ['snippets/x.liquid', 'certain', 'only_used_by_unused'],
      ['snippets/y.liquid', 'certain', 'only_used_by_unused'],
    ]);
  });

  it('snippet chỉ tự gọi chính nó được coi là không ai gọi', async () => {
    const result = await withExtra(
      [file('snippets/loop.liquid', 'snippet')],
      [ref('snippets/loop.liquid', 'render', 'loop')],
    );

    expect(result.files).toEqual([
      { id: 'snippets/loop.liquid', kind: 'snippet', confidence: 'certain', reason: 'unreferenced', usedBy: [] },
    ]);
  });

  it('preset chỉ cứu section, không cứu block', async () => {
    // Block riêng tư có preset vẫn phải được gọi đích danh mới dùng được.
    const result = await withExtra(
      [file('blocks/_badge.liquid', 'block')],
      [],
      [{ file: 'blocks/_badge.liquid', presets: 1, acceptsThemeBlocks: false }],
    );

    expect(rows(result)).toEqual([['blocks/_badge.liquid', 'certain', 'unreferenced']]);
  });

  it('@theme mở cửa cho block công khai dù file khai nó là block, miễn block đó đang được dùng', async () => {
    // hero (có preset) gọi đích danh block riêng tư _group, và _group nhận
    // "@theme": merchant thêm được text vào _group.
    const result = await withExtra(
      [
        file('sections/hero.liquid', 'section'),
        file('blocks/_group.liquid', 'block'),
        file('blocks/text.liquid', 'block'),
        file('blocks/_note.liquid', 'block'),
      ],
      [ref('sections/hero.liquid', 'block', '_group', { source: 'schema' })],
      [
        { file: 'sections/hero.liquid', presets: 1, acceptsThemeBlocks: false },
        { file: 'blocks/_group.liquid', presets: 0, acceptsThemeBlocks: true },
      ],
    );

    expect(result.acceptsThemeBlocks).toBe(true);
    expect(rows(result)).toEqual([['blocks/_note.liquid', 'certain', 'unreferenced']]);
  });

  it('file nhận @theme mà chính nó không ai dùng thì không cứu được block công khai', async () => {
    // Trường hợp thật ở theme Purity: file duy nhất nhận "@theme" là một
    // block riêng tư không ai gọi. Không có nó trên trang nào thì merchant
    // cũng không thêm được block nào vào nó.
    const result = await withExtra(
      [file('blocks/_slide.liquid', 'block'), file('blocks/text.liquid', 'block'), file('snippets/text-icon.liquid', 'snippet')],
      [ref('blocks/text.liquid', 'render', 'text-icon')],
      [{ file: 'blocks/_slide.liquid', presets: 0, acceptsThemeBlocks: true }],
    );

    expect(result.acceptsThemeBlocks).toBe(false);
    expect(rows(result)).toEqual([
      ['blocks/_slide.liquid', 'certain', 'unreferenced'],
      ['blocks/text.liquid', 'certain', 'unreferenced'],
      ['snippets/text-icon.liquid', 'certain', 'only_used_by_unused'],
    ]);
  });

  it('block công khai nhận @theme mà không ai dùng thì không tự cứu mình', async () => {
    const result = await withExtra(
      [file('blocks/group.liquid', 'block'), file('blocks/text.liquid', 'block')],
      [],
      [{ file: 'blocks/group.liquid', presets: 0, acceptsThemeBlocks: true }],
    );

    expect(rows(result)).toEqual([
      ['blocks/group.liquid', 'certain', 'unreferenced'],
      ['blocks/text.liquid', 'certain', 'unreferenced'],
    ]);
  });

  it('file nhận @theme chỉ ở mức cần xem lại thì block công khai cũng cần xem lại', async () => {
    // Section không preset có thể được JavaScript tải; nếu vậy merchant thêm
    // được block vào nó. Những gì block đó gọi cũng theo mức ấy.
    const result = await withExtra(
      [
        file('sections/drawer.liquid', 'section'),
        file('blocks/text.liquid', 'block'),
        file('blocks/_note.liquid', 'block'),
        file('snippets/text-icon.liquid', 'snippet'),
        file('snippets/alone.liquid', 'snippet'),
      ],
      [ref('blocks/text.liquid', 'render', 'text-icon')],
      [{ file: 'sections/drawer.liquid', presets: 0, acceptsThemeBlocks: true }],
    );

    expect(result.acceptsThemeBlocks).toBe(false);
    expect(rows(result)).toEqual([
      // Block riêng tư không được "@theme" mở cửa, nên vẫn chắc chắn.
      ['blocks/_note.liquid', 'certain', 'unreferenced'],
      // Một snippet không liên quan gì tới block cũng không bị kéo theo.
      ['snippets/alone.liquid', 'certain', 'unreferenced'],
      ['blocks/text.liquid', 'review', 'unreferenced'],
      ['sections/drawer.liquid', 'review', 'unreferenced'],
      ['snippets/text-icon.liquid', 'review', 'only_used_by_unused'],
    ]);
  });

  it('block công khai được mở cửa lại kéo theo file nhận @theme khác', async () => {
    // hero (đang dùng) nhận "@theme" -> group công khai được coi là đang dùng
    // -> group gọi đích danh _inner.
    const result = await withExtra(
      [file('sections/hero.liquid', 'section'), file('blocks/group.liquid', 'block'), file('blocks/_inner.liquid', 'block')],
      [ref('blocks/group.liquid', 'block', '_inner', { source: 'schema' })],
      [{ file: 'sections/hero.liquid', presets: 1, acceptsThemeBlocks: true }],
    );

    expect(result.files).toEqual([]);
  });

  it('những gì block công khai gọi cũng được coi là đang dùng', async () => {
    const result = await withExtra(
      [file('blocks/text.liquid', 'block'), file('snippets/text-icon.liquid', 'snippet')],
      [ref('blocks/text.liquid', 'render', 'text-icon')],
      [{ file: 'sections/hero.liquid', presets: 1, acceptsThemeBlocks: true }],
    );

    expect(result.files).toEqual([]);
  });
});
