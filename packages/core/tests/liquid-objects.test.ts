import { describe, expect, it } from 'vitest';

import { extractLiquid, extractLiquidRefs } from '../src/analyze/parsers/liquid.parser.js';
import type { CallContext, FileKind } from '../src/models/index.js';
import { buildGraph, file, ref } from './helpers.js';

/**
 * Lần đọc setting qua tên khác của section, block và bộ setting (xem
 * liquid-objects.ts), và các khoá Shopify tự đọc: date_formats và closest.
 */
const settingReads = (path: string, kind: FileKind, content: string, context?: CallContext) =>
  extractLiquidRefs(file(path, kind), content, context)
    .filter((entry) => entry.kind === 'setting')
    .map((entry) => (entry.scope === undefined ? entry.to : `${entry.to} @ ${entry.scope.join(',')}`));

const sectionReads = (content: string) => settingReads('sections/s.liquid', 'section', content);

describe('đối tượng qua tên khác', () => {
  it('nhận ra block được gán sang tên khác, kể cả qua where và first', () => {
    // Laurel, sections/header.liquid: assign last_block = block.
    expect(sectionReads('{%- for block in section.blocks -%}{%- assign last = block -%}{%- endfor -%}{{ last.settings.columns }}')).toEqual([
      'block.settings.columns',
    ]);
    expect(sectionReads("{%- assign hero = section.blocks | where: 'type', 'hero' | first -%}{{ hero.settings.image }}")).toEqual([
      'block.settings.image',
    ]);
    expect(sectionReads('{{ section.blocks.first.settings.image }}{{ section.blocks[0].settings.title }}')).toEqual([
      'block.settings.image',
      'block.settings.title',
    ]);
  });

  it('nhận ra bộ setting qua tên tắt và qua default', () => {
    expect(sectionReads('{%- assign st = section.settings -%}{{ st.title }}')).toEqual(['section.settings.title']);
    expect(settingReads('snippets/x.liquid', 'snippet', '{%- assign st = st | default: block.settings -%}{{ st.size }}')).toEqual([
      'block.settings.size',
    ]);
  });

  it('không coi thuộc tính khác của block hay danh sách block là setting', () => {
    expect(sectionReads('{{ section.blocks.size }}{{ block.type }}{{ section.id }}')).toEqual([]);
  });

  it('dùng loại đối tượng nơi gọi truyền vào, kèm phạm vi nguồn gốc', () => {
    const context: CallContext = {
      kinds: new Map([
        ['section_st', [{ kind: 'section.settings', origins: ['sections/product.liquid'] }]],
        ['menu_block', [{ kind: 'block', origins: ['sections/header.liquid'] }]],
      ]),
      values: new Map(),
    };
    const content = '{{ section_st.enable_zoom }}{{ menu_block.settings.columns }}{{ section.settings.own }}';

    expect(settingReads('snippets/gallery.liquid', 'snippet', content, context)).toEqual([
      'section.settings.enable_zoom @ sections/product.liquid',
      'block.settings.columns @ sections/header.liquid',
      'section.settings.own',
    ]);
  });
});

describe('khoá Shopify tự đọc', () => {
  it('format: của filter date và time_tag là khoá date_formats', () => {
    const content = "{{ article.published_at | date: format: 'month_day_year' }}{{ c.created_at | time_tag: format: 'date' }}";
    const refs = extractLiquidRefs(file('snippets/x.liquid', 'snippet'), content).filter((entry) => entry.kind === 'translation');

    expect(refs.map((entry) => [entry.to, entry.computed])).toEqual([
      ['date_formats.month_day_year', true],
      ['date_formats.date', true],
    ]);
    // Định dạng strftime viết thẳng không phải khoá.
    expect(extractLiquidRefs(file('snippets/x.liquid', 'snippet'), "{{ d | date: '%B %d' }}")).toEqual([]);
  });

  it('closest.<kiểu> đọc setting kiểu tài nguyên của file bao quanh', () => {
    const block = file('blocks/title.liquid', 'block');
    const card = file('blocks/card.liquid', 'block');
    const cardSchema = '{% schema %}{"settings":[{"id":"pick","type":"collection"},{"id":"label","type":"text"}],"blocks":[{"type":"title"}]}{% endschema %}';

    const cardExtraction = extractLiquid(card, cardSchema);
    expect(cardExtraction.resourceSettings).toEqual([{ setting: 'setting:blocks/card.liquid#block.pick', type: 'collection' }]);

    const graph = buildGraph([block, card], [...cardExtraction.refs, ...extractLiquidRefs(block, '{{ closest.collection.title }}{{ closest.product.title }}')], {
      settings: cardExtraction.settings,
      resourceSettings: cardExtraction.resourceSettings,
    });

    // closest.product không có setting nào bao quanh: là sản phẩm của trang, không thành ref.
    expect(graph.refs.filter((entry) => entry.kind === 'setting').map((entry) => [entry.to, entry.target])).toEqual([
      ['closest.collection', 'setting:blocks/card.liquid#block.pick'],
    ]);
  });
});

describe('block.settings trong section dùng theme block', () => {
  const SECTION = 'sections/slideshow.liquid';
  const files = [file(SECTION, 'section'), file('blocks/_slide.liquid', 'block')];
  const settings = ['setting:blocks/_slide.liquid#block.image'];
  const refs = (name: string) => [
    ref(SECTION, 'block', '_slide', { source: 'schema', conditional: true }),
    ref(SECTION, 'setting', `block.settings.${name}`),
  ];

  it('nối tới setting của theme block mà section nhận', () => {
    const graph = buildGraph(files, refs('image'), { settings });
    expect(graph.refs.filter((entry) => entry.kind === 'setting').map((entry) => [entry.status, entry.target])).toEqual([
      ['resolved', 'setting:blocks/_slide.liquid#block.image'],
    ]);
  });

  it('báo hỏng khi không block nào khai setting đó', () => {
    // Laurel, sections/slideshow.liquid đọc first.local_clip mà _slideshow-slide không khai.
    const graph = buildGraph(files, refs('local_clip'), { settings });
    expect(graph.refs.filter((entry) => entry.kind === 'setting').map((entry) => [entry.status, entry.target])).toEqual([
      ['missing', 'setting:blocks/_slide.liquid#block.local_clip'],
    ]);
  });
});
