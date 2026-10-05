import { describe, expect, it } from 'vitest';

import { extractLiquid, extractLiquidRefs } from '../src/extract-liquid.js';
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
    // Biến section.settings.title là một lần ĐỌC SETTING (kind setting), xem
    // nhóm test "đọc setting" ở cuối file; ở đây chỉ xét ref loại section.
    const content = '{{ section.settings.title }}\n{% schema %}{ "name": "Hero" }{% endschema %}';

    expect(extractLiquidRefs(SECTION, content).filter((r) => r.kind === 'section')).toEqual([]);
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

describe('extractLiquidRefs — conditional', () => {
  /** Trả về cặp [tên, conditional] của mọi ref, theo thứ tự xuất hiện. */
  const flags = (content: string, file: ThemeFile = SECTION) =>
    extractLiquidRefs(file, content).map((r) => [r.to, r.conditional]);

  it('đánh dấu ref nằm trong if, không đánh dấu ref nằm ngoài', () => {
    const content = "{% render 'before' %}\n{% if x %}{% render 'inside' %}{% endif %}\n{% render 'after' %}";

    expect(flags(content)).toEqual([
      ['before', false],
      ['inside', true],
      ['after', false],
    ]);
  });

  it.each([
    ['elsif', "{% if a %}1{% elsif b %}{% render 'x' %}{% endif %}"],
    ['else', "{% if a %}1{% else %}{% render 'x' %}{% endif %}"],
    ['unless', "{% unless a %}{% render 'x' %}{% endunless %}"],
    ['case / when', "{% case a %}{% when 1 %}{% render 'x' %}{% endcase %}"],
    ['for', "{% for i in list %}{% render 'x' %}{% endfor %}"],
    ['for / else', "{% for i in list %}1{% else %}{% render 'x' %}{% endfor %}"],
    ['tablerow', "{% tablerow i in list %}{% render 'x' %}{% endtablerow %}"],
  ])('coi %s là ngữ cảnh có điều kiện', (_name, content) => {
    expect(flags(content)).toEqual([['x', true]]);
  });

  it.each([
    ['capture', "{% capture c %}{% render 'x' %}{% endcapture %}"],
    ['form', "{% form 'product', product %}{% render 'x' %}{% endform %}"],
    ['paginate', "{% paginate c.products by 5 %}{% render 'x' %}{% endpaginate %}"],
    ['thẻ HTML', "<div><span>{% render 'x' %}</span></div>"],
  ])('không coi %s là ngữ cảnh có điều kiện', (_name, content) => {
    expect(flags(content)).toEqual([['x', false]]);
  });

  it('nhận ra điều kiện ở tổ tiên xa, qua nhiều tầng lồng nhau', () => {
    const content = "{% for p in products %}<li>{% capture c %}{% form 'x', p %}{% render 'deep' %}{% endform %}{% endcapture %}</li>{% endfor %}";

    expect(flags(content)).toEqual([['deep', true]]);
  });

  it('xét đúng if viết bên trong tag {% liquid %}', () => {
    const content = "{% liquid\n  render 'top'\n  if x\n    render 'inner'\n  endif\n%}";

    expect(flags(content)).toEqual([
      ['top', false],
      ['inner', true],
    ]);
  });

  it('áp dụng cho mọi loại ref, không riêng render', () => {
    const layout: ThemeFile = { path: 'layout/theme.liquid', kind: 'layout', ext: 'liquid' };
    const content = [
      '{% if request.design_mode %}',
      "  {{ 'editor.js' | asset_url }}",
      "  {% section 'debug-bar' %}",
      "  {% sections 'overlay-group' %}",
      "  {% content_for 'block', type: '_note', id: 'n' %}",
      '{% endif %}',
    ].join('\n');

    expect(flags(content, layout)).toEqual([
      ['editor.js', true],
      ['debug-bar', true],
      ['overlay-group', true],
      ['_note', true],
    ]);
  });
});

describe('extractLiquidRefs — layout', () => {
  const GIFT_CARD: ThemeFile = { path: 'templates/gift_card.liquid', kind: 'template', ext: 'liquid' };

  const brief = (content: string) =>
    extractLiquidRefs(GIFT_CARD, content).map((r) => [r.kind, r.to, r.line]);

  it('sinh ref layout từ tag {% layout %} có tên trong dấu nháy', () => {
    expect(extractLiquidRefs(GIFT_CARD, "{% layout 'alternate' %}")).toEqual([
      { from: 'templates/gift_card.liquid', to: 'alternate', kind: 'layout', source: 'liquid', conditional: false, line: 1 },
    ]);
  });

  it('sinh ref no_layout cho {% layout none %} và {% layout false %}', () => {
    expect(brief(['<!doctype html>', '{% layout none %}'].join('\n'))).toEqual([['no_layout', '', 2]]);
    expect(brief('{% layout false %}')).toEqual([['no_layout', '', 1]]);
  });

  it('bỏ qua {% layout %} có tên là biến', () => {
    expect(brief('{% layout chosen_layout %}')).toEqual([]);
  });
});

describe('extractLiquid — dữ kiện schema', () => {
  const schemaOf = (schema: unknown) =>
    extractLiquid(SECTION, `<div></div>\n{% schema %}${JSON.stringify(schema)}{% endschema %}`).schema;

  it('trả schema null cho file không có khối {% schema %}', () => {
    expect(extractLiquid(SECTION, "{% render 'card' %}").schema).toBeNull();
  });

  it('trả schema null cho file không phải Liquid', () => {
    const css: ThemeFile = { path: 'assets/base.css', kind: 'asset', ext: 'css' };

    expect(extractLiquid(css, '{% schema %}{ "presets": [{}] }{% endschema %}')).toEqual({
      refs: [],
      schema: null,
      translationKeys: [],
      settings: [],
    });
  });

  it('đếm số preset', () => {
    expect(schemaOf({ name: 'Hero' })?.presets).toBe(0);
    expect(schemaOf({ name: 'Hero', presets: [] })?.presets).toBe(0);
    expect(schemaOf({ name: 'Hero', presets: [{ name: 'A' }, { name: 'B' }] })?.presets).toBe(2);
  });

  it('coi presets không phải mảng là không có preset', () => {
    expect(schemaOf({ name: 'Hero', presets: { name: 'A' } })?.presets).toBe(0);
  });

  it('nhận ra schema chấp nhận mọi theme block qua mục @theme', () => {
    expect(schemaOf({ blocks: [{ type: '@theme' }, { type: '@app' }] })?.acceptsThemeBlocks).toBe(true);
    expect(schemaOf({ blocks: [{ type: '@app' }, { type: '_text' }] })?.acceptsThemeBlocks).toBe(false);
    expect(schemaOf({ name: 'Hero' })?.acceptsThemeBlocks).toBe(false);
  });

  it('không coi @theme nằm trong presets là chấp nhận mọi theme block', () => {
    const schema = { blocks: [{ type: '_text' }], presets: [{ name: 'A', blocks: [{ type: '@theme' }] }] };

    expect(schemaOf(schema)?.acceptsThemeBlocks).toBe(false);
  });

  it('trả dữ kiện rỗng khi thân schema là JSON nhưng không phải object', () => {
    expect(extractLiquid(SECTION, '{% schema %}[]{% endschema %}')).toEqual({
      refs: [],
      schema: { presets: 0, acceptsThemeBlocks: false },
      translationKeys: [],
      settings: [],
    });
  });

  it('trả cùng danh sách ref với extractLiquidRefs', () => {
    const content = "{% render 'card' %}\n{% schema %}{ \"blocks\": [{ \"type\": \"_text\" }] }{% endschema %}";

    expect(extractLiquid(SECTION, content).refs).toEqual(extractLiquidRefs(SECTION, content));
    expect(extractLiquid(SECTION, content).refs).toHaveLength(2);
  });
});

describe('extractLiquidRefs — khoá dịch', () => {
  it('sinh ref translation từ chuỗi đi qua filter t', () => {
    expect(extractLiquidRefs(SECTION, "<h2>{{ 'general.cart.title' | t }}</h2>")).toEqual([
      {
        from: 'sections/hero.liquid',
        to: 'general.cart.title',
        kind: 'translation',
        source: 'liquid',
        conditional: false,
        line: 1,
      },
    ]);
  });

  it('nhận cả tên đầy đủ translate và filter có tham số', () => {
    const content = "{{ 'a.one' | translate }}\n{{ 'a.items' | t: count: cart.item_count }}";

    expect(brief(content)).toEqual([
      ['translation', 'a.one', 1],
      ['translation', 'a.items', 2],
    ]);
  });

  it('bắt được khoá dịch trong assign, trong {% liquid %} và khi còn filter phía sau', () => {
    const content = [
      "{% assign label = 'a.label' | t %}",
      '{% liquid',
      "  assign other = 'a.other' | t",
      '%}',
      "{{ 'a.html' | t | escape }}",
    ].join('\n');

    expect(brief(content)).toEqual([
      ['translation', 'a.label', 1],
      ['translation', 'a.other', 3],
      ['translation', 'a.html', 5],
    ]);
  });

  it('bỏ qua khi khoá là biến hoặc là kết quả của filter khác', () => {
    const content = "{{ key | t }}\n{{ 'products.' | append: handle | t }}";

    expect(brief(content)).toEqual([]);
  });

  it('không nhầm filter có tên bắt đầu bằng t', () => {
    expect(brief("{{ 'a.b' | truncate: 5 }}{{ 'x' | times: 2 }}")).toEqual([]);
  });

  it('đánh dấu conditional khi nằm trong if', () => {
    const refs = extractLiquidRefs(SECTION, "{% if cart.empty? %}{{ 'cart.empty' | t }}{% endif %}");

    expect(refs.map((r) => [r.to, r.conditional])).toEqual([['cart.empty', true]]);
  });

  it('vẫn trích asset như trước', () => {
    expect(brief("{{ 'base.css' | asset_url }}{{ 'a.b' | t }}")).toEqual([
      ['asset', 'base.css', 1],
      ['translation', 'a.b', 1],
    ]);
  });
});

describe('extractLiquid — setting khai trong schema', () => {
  const BLOCK: ThemeFile = { path: 'blocks/text.liquid', kind: 'block', ext: 'liquid' };
  const withSchema = (schema: unknown) => `{% schema %}${JSON.stringify(schema)}{% endschema %}`;

  it('ghi setting của section dưới dạng đọc bằng section.settings', () => {
    const schema = { name: 'Hero', settings: [{ type: 'text', id: 'title' }, { type: 'header', content: 'x' }] };

    expect(extractLiquid(SECTION, withSchema(schema)).settings).toEqual(['setting:sections/hero.liquid#section.title']);
  });

  it('ghi setting của theme block dưới dạng đọc bằng block.settings', () => {
    const schema = { name: 'Text', settings: [{ type: 'text', id: 'text' }] };

    expect(extractLiquid(BLOCK, withSchema(schema)).settings).toEqual(['setting:blocks/text.liquid#block.text']);
  });

  it('gộp setting của các block cục bộ, bỏ id trùng giữa các loại block', () => {
    const schema = {
      name: 'Footer',
      settings: [{ type: 'checkbox', id: 'show_social' }],
      blocks: [
        { type: 'link_list', name: 'Menu', settings: [{ type: 'text', id: 'heading' }, { type: 'link_list', id: 'menu' }] },
        { type: 'text', name: 'Text', settings: [{ type: 'text', id: 'heading' }, { type: 'richtext', id: 'subtext' }] },
        { type: '@app' },
      ],
    };

    expect(extractLiquid(SECTION, withSchema(schema)).settings).toEqual([
      'setting:sections/hero.liquid#section.show_social',
      'setting:sections/hero.liquid#block.heading',
      'setting:sections/hero.liquid#block.menu',
      'setting:sections/hero.liquid#block.subtext',
    ]);
  });

  it('trả mảng rỗng khi file không có schema hoặc schema không có setting', () => {
    expect(extractLiquid(SECTION, '<div></div>').settings).toEqual([]);
    expect(extractLiquid(SECTION, withSchema({ name: 'Hero' })).settings).toEqual([]);
  });
});

describe('extractLiquidRefs — đọc setting', () => {
  const settingRefs = (content: string, file: ThemeFile = SECTION) =>
    extractLiquidRefs(file, content)
      .filter((r) => r.kind === 'setting')
      .map((r) => [r.to, r.line, r.conditional]);

  it('sinh ref setting cho ba cách đọc', () => {
    const content = '{{ settings.cart_type }}\n{{ section.settings.title }}\n{{ block.settings.text | escape }}';

    expect(extractLiquidRefs(SECTION, content)).toEqual([
      { from: 'sections/hero.liquid', to: 'settings.cart_type', kind: 'setting', source: 'liquid', conditional: false, line: 1 },
      { from: 'sections/hero.liquid', to: 'section.settings.title', kind: 'setting', source: 'liquid', conditional: false, line: 2 },
      { from: 'sections/hero.liquid', to: 'block.settings.text', kind: 'setting', source: 'liquid', conditional: false, line: 3 },
    ]);
  });

  it('chỉ lấy tên setting, bỏ phần truy cập sâu hơn', () => {
    const content = '{{ section.settings.image.alt }}{{ settings.colors.accent }}';

    expect(settingRefs(content).map((r) => r[0])).toEqual(['section.settings.image', 'settings.colors']);
  });

  it('bắt được lần đọc trong điều kiện, trong tham số của render và trong {% style %}', () => {
    const content = [
      '{% if section.settings.show %}x{% endif %}',
      "{% render 'card', size: block.settings.size %}",
      '{% style %}.a { width: {{ settings.page_width }}px; }{% endstyle %}',
    ].join('\n');

    expect(settingRefs(content).map((r) => [r[0], r[1]])).toEqual([
      ['section.settings.show', 1],
      ['block.settings.size', 2],
      ['settings.page_width', 3],
    ]);
  });

  it('nhận tên setting viết trong ngoặc vuông với chuỗi cố định', () => {
    expect(settingRefs("{{ section.settings['title'] }}").map((r) => r[0])).toEqual(['section.settings.title']);
  });

  it('bỏ qua khi tên setting là biến, và khi chỉ nhắc tới cả đối tượng settings', () => {
    const content = '{{ section.settings[name] }}{{ settings[key] }}{{ section.settings }}{{ settings }}';

    expect(settingRefs(content)).toEqual([]);
  });

  it('không nhầm thuộc tính khác của section và block', () => {
    expect(settingRefs('{{ section.id }}{{ block.shopify_attributes }}{{ section.blocks.size }}')).toEqual([]);
  });

  it('không nhầm biến khác có thuộc tính settings', () => {
    expect(settingRefs('{{ product.settings.title }}{{ item.settings.title }}')).toEqual([]);
  });

  it('coi biến lặp trên section.blocks là block', () => {
    const content = '{% for item in section.blocks %}{{ item.settings.heading }}{% endfor %}';

    expect(settingRefs(content)).toEqual([['block.settings.heading', 1, true]]);
  });

  it('không coi biến lặp trên danh sách khác là block', () => {
    const content = '{% for item in collection.products %}{{ item.settings.heading }}{% endfor %}';

    expect(settingRefs(content)).toEqual([]);
  });

  it('điều kiện của chính tag if không bị tính là có điều kiện, phần thân thì có', () => {
    const content = '{% if section.settings.show %}{{ section.settings.title }}{% endif %}';

    expect(settingRefs(content)).toEqual([
      ['section.settings.show', 1, false],
      ['section.settings.title', 1, true],
    ]);
  });

  it('điều kiện của if lồng trong một if khác vẫn là có điều kiện', () => {
    const content = '{% if a %}{% if section.settings.show %}x{% endif %}{% endif %}';

    expect(settingRefs(content)).toEqual([['section.settings.show', 1, true]]);
  });
});

describe('extractLiquidRefs — tên tắt của settings', () => {
  const names = (content: string) =>
    extractLiquidRefs(SECTION, content)
      .filter((r) => r.kind === 'setting')
      .map((r) => r.to);

  it('hiểu tên tắt gán từ section.settings, block.settings và settings', () => {
    const content = [
      '{% liquid',
      '  assign section_st = section.settings',
      '  assign block_st = block.settings',
      '  assign theme_st = settings',
      '%}',
      '{{ section_st.title }}{{ block_st.text }}{{ theme_st.page_width }}',
    ].join('\n');

    expect(names(content)).toEqual(['section.settings.title', 'block.settings.text', 'settings.page_width']);
  });

  it('ghi đúng dòng của lần đọc, không phải dòng gán tên tắt', () => {
    const refs = extractLiquidRefs(SECTION, '{% assign st = section.settings %}\n\n{{ st.title }}');

    expect(refs.map((r) => [r.to, r.line])).toEqual([['section.settings.title', 3]]);
  });

  it('tên tắt có hiệu lực cả khi lệnh gán nằm phía sau trong file', () => {
    expect(names('{{ st.title }}{% assign st = section.settings %}')).toEqual(['section.settings.title']);
  });

  it('hiểu tên tắt gán từ biến lặp trên section.blocks', () => {
    const content = '{% for item in section.blocks %}{% assign bs = item.settings %}{{ bs.heading }}{% endfor %}';

    expect(names(content)).toEqual(['block.settings.heading']);
  });

  it('không coi là tên tắt khi phép gán có filter hoặc trỏ sâu hơn settings', () => {
    const content = [
      '{% assign a = section.settings | json %}',
      '{% assign b = section.settings.title %}',
      '{% assign c = section %}',
      "{% assign d = 'settings' %}",
      '{{ a.x }}{{ b.y }}{{ c.z }}{{ d.w }}',
    ].join('\n');

    // Chỉ còn lần đọc thật ở dòng 2.
    expect(names(content)).toEqual(['section.settings.title']);
  });

  it('không coi phép gán từ một setting toàn cục cụ thể là tên tắt của settings', () => {
    // c là giá trị của MỘT setting; c.accent không phải settings.accent.
    expect(names('{% assign c = settings.colors %}{{ c.accent }}')).toEqual(['settings.colors']);
  });

  it('không coi biến thường là tên tắt', () => {
    expect(names('{% assign st = product %}{{ st.title }}')).toEqual([]);
  });
});

describe('extractLiquidRefs — render truyền tham số settings', () => {
  const renders = (content: string) =>
    extractLiquidRefs(SECTION, content)
      .filter((r) => r.kind === 'render')
      .map((r) => [r.to, r.passesSettings]);

  it('đánh dấu lời gọi render có tham số tên settings', () => {
    const content = "{% render 'size-style', settings: block.settings, is_group: true %}\n{% render 'card', size: 2 %}";

    expect(renders(content)).toEqual([
      ['size-style', true],
      ['card', undefined],
    ]);
  });

  it('không thêm trường passesSettings vào ref thường', () => {
    const [ref] = extractLiquidRefs(SECTION, "{% render 'card' %}");

    expect(ref).not.toHaveProperty('passesSettings');
  });
});
