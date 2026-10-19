import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractImports, extractInlineScriptImports } from '../src/analyze/parsers/js-imports.parser.js';
import { extractLiquidRefs } from '../src/analyze/parsers/liquid.parser.js';
import type { GraphRepository } from '../src/graph/graph.repository.js';
import type { FileImportMapEntry } from '../src/models/index.js';
import { buildGraph, core, file, openGraph, parseFile, ref, scopeOf } from './helpers.js';

/**
 * Module JavaScript: import trong mã, import map in ra từ Liquid, và việc nối
 * hai thứ đó thành cạnh USES_ASSET giữa các file trong assets/.
 */

/** Viết gọn kết quả thành [specifier, dòng, có điều kiện]. */
const imports = (content: string) =>
  extractImports('assets/app.js', content).map((entry) => [entry.to, entry.line, entry.conditional]);

const importMapOf = (content: string) => parseFile(file('snippets/import-map.liquid', 'snippet'), content).importMap;

describe('extractImports — các cách viết', () => {
  it('lấy import tĩnh, export ... from và import động', () => {
    const content = [
      'import "@theme/global";',
      "import { Cart } from './cart.js';",
      'import * as motion from "./motion.js";',
      'import Default, { a as b } from "./c.js";',
      'export { x } from "./x.js";',
      'export * from "./y.js";',
      'const m = await import("@theme/switcher");',
      "import('./lazy.js').then((m) => m.run());",
    ].join('\n');

    expect(imports(content)).toEqual([
      ['@theme/global', 1, false],
      ['./cart.js', 2, false],
      ['./motion.js', 3, false],
      ['./c.js', 4, false],
      ['./x.js', 5, false],
      ['./y.js', 6, false],
      ['@theme/switcher', 7, true],
      ['./lazy.js', 8, true],
    ]);
  });

  it('đọc được import trải nhiều dòng và mã đã nén', () => {
    expect(imports('import {\n  a,\n  b,\n} from "./ab.js";')).toEqual([['./ab.js', 1, false]]);
    expect(imports('import t from"./t.js";export{t as default}')).toEqual([['./t.js', 1, false]]);
  });

  it('bỏ qua chú thích, chuỗi và specifier là biểu thức', () => {
    const content = [
      '// import "./commented.js";',
      '/* import "./block.js"; */',
      'const url = "https://cdn.example.com/x.js"; import "./real.js";',
      'const label = "import";',
      'el.dataset.import = "x";',
      'import(`./${name}.js`);',
      'import(path);',
    ].join('\n');

    expect(imports(content)).toEqual([['./real.js', 3, false]]);
  });

  it('trong file Liquid chỉ đọc import tĩnh bên trong <script type="module">', () => {
    const content = [
      '<p>import "./not-code.js"</p>',
      '<script type="module">',
      "  import { open } from '@theme/dialog';",
      '</script>',
      '<script>import "./classic.js"</script>',
    ].join('\n');

    expect(extractInlineScriptImports('sections/x.liquid', content).map((entry) => [entry.to, entry.line])).toEqual([
      ['@theme/dialog', 3],
    ]);
  });

  it('trong <script> thường chỉ đọc import() động, không đọc import tĩnh', () => {
    // Trình duyệt cho import() chạy trong mọi script, còn import tĩnh chỉ hợp
    // lệ trong type="module".
    const content = [
      "<script>document.addEventListener('click', () => import('@t/a'))</script>",
      '<script>import "./classic.js"</script>',
      '<script type="module">',
      "  import { open } from '@theme/dialog';",
      "  import('@theme/lazy');",
      '</script>',
      "<p>import('@t/not-code')</p>",
      '<script type="importmap">{ "imports": { "@t/a": "import(\'@t/in-map\')" } }</script>',
      "<script data-type=\"module\">import { x } from '@t/not-module';</script>",
    ].join('\n');

    expect(extractInlineScriptImports('sections/x.liquid', content).map((entry) => [entry.to, entry.line, entry.conditional])).toEqual([
      ['@t/a', 1, true],
      ['@theme/dialog', 4, false],
      ['@theme/lazy', 5, true],
    ]);
  });
});

describe('import map — đọc từ Liquid', () => {
  it('đọc import map viết tay', () => {
    const content = [
      '<script type="importmap">',
      '  { "imports": {',
      "    \"@theme/global\": \"{{ 'core.js' | asset_url }}\",",
      "    \"@theme/cart\": {{ 'cart.js' | asset_url | json }},",
      '    "lodash": "https://cdn.example.com/lodash.js"',
      '  } }',
      '</script>',
    ].join('\n');

    expect(importMapOf(content)).toEqual([
      { specifier: '@theme/global', asset: 'core.js' },
      { specifier: '@theme/cart', asset: 'cart.js' },
    ]);
  });

  it('đọc import map sinh bằng vòng lặp, giữ đúng từng cặp khoá và file', () => {
    // Rút gọn từ theme Laurel, snippets/theme-import-map.liquid.
    const content = [
      '{%- liquid',
      "  assign modules = 'global:core,modal:dialog,cart:cart-main' | split: ','",
      '-%}',
      '<script type="importmap">',
      '  { "imports": {',
      '    {%- for entry in modules -%}',
      "      {%- assign pair = entry | split: ':' -%}",
      "      \"@theme/{{ pair.first }}\": \"{{ pair.last | append: '.js' | asset_url }}\"{% unless forloop.last %},{% endunless %}",
      '    {%- endfor -%}',
      '  } }',
      '</script>',
    ].join('\n');

    expect(importMapOf(content)).toEqual([
      { specifier: '@theme/global', asset: 'core.js' },
      { specifier: '@theme/modal', asset: 'dialog.js' },
      { specifier: '@theme/cart', asset: 'cart-main.js' },
    ]);
  });

  it('không lấy gì ngoài thẻ importmap', () => {
    const content = [
      "<script>window.assets = { \"main\": \"{{ 'main.js' | asset_url }}\" };</script>",
      '{% if true %}<script type="importmap">{ "imports": { "a": "{{ \'a.js\' | asset_url }}" } }</script>{% endif %}',
    ].join('\n');

    expect(importMapOf(content)).toEqual([{ specifier: 'a', asset: 'a.js' }]);
  });

  it('trả mảng rỗng cho file không có import map', () => {
    expect(importMapOf("{{ 'a.js' | asset_url | script_tag }}")).toEqual([]);
    expect(parseFile(file('assets/app.js', 'asset'), 'import "./a.js";').importMap).toEqual([]);
  });
});

describe('import — tầng dựng đồ thị', () => {
  const APP = 'assets/app.js';
  const FILES = [file(APP, 'asset'), file('assets/core.js', 'asset'), file('assets/cart.js', 'asset'), file('sections/x.liquid', 'section')];
  const MAP: FileImportMapEntry[] = [{ file: 'snippets/import-map.liquid', specifier: '@theme/global', asset: 'core.js' }];

  const build = (...refs: ReturnType<typeof ref>[]) => buildGraph(FILES, refs, { importMap: MAP });

  it('đổi specifier qua import map và theo đường dẫn tương đối, thành cạnh USES_ASSET', () => {
    const graph = build(
      ref(APP, 'import', '@theme/global', { source: 'js' }),
      ref(APP, 'import', './cart.js?v=3', { source: 'js', conditional: true, line: 2 }),
    );

    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.type, edge.conditional, edge.sources])).toEqual([
      [APP, 'assets/cart.js', 'USES_ASSET', true, 'js'],
      [APP, 'assets/core.js', 'USES_ASSET', false, 'js'],
    ]);
  });

  it('báo import hỏng khi đích không có trong theme', () => {
    const graph = build(ref(APP, 'import', './gone.js', { source: 'js' }));

    expect(graph.refs.map((entry) => [entry.to, entry.status, entry.target])).toEqual([['./gone.js', 'missing', 'assets/gone.js']]);
  });

  it('bỏ import tới thứ không phải file của theme', () => {
    const graph = build(
      ref(APP, 'import', 'https://cdn.example.com/x.js', { source: 'js' }),
      ref(APP, 'import', 'lodash', { source: 'js' }),
      ref(APP, 'import', '../outside.js', { source: 'js' }),
      // Trong file Liquid, đường dẫn tương đối tính theo URL của trang, không theo assets/.
      ref('sections/x.liquid', 'import', './core.js', { source: 'js' }),
    );

    expect(graph.refs).toEqual([]);
    expect(graph.edges).toEqual([]);
  });
});

describe('import — từ đầu tới cuối', () => {
  const FIXTURE = path.join(import.meta.dirname, 'fixtures/mini-theme');
  let tmp: string;
  let themeRoot: string;
  let graph: GraphRepository | null = null;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-modules-'));
    themeRoot = path.join(tmp, 'mini-theme');
    await cp(FIXTURE, themeRoot, { recursive: true });
  });

  afterEach(async () => {
    graph?.close();
    graph = null;
    await rm(tmp, { recursive: true, force: true });
  });

  it('module chỉ được nạp qua import map và import không còn bị coi là không dùng', async () => {
    const write = (relative: string, content: string) => writeFile(path.join(themeRoot, relative), content);
    await mkdir(path.join(themeRoot, 'assets'), { recursive: true });

    await write(
      'snippets/import-map.liquid',
      [
        "{%- assign modules = 'global:core,spare:mapped-only' | split: ',' -%}",
        '<script type="importmap">{ "imports": {',
        "{%- for entry in modules -%}{%- assign pair = entry | split: ':' -%}",
        "\"@theme/{{ pair.first }}\": \"{{ pair.last | append: '.js' | asset_url }}\"",
        '{%- endfor -%}',
        '} }</script>',
      ].join('\n'),
    );
    await write('assets/app.js', 'import "@theme/global";\nimport("./lazy.js");');
    await write('assets/core.js', 'export const x = 1;');
    await write('assets/lazy.js', 'export const y = 2;');
    await write('assets/orphan.js', 'export const z = 3;');
    await write('assets/mapped-only.js', 'export const w = 4;');
    await appendFile(
      path.join(themeRoot, 'layout', 'theme.liquid'),
      "\n{% render 'import-map' %}<script type=\"module\" src=\"{{ 'app.js' | asset_url }}\"></script>",
    );

    await core().analyzer.analyze(themeRoot);
    graph = openGraph(themeRoot);

    const unused = scopeOf(graph).deadCode.findUnused().files.map((entry) => entry.id);
    expect(unused).toContain('assets/orphan.js');
    // Chỉ có trong import map mà không ai import: không có gì nạp nó.
    expect(unused).toContain('assets/mapped-only.js');
    expect(unused).not.toContain('assets/core.js');
    expect(unused).not.toContain('assets/lazy.js');

    // Mục import map chỉ là ánh xạ: không thành cạnh từ snippet in nó ra.
    expect(graph.edgesTo('assets/core.js').map((edge) => [edge.from, edge.type])).toEqual([['assets/app.js', 'USES_ASSET']]);
  });

  it('import() động trong <script> thường của file Liquid nối tới module qua import map', async () => {
    await mkdir(path.join(themeRoot, 'assets'), { recursive: true });
    await writeFile(
      path.join(themeRoot, 'snippets', 'lazy-loader.liquid'),
      [
        '<script type="importmap">{ "imports": { "@t/a": "{{ \'a.js\' | asset_url }}" } }</script>',
        "<script>document.addEventListener('click', () => import('@t/a'))</script>",
      ].join('\n'),
    );
    await writeFile(path.join(themeRoot, 'assets', 'a.js'), 'export const a = 1;');
    await appendFile(path.join(themeRoot, 'layout', 'theme.liquid'), "\n{% render 'lazy-loader' %}");

    await core().analyzer.analyze(themeRoot);
    graph = openGraph(themeRoot);

    expect(graph.edgesTo('assets/a.js').map((edge) => [edge.from, edge.type, edge.conditional])).toEqual([
      ['snippets/lazy-loader.liquid', 'USES_ASSET', true],
    ]);
    expect(scopeOf(graph).deadCode.findUnused().files.map((entry) => entry.id)).not.toContain('assets/a.js');
  });
});

describe('asset_url theo chỗ in ra', () => {
  const usages = (content: string) =>
    extractLiquidRefs(file('snippets/head.liquid', 'snippet'), content)
      .filter((r) => r.kind === 'asset')
      .map((r) => [r.to, r.usage ?? 'load']);

  it('phân biệt nạp thật, mục import map và URL đưa cho JS', () => {
    const content = [
      "<script src=\"{{ 'app.js' | asset_url }}\" type=\"module\"></script>",
      "{{ 'base.css' | asset_url | stylesheet_tag }}",
      '<script type="importmap">{"imports": {"@t/core": "{{ \'core.js\' | asset_url }}"}}</script>',
      "<script>window.cfg = { slider: {{ 'slider.js' | asset_url | json }}, zoom: \"{{ 'zoom.js' | asset_url }}\" };</script>",
      "<div data-src=\"{{ 'lazy.js' | asset_url }}\"></div>",
    ].join('\n');

    expect(usages(content)).toEqual([
      ['app.js', 'load'],
      ['base.css', 'load'],
      ['core.js', 'map'],
      ['slider.js', 'url'],
      ['zoom.js', 'url'],
      ['lazy.js', 'load'],
    ]);
  });

  it('URL đưa cho JS ngoài thẻ script: json đứng sau asset_url mới tính', () => {
    const content = [
      "<div data-cfg=\"{{ 'a.js' | asset_url | json }}\"></div>",
      "<div data-cfg=\"{{ cfg | json | append: 'b.js' | asset_url }}\"></div>",
    ].join('\n');

    expect(usages(content)).toEqual([['a.js', 'url']]);
  });

  it('tên tính ra trong import map cũng là mục map', () => {
    const content = [
      "{%- assign mods = 'a,b' | split: ',' -%}",
      '<script type="importmap">{ "imports": {',
      "{%- for m in mods -%}\"@t/{{ m }}\": \"{{ m | append: '.js' | asset_url }}\",{%- endfor -%}",
      '} }</script>',
    ].join('\n');

    expect(usages(content)).toEqual([
      ['a.js', 'map'],
      ['b.js', 'map'],
    ]);
  });
});
