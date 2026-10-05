import { describe, expect, it } from 'vitest';

import { extractJsonRefs } from '../src/extract-json.js';
import type { ThemeFile } from '../src/types.js';

const TEMPLATE: ThemeFile = { path: 'templates/product.json', kind: 'template', ext: 'json' };
const GROUP: ThemeFile = { path: 'sections/header-group.json', kind: 'section_group', ext: 'json' };

describe('extractJsonRefs', () => {
  it('sinh một ref section cho mỗi mục trong sections của template', () => {
    const content = JSON.stringify({
      sections: {
        main: { type: 'main-product', settings: {} },
        related: { type: 'related-products' },
      },
      order: ['main', 'related'],
    });

    expect(extractJsonRefs(TEMPLATE, content)).toEqual([
      { from: 'templates/product.json', to: 'main-product', kind: 'section', source: 'json', conditional: false, line: 0 },
      { from: 'templates/product.json', to: 'related-products', kind: 'section', source: 'json', conditional: false, line: 0 },
    ]);
  });

  it('đọc được file có khối chú thích /* */ ở đầu', () => {
    const content = `/*
 * IMPORTANT: The contents of this file are auto-generated.
 */
{ "sections": { "main": { "type": "main-product" } }, "order": ["main"] }`;

    expect(extractJsonRefs(TEMPLATE, content).map((r) => r.to)).toEqual(['main-product']);
  });

  it('đi đệ quy vào block lồng nhiều tầng', () => {
    const content = JSON.stringify({
      sections: {
        main: {
          type: 'main-product',
          blocks: {
            a: {
              type: '_group',
              blocks: {
                b: { type: '_title-product', blocks: { c: { type: '_badge' } } },
              },
            },
          },
        },
      },
    });

    const blocks = extractJsonRefs(TEMPLATE, content).filter((r) => r.kind === 'block');

    expect(blocks.map((r) => r.to)).toEqual(['_group', '_title-product', '_badge']);
  });

  it('đánh dấu conditional cho mục bị disabled và mọi block bên trong nó', () => {
    const content = JSON.stringify({
      sections: {
        on: { type: 'hero', blocks: { x: { type: '_text' } } },
        off: { type: 'promo', disabled: true, blocks: { y: { type: '_button' } } },
      },
    });

    const byTo = Object.fromEntries(
      extractJsonRefs(TEMPLATE, content).map((r) => [r.to, r.conditional]),
    );

    expect(byTo).toEqual({ hero: false, _text: false, promo: true, _button: true });
  });

  it('bỏ qua block của app (type dạng shopify://)', () => {
    const content = JSON.stringify({
      sections: {
        main: {
          type: 'main-product',
          blocks: {
            app: { type: 'shopify://apps/reviews/blocks/stars/123' },
            own: { type: '_price-product' },
          },
        },
      },
    });

    expect(extractJsonRefs(TEMPLATE, content).map((r) => r.to)).toEqual([
      'main-product',
      '_price-product',
    ]);
  });

  it('sinh ref layout khi template chỉ định layout bằng chuỗi', () => {
    const withLayout = JSON.stringify({ layout: 'password', sections: {} });
    const noLayout = JSON.stringify({ layout: false, sections: {} });

    expect(extractJsonRefs(TEMPLATE, withLayout)).toEqual([
      { from: 'templates/product.json', to: 'password', kind: 'layout', source: 'json', conditional: false, line: 0 },
    ]);
    expect(extractJsonRefs(TEMPLATE, noLayout)).toEqual([]);
  });

  it('đọc section group giống như template', () => {
    const content = JSON.stringify({
      name: 'Header group',
      type: 'header',
      sections: { bar: { type: 'announcement-bar' }, header: { type: 'header' } },
      order: ['bar', 'header'],
    });

    const refs = extractJsonRefs(GROUP, content);

    expect(refs.map((r) => [r.from, r.kind, r.to])).toEqual([
      ['sections/header-group.json', 'section', 'announcement-bar'],
      ['sections/header-group.json', 'section', 'header'],
    ]);
  });

  it('trả mảng rỗng cho file JSON không phải template hay section group', () => {
    const config: ThemeFile = { path: 'config/settings_data.json', kind: 'config', ext: 'json' };
    const content = JSON.stringify({ sections: { x: { type: 'hero' } } });

    expect(extractJsonRefs(config, content)).toEqual([]);
  });

  it('ném lỗi có tên file khi JSON hỏng', () => {
    expect(() => extractJsonRefs(TEMPLATE, '{ "sections": ')).toThrow('templates/product.json');
  });
});
