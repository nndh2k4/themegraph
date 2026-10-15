import { describe, expect, it } from 'vitest';

import { extractLiquidRefs } from '../src/analyze/parsers/liquid.parser.js';
import type { RefKind } from '../src/models/index.js';
import { file } from './helpers.js';

/**
 * Bộ tính giá trị theo thứ tự thực thi (xem liquid-values.ts): lệnh gán nào
 * với tới chỗ dùng, phép gán cộng dồn, và {% capture %}.
 */
const SNIPPET = file('snippets/x.liquid', 'snippet');

const names = (content: string, kind: RefKind) =>
  extractLiquidRefs(SNIPPET, content)
    .filter((ref) => ref.kind === kind)
    .map((ref) => ref.to);

describe('lệnh gán với tới chỗ dùng', () => {
  it('lệnh gán chắc chắn đã chạy che các lệnh gán cũ hơn', () => {
    const content = "{%- assign icon = 'a.svg' -%}{%- assign icon = 'b.svg' -%}{{ icon | asset_url }}";

    expect(names(content, 'asset')).toEqual(['b.svg']);
  });

  it('lệnh gán trong một nhánh chỉ cộng thêm khả năng', () => {
    const content = [
      "{%- assign icon = 'a.svg' -%}",
      "{%- if section.settings.alt -%}{%- assign icon = 'b.svg' -%}{%- endif -%}",
      '{{ icon | asset_url }}',
    ].join('\n');

    expect(names(content, 'asset')).toEqual(['a.svg', 'b.svg']);
  });

  it('lệnh gán đứng sau chỗ dùng không với tới, trừ khi cùng nằm trong một vòng lặp', () => {
    expect(names("{{ icon | asset_url }}{%- assign icon = 'late.svg' -%}", 'asset')).toEqual([]);

    const loop = "{%- for i in (1..2) -%}{{ icon | asset_url }}{%- assign icon = 'next.svg' -%}{%- endfor -%}";
    expect(names(loop, 'asset')).toEqual(['next.svg']);
  });

  it('tính được phép gán cộng dồn trong các nhánh if', () => {
    // Rút gọn từ theme Laurel, blocks/_product-information.liquid.
    const content = [
      '{%- liquid',
      "  assign rows = ''",
      "  if block.settings.show_sku",
      "    assign rows = rows | append: 'sku,'",
      '  endif',
      "  if block.settings.show_tags",
      "    assign rows = rows | append: 'tags,'",
      '  endif',
      "  assign rows = rows | split: ','",
      '-%}',
      "{%- for row in rows -%}{{ 'product.' | append: row | t }}{%- endfor -%}",
    ].join('\n');

    expect(names(content, 'translation')).toEqual(['product.sku', 'product.tags']);
  });

  it('phép gán tự tham chiếu trong vòng lặp vẫn tính được từ các lệnh gán trước nó', () => {
    // Rút gọn từ theme Laurel, sections/footer.liquid.
    const content = [
      '{%- for block in section.blocks -%}',
      '  {%- liquid',
      '    case block.type',
      "      when 'contact'",
      "        assign keys = 'footer.address,footer.phone'",
      "      when 'newsletter'",
      "        assign keys = 'footer.desc'",
      '    endcase',
      "    assign keys = keys | split: ','",
      '  -%}',
      '  {%- for key in keys -%}{{ key | t }}{%- endfor -%}',
      '{%- endfor -%}',
    ].join('\n');

    expect(names(content, 'translation')).toEqual(['footer.address', 'footer.phone', 'footer.desc']);
  });
});

describe('{% capture %}', () => {
  it('lấy phần thân in ra làm giá trị, theo dấu cắt khoảng trắng', () => {
    // Lấy từ theme Laurel, sections/header.liquid.
    const content = [
      '{%- for i in (1..2) -%}',
      '  {%- capture key -%} promotion_image_{{ i }} {%- endcapture -%}',
      '  {{ block.settings[key] }}',
      '{%- endfor -%}',
    ].join('\n');

    expect(names(content, 'setting')).toEqual(['block.settings.promotion_image_1', 'block.settings.promotion_image_2']);
  });

  it('giữ khoảng trắng khi không có dấu cắt', () => {
    expect(names("{% capture k %}a {{ 'b' }}{% endcapture %}{{ k | t }}", 'translation')).toEqual(['a b']);
  });

  it('gộp các nhánh if bên trong, và trong {% liquid %} chỉ echo mới in ra', () => {
    const branches = "{%- capture k -%}{%- if x -%}on{%- else -%}off{%- endif -%}.svg{%- endcapture -%}{{ k | asset_url }}";
    expect(names(branches, 'asset')).toEqual(['on.svg', 'off.svg']);

    const liquid = ['{%- liquid', '  capture k', "    echo 'icon'", "    echo '.svg'", '  endcapture', '-%}{{ k | asset_url }}'].join('\n');
    expect(names(liquid, 'asset')).toEqual(['icon.svg']);
  });

  it('không biết giá trị khi phần thân có thứ không in được khi đọc mã', () => {
    expect(names("{%- capture k -%}{{ product.handle }}.svg{%- endcapture -%}{{ k | asset_url }}", 'asset')).toEqual([]);
    expect(names("{%- capture k -%}{% render 'x' %}{%- endcapture -%}{{ k | asset_url }}", 'asset')).toEqual([]);
  });
});
