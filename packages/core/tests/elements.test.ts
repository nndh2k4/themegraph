import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { analyze } from '../src/analyze.js';
import { deadCode } from '../src/dead-code.js';
import type { DeadCodeResult } from '../src/dead-code.js';
import { extractFile } from '../src/extract.js';
import { formatDeadCode, formatOverview } from '../src/format.js';
import { buildGraph } from '../src/graph.js';
import { openGraph } from '../src/open.js';
import { overview } from '../src/overview.js';
import { graphDbPath } from '../src/store.js';
import type { ElementRole, FileElement, RawRef, ThemeFile, ThemeGraph } from '../src/types.js';
import { file, ref, removeTempTheme, saveToTempTheme } from './helpers.js';

const tempDirs: string[] = [];
const tempThemes: string[] = [];

afterEach(async () => {
  for (const themeRoot of tempThemes.splice(0)) await removeTempTheme(themeRoot);
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Một dòng của bảng elements. */
const el = (name: string, role: ElementRole, inFile: string, line = 1): FileElement => ({ name, role, file: inFile, line });

/** Một theme tối thiểu: một trang, một template, một section đang được dùng. */
const BASE_FILES: ThemeFile[] = [
  file('layout/theme.liquid', 'layout'),
  file('templates/index.json', 'template'),
  file('sections/hero.liquid', 'section'),
  file('config/settings_schema.json', 'config'),
  file('locales/en.default.json', 'locale'),
];
const BASE_REFS: RawRef[] = [ref('templates/index.json', 'section', 'hero', { source: 'json', line: 0 })];

/** Dựng theme tối thiểu cộng thêm file, quan hệ và custom element; rồi chạy deadCode. */
async function deadCodeWith(files: ThemeFile[], elements: FileElement[], refs: RawRef[] = []): Promise<DeadCodeResult> {
  const themeRoot = await saveToTempTheme(buildGraph([...BASE_FILES, ...files], [...BASE_REFS, ...refs], { elements }));
  tempThemes.push(themeRoot);

  const handle = openGraph(themeRoot);
  try {
    return deadCode(handle);
  } finally {
    handle.close();
  }
}

const ids = (result: DeadCodeResult) => result.files.map((entry) => entry.id);

describe('extractFile — custom element', () => {
  it('trích từ file .js và file .liquid, không trích từ loại file khác', () => {
    const js = extractFile(file('assets/x.js', 'asset'), `customElements.define("x-el", X);`);
    const liquid = extractFile(file('sections/hero.liquid', 'section'), `<x-el></x-el>`);
    const css = extractFile(file('assets/base.css', 'asset'), `x-el { color: red } /* <x-el> */`);
    const json = extractFile(file('templates/index.json', 'template'), `{"sections":{},"order":[],"note":"<x-el>"}`);

    expect(js.elements).toEqual([{ name: 'x-el', role: 'define', line: 1 }]);
    expect(liquid.elements).toEqual([{ name: 'x-el', role: 'use', line: 1 }]);
    expect(css.elements).toEqual([]);
    expect(json.elements).toEqual([]);
  });

  it('vẫn trích các quan hệ khác của file như trước', () => {
    const liquid = extractFile(file('sections/hero.liquid', 'section'), `{% render 'card' %}\n<x-el></x-el>`);
    const js = extractFile(file('assets/x.js', 'asset'), `fetch("/?section_id=cart-drawer"); customElements.define("x-el", X);`);

    expect(liquid.refs.map((r) => `${r.kind} ${r.to}`)).toEqual(['render card']);
    expect(js.refs.map((r) => `${r.kind} ${r.to}`)).toEqual(['section_load cart-drawer']);
  });
});

describe('buildGraph — custom element', () => {
  const FILES = [...BASE_FILES, file('assets/x.js', 'asset'), file('assets/y.js', 'asset')];

  it('không có dữ kiện thì danh sách rỗng', () => {
    expect(buildGraph(FILES, []).elements).toEqual([]);
  });

  it('giữ mọi định nghĩa, và chỉ giữ lần dùng của thẻ mà theme có định nghĩa', () => {
    const graph = buildGraph(FILES, [], {
      elements: [
        el('x-el', 'define', 'assets/x.js', 3),
        el('x-el', 'use', 'sections/hero.liquid', 7),
        // Thẻ của một app hay của Shopify: không file nào trong theme định nghĩa.
        el('shopify-thing', 'use', 'sections/hero.liquid'),
        // Định nghĩa mà không ai dùng vẫn được giữ.
        el('y-el', 'define', 'assets/y.js'),
      ],
    });

    expect(graph.elements).toEqual([
      el('x-el', 'define', 'assets/x.js', 3),
      el('x-el', 'use', 'sections/hero.liquid', 7),
      el('y-el', 'define', 'assets/y.js'),
    ]);
  });

  it('bỏ dòng của file không có trong theme, kể cả khi đó là định nghĩa duy nhất của thẻ', () => {
    const graph = buildGraph(FILES, [], {
      elements: [el('z-el', 'define', 'assets/khong-co.js'), el('z-el', 'use', 'sections/hero.liquid')],
    });

    expect(graph.elements).toEqual([]);
  });

  it('xếp theo tên thẻ, rồi vai trò, rồi file; không phụ thuộc thứ tự đầu vào', () => {
    const rows = [
      el('b-el', 'use', 'sections/hero.liquid'),
      el('b-el', 'use', 'layout/theme.liquid'),
      el('b-el', 'define', 'assets/y.js'),
      el('a-el', 'use', 'sections/hero.liquid'),
      el('a-el', 'define', 'assets/x.js'),
    ];
    const expected = [rows[4], rows[3], rows[2], rows[1], rows[0]];

    expect(buildGraph(FILES, [], { elements: rows }).elements).toEqual(expected);
    expect(buildGraph(FILES, [], { elements: [...rows].reverse() }).elements).toEqual(expected);
  });

  it('không thêm node hay cạnh nào', () => {
    const without = buildGraph(FILES, BASE_REFS);
    const withElements = buildGraph(FILES, BASE_REFS, {
      elements: [el('x-el', 'define', 'assets/x.js'), el('x-el', 'use', 'sections/hero.liquid')],
    });

    expect(withElements.nodes).toEqual(without.nodes);
    expect(withElements.edges).toEqual(without.edges);
  });
});

describe('saveGraph — bảng elements', () => {
  it('ghi từng dòng với đủ bốn cột', async () => {
    const graph: ThemeGraph = buildGraph([...BASE_FILES, file('assets/x.js', 'asset')], BASE_REFS, {
      elements: [el('x-el', 'define', 'assets/x.js', 19), el('x-el', 'use', 'sections/hero.liquid', 56)],
    });
    const themeRoot = await saveToTempTheme(graph);
    tempThemes.push(themeRoot);

    const db = new DatabaseSync(graphDbPath(themeRoot), { readOnly: true });
    try {
      const rows = db.prepare('SELECT name, role, file, line FROM elements ORDER BY role').all();

      expect(rows.map((row) => ({ ...row }))).toEqual([
        { name: 'x-el', role: 'define', file: 'assets/x.js', line: 19 },
        { name: 'x-el', role: 'use', file: 'sections/hero.liquid', line: 56 },
      ]);
    } finally {
      db.close();
    }
  });
});

describe('deadCode — asset có nơi dùng thẻ mà không ai nạp', () => {
  const X = file('assets/x.js', 'asset');

  it('tách asset đó khỏi danh sách file không dùng, kèm thẻ và file viết thẻ', async () => {
    const result = await deadCodeWith([X], [el('x-el', 'define', 'assets/x.js'), el('x-el', 'use', 'sections/hero.liquid')]);

    expect(result.notLoaded).toEqual([
      { id: 'assets/x.js', elements: [{ name: 'x-el', usedBy: ['sections/hero.liquid'] }], usedBy: [] },
    ]);
    expect(result.files).toEqual([]);
    expect(result.review).toBe(0);
    expect(result.certain).toBe(0);
  });

  it('không tách khi không ai viết thẻ: asset vẫn là file cần xem lại', async () => {
    const result = await deadCodeWith([X], [el('x-el', 'define', 'assets/x.js')]);

    expect(result.notLoaded).toEqual([]);
    expect(result.files).toMatchObject([{ id: 'assets/x.js', confidence: 'review', reason: 'unreferenced' }]);
    expect(result.review).toBe(1);
  });

  it('không tách khi file viết thẻ cũng không trang nào dùng', async () => {
    const result = await deadCodeWith(
      [X, file('snippets/old.liquid', 'snippet')],
      [el('x-el', 'define', 'assets/x.js'), el('x-el', 'use', 'snippets/old.liquid')],
    );

    expect(result.notLoaded).toEqual([]);
    expect(ids(result)).toEqual(['snippets/old.liquid', 'assets/x.js']);
  });

  it('không tách khi một file đang dùng khác cũng định nghĩa thẻ đó', async () => {
    // hero tự định nghĩa thẻ trong một thẻ <script>: thẻ vẫn chạy, x.js là bản thừa.
    const inline = await deadCodeWith(
      [X],
      [el('x-el', 'define', 'assets/x.js'), el('x-el', 'define', 'sections/hero.liquid'), el('x-el', 'use', 'sections/hero.liquid')],
    );
    // Một asset đang được nạp cũng định nghĩa nó.
    const loaded = await deadCodeWith(
      [X, file('assets/bundle.js', 'asset')],
      [el('x-el', 'define', 'assets/x.js'), el('x-el', 'define', 'assets/bundle.js'), el('x-el', 'use', 'sections/hero.liquid')],
      [ref('sections/hero.liquid', 'asset', 'bundle.js')],
    );

    expect(inline.notLoaded).toEqual([]);
    expect(ids(inline)).toEqual(['assets/x.js']);
    expect(loaded.notLoaded).toEqual([]);
    expect(ids(loaded)).toEqual(['assets/x.js']);
  });

  it('vẫn tách khi file định nghĩa còn lại cũng không ai nạp: cả hai đều được báo', async () => {
    const result = await deadCodeWith(
      [X, file('assets/x-copy.js', 'asset')],
      [el('x-el', 'define', 'assets/x.js'), el('x-el', 'define', 'assets/x-copy.js'), el('x-el', 'use', 'sections/hero.liquid')],
    );

    expect(result.notLoaded.map((asset) => asset.id)).toEqual(['assets/x-copy.js', 'assets/x.js']);
    expect(result.files).toEqual([]);
  });

  it('asset đang được nạp thì không bị báo ở đâu cả', async () => {
    const result = await deadCodeWith(
      [X],
      [el('x-el', 'define', 'assets/x.js'), el('x-el', 'use', 'sections/hero.liquid')],
      [ref('sections/hero.liquid', 'asset', 'x.js')],
    );

    expect(result.notLoaded).toEqual([]);
    expect(result.files).toEqual([]);
  });

  it('chỉ liệt kê thẻ có nơi dùng; thẻ và file viết thẻ xếp theo tên', async () => {
    const result = await deadCodeWith(
      [X, file('snippets/old.liquid', 'snippet')],
      [
        el('z-el', 'define', 'assets/x.js'),
        el('a-el', 'define', 'assets/x.js'),
        el('m-el', 'define', 'assets/x.js'),
        el('z-el', 'use', 'sections/hero.liquid'),
        el('z-el', 'use', 'layout/theme.liquid'),
        // File không dùng viết thẻ thì không được kể, kể cả khi thẻ còn nơi dùng khác.
        el('z-el', 'use', 'snippets/old.liquid'),
        el('a-el', 'use', 'sections/hero.liquid'),
        // m-el không ai viết.
      ],
    );

    expect(result.notLoaded).toEqual([
      {
        id: 'assets/x.js',
        elements: [
          { name: 'a-el', usedBy: ['sections/hero.liquid'] },
          { name: 'z-el', usedBy: ['layout/theme.liquid', 'sections/hero.liquid'] },
        ],
        usedBy: [],
      },
    ]);
  });

  it('asset tự viết thẻ của chính nó thì không tính là có nơi dùng', async () => {
    const result = await deadCodeWith([X], [el('x-el', 'define', 'assets/x.js'), el('x-el', 'use', 'assets/x.js')]);

    expect(result.notLoaded).toEqual([]);
    expect(ids(result)).toEqual(['assets/x.js']);
  });

  it('asset không dùng chỉ VIẾT thẻ (không định nghĩa) thì không được tách', async () => {
    // y.js tạo thẻ bằng createElement nhưng không định nghĩa nó: nạp y.js không làm thẻ chạy.
    const result = await deadCodeWith(
      [X, file('assets/y.js', 'asset')],
      [el('x-el', 'define', 'assets/x.js'), el('x-el', 'use', 'assets/y.js'), el('x-el', 'use', 'sections/hero.liquid')],
    );

    expect(result.notLoaded.map((asset) => asset.id)).toEqual(['assets/x.js']);
    expect(ids(result)).toEqual(['assets/y.js']);
  });

  it('asset chỉ được nạp bởi một file không dùng vẫn được tách, kèm file nạp nó', async () => {
    const result = await deadCodeWith(
      [X, file('snippets/old.liquid', 'snippet')],
      [el('x-el', 'define', 'assets/x.js'), el('x-el', 'use', 'sections/hero.liquid')],
      [ref('snippets/old.liquid', 'asset', 'x.js')],
    );

    expect(result.notLoaded).toEqual([
      { id: 'assets/x.js', elements: [{ name: 'x-el', usedBy: ['sections/hero.liquid'] }], usedBy: ['snippets/old.liquid'] },
    ]);
    expect(ids(result)).toEqual(['snippets/old.liquid']);
  });

  it('section mà asset đó tải vẫn nằm trong danh sách không dùng', async () => {
    const result = await deadCodeWith(
      [X, file('sections/drawer.liquid', 'section')],
      [el('x-el', 'define', 'assets/x.js'), el('x-el', 'use', 'sections/hero.liquid')],
      [ref('assets/x.js', 'section_load', 'drawer', { source: 'js', conditional: true })],
    );

    expect(result.notLoaded.map((asset) => asset.id)).toEqual(['assets/x.js']);
    expect(result.files).toEqual([
      { id: 'sections/drawer.liquid', kind: 'section', confidence: 'review', reason: 'only_used_by_unused', usedBy: ['assets/x.js'] },
    ]);
    expect(result.review).toBe(1);
  });

  it('file không phải asset định nghĩa thẻ thì không được tách', async () => {
    // Một section không ai dùng có <script> định nghĩa thẻ: nạp nó không phải là thêm một thẻ <script>.
    const result = await deadCodeWith(
      [file('sections/old.liquid', 'section')],
      [el('x-el', 'define', 'sections/old.liquid'), el('x-el', 'use', 'sections/hero.liquid')],
    );

    expect(result.notLoaded).toEqual([]);
    expect(ids(result)).toEqual(['sections/old.liquid']);
  });

  it('overview đếm riêng nhóm này, không cộng vào số file cần xem lại', async () => {
    const themeRoot = await saveToTempTheme(
      buildGraph([...BASE_FILES, X, file('assets/old.png', 'asset')], BASE_REFS, {
        elements: [el('x-el', 'define', 'assets/x.js'), el('x-el', 'use', 'sections/hero.liquid')],
      }),
    );
    tempThemes.push(themeRoot);

    const handle = openGraph(themeRoot);
    try {
      const result = overview(handle);

      expect(result.unused).toMatchObject({ certain: 0, review: 1, notLoaded: 1 });
      expect(formatOverview(result).join('\n')).toContain('Dùng mà không nạp  1 file JavaScript');
    } finally {
      handle.close();
    }
  });
});

describe('formatDeadCode — nhóm dùng mà không nạp', () => {
  const EMPTY: DeadCodeResult = {
    files: [],
    certain: 0,
    review: 0,
    notLoaded: [],
    acceptsThemeBlocks: false,
    unusedTranslationKeys: [],
    unusedSettings: [],
  };

  it('không in gì về nhóm này khi nó rỗng', () => {
    expect(formatDeadCode(EMPTY)).toEqual(['Không tìm thấy file nào không được dùng.']);
  });

  it('in mỗi thẻ một dòng, kèm lời khuyên không xoá', () => {
    const lines = formatDeadCode({
      ...EMPTY,
      notLoaded: [
        {
          id: 'assets/x.js',
          elements: [
            { name: 'a-el', usedBy: ['sections/hero.liquid'] },
            { name: 'z-el', usedBy: ['layout/theme.liquid', 'sections/hero.liquid'] },
          ],
          usedBy: [],
        },
      ],
    });

    expect(lines).toEqual([
      'Không tìm thấy file nào không được dùng.',
      '',
      'Có nơi dùng thẻ nhưng không trang nào nạp file (1), KHÔNG xoá:',
      '  assets/x.js  định nghĩa <a-el>, được viết ở sections/hero.liquid',
      '  assets/x.js  định nghĩa <z-el>, được viết ở layout/theme.liquid, sections/hero.liquid',
      '  File định nghĩa một custom element mà theme đang viết ra, nhưng không thẻ <script> nào nạp nó:',
      '  thẻ hiện trên trang mà JavaScript của nó không chạy. Cách chữa là nạp file, không phải xoá.',
    ]);
  });

  it('đứng sau danh sách file không dùng và trước mục khoá dịch', () => {
    const lines = formatDeadCode({
      ...EMPTY,
      files: [{ id: 'snippets/old.liquid', kind: 'snippet', confidence: 'certain', reason: 'unreferenced', usedBy: [] }],
      certain: 1,
      notLoaded: [{ id: 'assets/x.js', elements: [{ name: 'a-el', usedBy: ['sections/hero.liquid'] }], usedBy: [] }],
      unusedTranslationKeys: ['a.b'],
    });
    const at = (text: string) => lines.findIndex((line) => line.includes(text));

    expect(at('Chắc chắn không dùng')).toBeGreaterThan(-1);
    expect(at('Có nơi dùng thẻ')).toBeGreaterThan(at('snippets/old.liquid'));
    expect(at('Khoá dịch')).toBeGreaterThan(at('Có nơi dùng thẻ'));
  });

  it('cắt danh sách theo --limit', () => {
    const lines = formatDeadCode(
      {
        ...EMPTY,
        notLoaded: [
          { id: 'assets/x.js', elements: [{ name: 'a-el', usedBy: ['s.liquid'] }, { name: 'b-el', usedBy: ['s.liquid'] }], usedBy: [] },
        ],
      },
      { limit: 1 },
    );

    expect(lines.filter((line) => line.includes('định nghĩa <'))).toHaveLength(1);
    expect(lines.join('\n')).toContain('... và 1 dòng nữa');
  });
});

describe('analyze — custom element, từ file thật tới dead-code', () => {
  const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'mini-theme');

  /** Chép fixture ra thư mục tạm, thêm file JavaScript và thẻ, rồi phân tích. */
  async function themeWith(options: { loadScript: boolean }): Promise<DeadCodeResult> {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-elements-'));
    tempDirs.push(tmp);
    const themeRoot = path.join(tmp, 'mini-theme');
    await cp(FIXTURE, themeRoot, { recursive: true });

    await writeFile(
      path.join(themeRoot, 'assets', 'disclosures.js'),
      [
        'class DisclosuresClose extends HTMLElement {}',
        '',
        'if (!customElements.get("disclosures-close")) {',
        '  customElements.define("disclosures-close", DisclosuresClose);',
        '}',
      ].join('\n'),
    );

    const hero = path.join(themeRoot, 'sections', 'hero.liquid');
    const script = options.loadScript ? `<script src="{{ 'disclosures.js' | asset_url }}" defer></script>\n` : '';
    await writeFile(hero, `${script}<disclosures-close class="x"></disclosures-close>\n${await readFile(hero, 'utf8')}`);

    await analyze(themeRoot);

    const handle = openGraph(themeRoot);
    try {
      return deadCode(handle);
    } finally {
      handle.close();
    }
  }

  it('thiếu thẻ <script>: file JavaScript được báo là có nơi dùng mà không ai nạp', async () => {
    const result = await themeWith({ loadScript: false });

    expect(result.notLoaded).toEqual([
      { id: 'assets/disclosures.js', elements: [{ name: 'disclosures-close', usedBy: ['sections/hero.liquid'] }], usedBy: [] },
    ]);
    expect(ids(result)).not.toContain('assets/disclosures.js');
  });

  it('có thẻ <script>: không còn gì để báo về file đó', async () => {
    const result = await themeWith({ loadScript: true });

    expect(result.notLoaded).toEqual([]);
    expect(ids(result)).not.toContain('assets/disclosures.js');
  });
});
