import { describe, expect, it } from 'vitest';

import { extractCssUrls } from '../src/analyze/parsers/css.parser.js';
import { buildGraph, file, parseFile } from './helpers.js';

describe('url() trong CSS', () => {
  it('lấy file tương đối trong assets/, bỏ URL ngoài và data:', () => {
    const css = [
      "@font-face { src: url('Font.woff2') format('woff2'), url(\"./Font.woff?v=2#iefix\"); }",
      '.a { background: url(icon.png); }',
      '.b { background: url(data:image/png;base64,AAA); mask: url(#m); }',
      '.c { background: url(https://cdn.x/a.png); background: url(//cdn/b.png); background: url(/cdn/shop/c.png); }',
      "/* .d { background: url('commented.png'); } */",
    ].join('\n');

    expect(extractCssUrls('assets/base.css', css).map((r) => [r.to, r.line, r.source, r.computed])).toEqual([
      ['Font.woff2', 1, 'css', true],
      ['Font.woff', 1, 'css', true],
      ['icon.png', 2, 'css', true],
    ]);
  });

  it('file .css và .mjs được phân tích', () => {
    expect(parseFile(file('assets/a.css', 'asset'), '.x{background:url(b.png)}').refs.map((r) => r.to)).toEqual(['b.png']);
    expect(parseFile(file('assets/a.mjs', 'asset'), 'import "./b.mjs";').refs.map((r) => r.to)).toEqual(['./b.mjs']);
  });

  it('.css.liquid cũng được trích url()', () => {
    const refs = parseFile(file('assets/a.css.liquid', 'asset'), ".x{background:url(b.png)}\n{{ 'c.png' | asset_url }}").refs;
    expect(refs.map((r) => [r.to, r.source])).toContainEqual(['b.png', 'css']);
  });

  it('font có thật thành cạnh USES_ASSET; đường dẫn cũ không còn file thì bị bỏ, không báo hỏng', () => {
    const css = file('assets/fonts.css', 'asset');
    const refs = extractCssUrls(css.path, "@font-face{src:url('A.woff2')} .x{background:url(cu.png)}");

    const graph = buildGraph([css, file('assets/A.woff2', 'asset')], refs);

    expect(graph.edges.map((e) => [e.from, e.to, e.type, e.sources])).toEqual([
      ['assets/fonts.css', 'assets/A.woff2', 'USES_ASSET', 'css'],
    ]);
    expect(graph.refs.map((r) => r.status)).toEqual(['resolved']);
  });
});
