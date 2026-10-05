import { describe, expect, it } from 'vitest';

import { extractLiquidRefs } from '../src/extract-liquid.js';
import type { ThemeFile } from '../src/types.js';

const SECTION: ThemeFile = { path: 'sections/hero.liquid', kind: 'section', ext: 'liquid' };

/** Rút gọn kết quả về các trường đang cần so sánh trong từng test. */
const brief = (content: string) =>
  extractLiquidRefs(SECTION, content).map((r) => [r.kind, r.to, r.line]);

describe('extractLiquidRefs — render và include', () => {
  it('sinh ref render từ tag có tên snippet trong dấu nháy', () => {
    expect(extractLiquidRefs(SECTION, "{% render 'card-product' %}")).toEqual([
      { from: 'sections/hero.liquid', to: 'card-product', kind: 'render', source: 'liquid', conditional: false, line: 1 },
    ]);
  });

  it('ghi đúng số dòng của tag', () => {
    const content = '<div>\n  <p>a</p>\n  {%- render "price" -%}\n</div>';

    expect(brief(content)).toEqual([['render', 'price', 3]]);
  });

  it('chỉ lấy tên snippet, bỏ qua tham số và mệnh đề for / with', () => {
    const content = [
      "{% render 'icon', name: 'cart', size: 20 %}",
      "{% render 'card' for products as product %}",
      "{% render 'badge' with product.tag as tag %}",
    ].join('\n');

    expect(brief(content)).toEqual([
      ['render', 'icon', 1],
      ['render', 'card', 2],
      ['render', 'badge', 3],
    ]);
  });

  it('bắt được render viết bên trong tag {% liquid %}', () => {
    const content = "{% liquid\n  assign x = 1\n  render 'swatch'\n%}";

    expect(brief(content)).toEqual([['render', 'swatch', 3]]);
  });

  it('bỏ qua render có tên là biến', () => {
    // {% render block %} là cách render app block: không trỏ tới snippet nào.
    expect(brief('{% render block %}')).toEqual([]);
  });

  it('bỏ qua render nằm trong chú thích', () => {
    const content = "{% comment %}\n  Cách dùng: {% render 'card' %}\n{% endcomment %}\n{% render 'real' %}";

    expect(brief(content)).toEqual([['render', 'real', 4]]);
  });

  it('sinh ref include cho tag {% include %}', () => {
    expect(brief("{% include 'legacy-form' %}")).toEqual([['include', 'legacy-form', 1]]);
  });

  it('giữ nguyên các lời gọi lặp lại, mỗi lời gọi một ref', () => {
    const content = "{% render 'icon' %}\n{% render 'icon' %}";

    expect(brief(content)).toEqual([
      ['render', 'icon', 1],
      ['render', 'icon', 2],
    ]);
  });

  it('trả mảng rỗng cho file không phải Liquid', () => {
    const css: ThemeFile = { path: 'assets/base.css', kind: 'asset', ext: 'css' };

    expect(extractLiquidRefs(css, "{% render 'x' %}")).toEqual([]);
  });

  it('vẫn đọc được file có khối if chưa đóng', () => {
    // Parser khoan dung với khối chưa đóng ở cuối file; không vì một lỗi nhỏ
    // như vậy mà mất toàn bộ quan hệ của file.
    expect(brief("{% if x %}{% render 'a' %}")).toEqual([['render', 'a', 1]]);
  });

  it('ném lỗi có tên file khi cú pháp Liquid hỏng hẳn', () => {
    // Tag mở mà không có dấu đóng %} thì parser không đọc tiếp được.
    expect(() => extractLiquidRefs(SECTION, "{% render 'a'")).toThrow('sections/hero.liquid');
  });
});

describe('extractLiquidRefs — section và sections', () => {
  const LAYOUT: ThemeFile = { path: 'layout/theme.liquid', kind: 'layout', ext: 'liquid' };

  const briefLayout = (content: string) =>
    extractLiquidRefs(LAYOUT, content).map((r) => [r.kind, r.to, r.line]);

  it('sinh ref section từ tag {% section %}', () => {
    expect(extractLiquidRefs(LAYOUT, "{% section 'main-password-header' %}")).toEqual([
      { from: 'layout/theme.liquid', to: 'main-password-header', kind: 'section', source: 'liquid', conditional: false, line: 1 },
    ]);
  });

  it('sinh ref section_group từ tag {% sections %}', () => {
    expect(extractLiquidRefs(LAYOUT, "{% sections 'header-group' %}")).toEqual([
      { from: 'layout/theme.liquid', to: 'header-group', kind: 'section_group', source: 'liquid', conditional: false, line: 1 },
    ]);
  });

  it('không nhầm section với sections khi cả hai cùng xuất hiện', () => {
    const content = [
      "{% sections 'header-group' %}",
      '<main>{{ content_for_layout }}</main>',
      "{%- sections 'footer-group' -%}",
      "{% section 'mobile-navigation-bar' %}",
    ].join('\n');

    expect(briefLayout(content)).toEqual([
      ['section_group', 'header-group', 1],
      ['section_group', 'footer-group', 3],
      ['section', 'mobile-navigation-bar', 4],
    ]);
  });

  it('không coi {% schema %} hay biến section.settings là lời gọi section', () => {
    const content = '{{ section.settings.title }}\n{% schema %}{ "name": "Hero" }{% endschema %}';

    expect(briefLayout(content)).toEqual([]);
  });
});
