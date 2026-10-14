import { describe, expect, it } from 'vitest';

import { extractLiquidRefs } from '../src/analyze/parsers/liquid.parser.js';
import type { RefKind } from '../src/models/index.js';
import { buildGraph, file } from './helpers.js';

/**
 * Tên file, khoá dịch và tên setting GHÉP từ chữ viết sẵn (xem liquid-values.ts):
 * tầng trích phải tính ra chúng, và tầng dựng đồ thị chỉ giữ những tên có thật.
 */
const SNIPPET = file('snippets/x.liquid', 'snippet');

/** Viết gọn các ref một loại thành [tên, dòng, có điều kiện, computed]. */
const refsOf = (content: string, kind: RefKind) =>
  extractLiquidRefs(SNIPPET, content)
    .filter((ref) => ref.kind === kind)
    .map((ref) => [ref.to, ref.line, ref.conditional, ref.computed === true]);

const assets = (content: string) => refsOf(content, 'asset').map(([to]) => to);

describe('tên ghép — tính được', () => {
  it('đi qua vòng for trên một khoảng số', () => {
    // Lấy từ theme Laurel, snippets/_mixed-content-preview.liquid.
    const content = [
      "{%- for i in (1..3) -%}",
      "  {%- liquid",
      "    assign slide_image = 'demo-slide-' | append: i | append: '.webp'",
      "  -%}",
      "  <img src=\"{{- slide_image | asset_url -}}\">",
      "{%- endfor -%}",
    ].join('\n');

    expect(refsOf(content, 'asset')).toEqual([
      ['demo-slide-1.webp', 5, true, true],
      ['demo-slide-2.webp', 5, true, true],
      ['demo-slide-3.webp', 5, true, true],
    ]);
  });

  it('đi theo assign, split, first và last của một danh sách viết sẵn', () => {
    // Import map của Laurel được sinh đúng kiểu này.
    const content = [
      "{%- assign modules = 'global:core,slide:module-carousel' | split: ',' -%}",
      '{%- for entry in modules -%}',
      "  {%- assign pair = entry | split: ':' -%}",
      "  \"{{ pair.first }}\": \"{{ pair.last | append: '.js' | asset_url }}\"",
      '{%- endfor -%}',
    ].join('\n');

    expect(assets(content)).toEqual(['core.js', 'module-carousel.js']);
  });

  it('nhận chuỗi viết sẵn có filter đứng trước asset_url', () => {
    expect(refsOf("{{ 'base' | append: '.css' | asset_url }}", 'asset')).toEqual([['base.css', 1, false, true]]);
  });

  it('gộp mọi giá trị của một biến được gán ở nhiều chỗ', () => {
    const content = [
      '{%- if section.settings.dark -%}',
      "  {%- assign logo = 'logo-dark.svg' -%}",
      '{%- else -%}',
      "  {%- assign logo = 'logo' | append: '.svg' -%}",
      '{%- endif -%}',
      '{{ logo | asset_url }}',
    ].join('\n');

    expect(assets(content)).toEqual(['logo-dark.svg', 'logo.svg']);
  });

  it('lấy mọi phần tử khi chỉ số của danh sách là biến', () => {
    const content = [
      "{%- assign keys = 'timer.days,timer.hours' | split: ',' -%}",
      '{%- for unit in units -%}{{ keys[forloop.index0] | t }}{%- endfor -%}',
    ].join('\n');

    expect(refsOf(content, 'translation')).toEqual([
      ['timer.days', 2, true, true],
      ['timer.hours', 2, true, true],
    ]);
  });

  it('tính khoá dịch, và tên setting đọc bằng settings[...]', () => {
    // Lấy từ Laurel, snippets/social-links.liquid.
    const content = [
      "{%- assign platforms = 'facebook,instagram' | split: ',' -%}",
      '{%- for platform in platforms -%}',
      '  {%- liquid',
      "    assign setting_key = 'social_' | append: platform",
      '    assign profile_url = settings[setting_key]',
      "    assign label = 'social.' | append: platform | t",
      '  -%}',
      '{%- endfor -%}',
    ].join('\n');

    expect(refsOf(content, 'setting')).toEqual([
      ['settings.social_facebook', 5, true, true],
      ['settings.social_instagram', 5, true, true],
    ]);
    expect(refsOf(content, 'translation').map(([to]) => to)).toEqual(['social.facebook', 'social.instagram']);
  });

  it('tính khoá của section.settings[...] và block.settings[...]', () => {
    const content = "{%- assign k = 'title' -%}{{ section.settings[k] }}{{ block.settings[k] }}";

    expect(refsOf(content, 'setting').map(([to]) => to)).toEqual(['section.settings.title', 'block.settings.title']);
  });
});

describe('tên ghép — không tính được thì không ghi gì', () => {
  it('bỏ qua khi một mảnh là biến của Shopify hay tham số của snippet', () => {
    expect(assets("{{ 'icon-' | append: product.type | append: '.svg' | asset_url }}")).toEqual([]);
    expect(assets("{{ 'icon-' | append: icon | asset_url }}")).toEqual([]);
    expect(assets('{{ settings.logo | asset_url }}')).toEqual([]);
    expect(refsOf('{{ section.settings[block.id] }}', 'setting')).toEqual([]);
  });

  it('bỏ qua cả biến khi một trong các lần gán không tính được', () => {
    const content = "{%- assign a = 'x.svg' -%}{%- assign a = product.handle -%}{{ a | asset_url }}";

    expect(assets(content)).toEqual([]);
  });

  it('bỏ qua filter chưa hỗ trợ', () => {
    expect(assets("{{ 'Icon Cart' | handleize | append: '.svg' | asset_url }}")).toEqual([]);
  });

  it('không treo với phép gán vòng', () => {
    expect(assets("{%- assign a = a | append: '.svg' -%}{{ a | asset_url }}")).toEqual([]);
  });

  it('dừng khi số giá trị vượt ngưỡng', () => {
    expect(assets('{%- for i in (1..1000) -%}{{ i | append: ".svg" | asset_url }}{%- endfor -%}')).toEqual([]);
  });

  it('không đánh dấu computed cho tên viết sẵn', () => {
    expect(refsOf("{{ 'base.css' | asset_url }}", 'asset')).toEqual([['base.css', 1, false, false]]);
  });
});

describe('tên ghép — tầng dựng đồ thị', () => {
  it('chỉ giữ tên có thật, không báo tên thừa là tham chiếu hỏng', () => {
    const content = "{%- for i in (1..3) -%}{{ 'slide-' | append: i | append: '.webp' | asset_url }}{%- endfor -%}";
    const files = [SNIPPET, file('assets/slide-1.webp', 'asset'), file('assets/slide-2.webp', 'asset')];

    const graph = buildGraph(files, extractLiquidRefs(SNIPPET, content));

    expect(graph.edges.map((edge) => [edge.to, edge.type, edge.conditional])).toEqual([
      ['assets/slide-1.webp', 'USES_ASSET', true],
      ['assets/slide-2.webp', 'USES_ASSET', true],
    ]);
    expect(graph.refs.map((ref) => [ref.to, ref.status])).toEqual([
      ['slide-1.webp', 'resolved'],
      ['slide-2.webp', 'resolved'],
    ]);
  });

  it('bỏ tên setting tính ra mà theme không khai', () => {
    const content = "{%- assign names = 'a,b' | split: ',' -%}{%- for p in names -%}{{ settings[p] }}{%- endfor -%}";

    const graph = buildGraph([SNIPPET], extractLiquidRefs(SNIPPET, content), { settings: ['setting:settings.a'] });

    expect(graph.refs.map((ref) => [ref.to, ref.status, ref.target])).toEqual([['settings.a', 'resolved', 'setting:settings.a']]);
  });
});
