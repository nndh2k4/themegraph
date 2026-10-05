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

describe('extractLiquidRefs — content_for', () => {
  const BLOCK: ThemeFile = { path: 'blocks/_form.liquid', kind: 'block', ext: 'liquid' };

  const briefBlock = (content: string) =>
    extractLiquidRefs(BLOCK, content).map((r) => [r.kind, r.to, r.line]);

  it("sinh ref block từ content_for 'block' có type là chuỗi", () => {
    const content = "{% content_for 'block', type: '_submit-button', id: 'button' %}";

    expect(extractLiquidRefs(BLOCK, content)).toEqual([
      { from: 'blocks/_form.liquid', to: '_submit-button', kind: 'block', source: 'liquid', conditional: false, line: 1 },
    ]);
  });

  it('lấy đúng type dù tham số viết theo thứ tự khác', () => {
    const content = "<div>\n{%- content_for 'block', id: 'text', type: '_custom-text' -%}\n</div>";

    expect(briefBlock(content)).toEqual([['block', '_custom-text', 2]]);
  });

  it("không sinh ref cho content_for 'blocks'", () => {
    // Dạng số nhiều render mọi block con mà merchant đặt trong theme editor.
    // Block nào thì nằm trong JSON template, không biết được từ mã Liquid.
    const content = "{% content_for 'blocks' %}\n{% content_for 'blocks', closest.product: product %}";

    expect(briefBlock(content)).toEqual([]);
  });

  it("chỉ dạng số ít 'block' mới sinh ref, kể cả khi dạng 'blocks' có tham số type", () => {
    // Shopify không định nghĩa type cho dạng số nhiều; nếu ai đó viết vậy thì
    // cũng không được coi là lời gọi tới một block cụ thể.
    expect(briefBlock("{% content_for 'blocks', type: '_text' %}")).toEqual([]);
  });

  it("bỏ qua content_for 'block' có type là biến hoặc thiếu type", () => {
    const content = "{% content_for 'block', type: block_type, id: 'a' %}\n{% content_for 'block', id: 'b' %}";

    expect(briefBlock(content)).toEqual([]);
  });
});

describe('extractLiquidRefs — schema', () => {
  /** Bọc một object thành khối {% schema %} nằm ở dòng 3 của file. */
  const withSchema = (schema: unknown) =>
    `<div></div>\n\n{% schema %}\n${JSON.stringify(schema, null, 2)}\n{% endschema %}`;

  const targets = (schema: unknown) =>
    extractLiquidRefs(SECTION, withSchema(schema)).map((r) => r.to);

  it('sinh ref block cho mục blocks chỉ có type', () => {
    const refs = extractLiquidRefs(SECTION, withSchema({ name: 'Hero', blocks: [{ type: '_heading' }] }));

    // conditional: schema chỉ nói section NHẬN ĐƯỢC block này; có render hay
    // không còn tuỳ merchant đặt gì trong theme editor.
    expect(refs).toEqual([
      { from: 'sections/hero.liquid', to: '_heading', kind: 'block', source: 'schema', conditional: true, line: 3 },
    ]);
  });

  it('bỏ qua @theme và @app', () => {
    expect(targets({ blocks: [{ type: '@theme' }, { type: '@app' }, { type: '_text' }] })).toEqual(['_text']);
  });

  it('không coi block cục bộ (có name) là tham chiếu tới file', () => {
    const schema = {
      blocks: [
        { type: 'heading', name: 'Heading', settings: [] },
        { type: 'buttons', name: 'Buttons' },
      ],
      // Preset dùng lại chính các block cục bộ ở trên: cũng không phải file.
      presets: [{ name: 'Hero', blocks: [{ type: 'heading' }, { type: 'buttons' }] }],
    };

    expect(targets(schema)).toEqual([]);
  });

  it('đọc blocks trong presets ở dạng mảng, kể cả block lồng nhau', () => {
    const schema = {
      blocks: [{ type: '@theme' }],
      presets: [
        {
          name: 'A',
          blocks: [{ type: '_group', blocks: [{ type: '_title', blocks: [{ type: '_badge' }] }] }],
        },
      ],
    };

    expect(targets(schema)).toEqual(['_group', '_title', '_badge']);
  });

  it('đọc blocks trong presets ở dạng object', () => {
    const schema = {
      blocks: [{ type: '@theme' }],
      presets: [
        {
          name: 'A',
          blocks: { one: { type: '_image', blocks: { two: { type: '_caption' } } } },
          block_order: ['one'],
        },
      ],
    };

    expect(targets(schema)).toEqual(['_image', '_caption']);
  });

  it('đọc blocks trong default', () => {
    expect(targets({ default: { blocks: [{ type: '_link' }] } })).toEqual(['_link']);
  });

  it('mỗi block chỉ sinh một ref dù được nhắc nhiều lần trong schema', () => {
    const schema = {
      blocks: [{ type: '_text' }],
      presets: [
        { name: 'A', blocks: [{ type: '_text' }, { type: '_text' }] },
        { name: 'B', blocks: [{ type: '_text' }] },
      ],
    };

    expect(targets(schema)).toEqual(['_text']);
  });

  it('vẫn trích render trong cùng file có schema', () => {
    const content = `{% render 'icon' %}\n${withSchema({ blocks: [{ type: '_text' }] })}`;

    expect(extractLiquidRefs(SECTION, content).map((r) => [r.kind, r.source, r.to])).toEqual([
      ['render', 'liquid', 'icon'],
      ['block', 'schema', '_text'],
    ]);
  });

  it('ném lỗi có tên file khi JSON trong schema hỏng', () => {
    expect(() => extractLiquidRefs(SECTION, '{% schema %}{ "name": {% endschema %}')).toThrow(
      'sections/hero.liquid',
    );
  });
});

describe('extractLiquidRefs — asset', () => {
  const assets = (content: string) =>
    extractLiquidRefs(SECTION, content)
      .filter((r) => r.kind === 'asset')
      .map((r) => [r.to, r.line]);

  it('sinh ref asset từ chuỗi đi qua filter asset_url', () => {
    expect(extractLiquidRefs(SECTION, "{{ 'base.css' | asset_url | stylesheet_tag }}")).toEqual([
      { from: 'sections/hero.liquid', to: 'base.css', kind: 'asset', source: 'liquid', conditional: false, line: 1 },
    ]);
  });

  it('nhận cả inline_asset_content và asset_img_url', () => {
    const content = "{{ 'icon-cart.svg' | inline_asset_content }}\n{{ 'logo.png' | asset_img_url: '100x' }}";

    expect(assets(content)).toEqual([
      ['icon-cart.svg', 1],
      ['logo.png', 2],
    ]);
  });

  it('bắt được asset_url nằm trong assign và trong tag liquid', () => {
    const content = "{% assign url = 'app.js' | asset_url %}\n{% liquid\n  echo 'theme.css' | asset_url\n%}";

    expect(assets(content)).toEqual([
      ['app.js', 1],
      ['theme.css', 3],
    ]);
  });

  it('bỏ qua shopify_asset_url vì file đó nằm trên máy chủ Shopify, không trong theme', () => {
    expect(assets("{{ 'option_selection.js' | shopify_asset_url }}")).toEqual([]);
  });

  it('bỏ qua khi tên file là biến', () => {
    expect(assets('{{ icon_file | asset_url }}')).toEqual([]);
  });

  it('bỏ qua khi chuỗi bị biến đổi trước khi tới asset_url', () => {
    // Tên file thật là kết quả của append, không phải chuỗi viết trong mã.
    expect(assets("{{ 'icon-' | append: name | asset_url }}")).toEqual([]);
  });

  it('không coi chuỗi không qua filter asset là tham chiếu', () => {
    expect(assets("{{ 'base.css' | upcase }}\n{{ 'general.title' | t }}")).toEqual([]);
  });
});
