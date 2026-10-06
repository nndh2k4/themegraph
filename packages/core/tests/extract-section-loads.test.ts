import { describe, expect, it } from 'vitest';

import { extractSectionLoads } from '../src/extract-section-loads.js';

/** Viết gọn kết quả thành [tên, dòng]. */
const loads = (content: string, source: 'js' | 'liquid' = 'js') =>
  extractSectionLoads('assets/x.js', content, source).map((ref) => [ref.to, ref.line]);

describe('extractSectionLoads — section_id trong URL', () => {
  it('lấy tên section viết sẵn sau section_id=', () => {
    // Các dòng lấy từ Dawn và Purity.
    expect(loads('return fetch(`${routes.cart_url}?section_id=cart-drawer`)')).toEqual([['cart-drawer', 1]]);
    expect(loads('fetch(`${url}?q=${term}&section_id=predictive-search`, {')).toEqual([['predictive-search', 1]]);
    expect(loads('this.url = urlLocal + href + variant + "section_id=main-cart-edit";')).toEqual([['main-cart-edit', 1]]);
    expect(loads('`/products/${handle}?section_id=bundle-item&variant=${id}`')).toEqual([['bundle-item', 1]]);
    expect(loads('const queryParams = [`section_id=card-product`];')).toEqual([['card-product', 1]]);
  });

  it('bỏ qua tên là biến', () => {
    expect(loads('fetch(`${url}?section_id=${this.sectionId}`)')).toEqual([]);
    expect(loads('params.push(`section_id=${this.sectionId}`);')).toEqual([]);
    expect(loads("url + '?section_id=' + id")).toEqual([]);
  });

  it('bỏ qua tên chỉ là phần đầu của một biểu thức', () => {
    expect(loads('fetch(`?section_id=main-${type}`)')).toEqual([]);
    expect(loads('fetch(`?section_id=main${type}`)')).toEqual([]);
  });

  it('không nhầm một tham số khác có đuôi section_id', () => {
    expect(loads('fetch(`?my_section_id=cart-drawer`)')).toEqual([]);
  });

  it('ghi đúng số dòng, mỗi lần nhắc là một kết quả, theo thứ tự trong file', () => {
    const content = ['// đầu file', 'fetch(`?section_id=b`)', '', 'fetch(`?section_id=a`)', 'fetch(`?section_id=b`)'].join('\n');

    expect(loads(content)).toEqual([
      ['b', 2],
      ['a', 4],
      ['b', 5],
    ]);
  });

  it('đọc được cả trong file Liquid, và bỏ qua giá trị là biểu thức Liquid', () => {
    const liquid = [
      '<div data-url="{{ routes.product_recommendations_url }}?product_id={{ id }}&limit=4&section_id=main-cart-upsell">',
      '<div data-url="{{ routes.search_url }}?section_id={{ section.id }}">',
    ].join('\n');

    expect(loads(liquid, 'liquid')).toEqual([['main-cart-upsell', 1]]);
  });
});

describe('extractSectionLoads — sections= trong URL', () => {
  it('lấy từng tên trong danh sách cách nhau bằng dấu phẩy', () => {
    expect(loads('fetch(`${routes.cart_url}?sections=cart-drawer,cart-icon-bubble`)')).toEqual([
      ['cart-drawer', 1],
      ['cart-icon-bubble', 1],
    ]);
    expect(loads("fetch('/cart?sections=main')")).toEqual([['main', 1]]);
  });

  it('bỏ qua danh sách ghép lúc chạy', () => {
    expect(loads('`${path}?sections=${Array.from(ids).join(",")}`')).toEqual([]);
    expect(loads('`?sections=${[...sections.keys()].join(",")}`')).toEqual([]);
    expect(loads('`?sections=cart-drawer,${other}`')).toEqual([]);
  });
});

describe('extractSectionLoads — quy ước getSectionsToRender của Dawn', () => {
  it('lấy thuộc tính section: của object trong file JavaScript', () => {
    const content = [
      'getSectionsToRender() {',
      '  return [',
      "    { id: 'cart-icon-bubble', section: 'cart-icon-bubble', selector: '.shopify-section' },",
      '    { id: "main-cart-items", section: document.getElementById("main-cart-items").dataset.id },',
      '    { id: "cart-live-region-text", section: "cart-live-region-text" },',
      '  ];',
      '}',
    ].join('\n');

    // section: lấy ở dòng 3 và 5; id: lấy ở cả ba dòng vì đang trong hàm.
    expect(loads(content)).toEqual([
      ['cart-icon-bubble', 3],
      ['cart-icon-bubble', 3],
      ['main-cart-items', 4],
      ['cart-live-region-text', 5],
      ['cart-live-region-text', 5],
    ]);
  });

  it('lấy id: bên trong getSectionsToRender khi object không có section:', () => {
    // Đúng dạng của assets/cart-notification.js trong Dawn.
    const content = [
      'getSectionsToRender() {',
      '  return [',
      "    { id: 'cart-notification-product', selector: `[id=\"cart-notification-product-${this.cartItemKey}\"]` },",
      "    { id: 'cart-notification-button' },",
      '  ];',
      '}',
    ].join('\n');

    expect(loads(content)).toEqual([
      ['cart-notification-product', 3],
      ['cart-notification-button', 4],
    ]);
  });

  it('không lấy id: nằm ngoài getSectionsToRender', () => {
    const content = [
      "const config = { id: 'not-a-section' };",
      'getSectionsToRender() {',
      "  return [{ id: 'inside' }];",
      '}',
      "const other = { id: 'also-not' };",
    ].join('\n');

    expect(loads(content)).toEqual([['inside', 3]]);
  });

  it('không coi lời GỌI getSectionsToRender() là chỗ định nghĩa', () => {
    // Có "];" phía sau, để nếu lời gọi bị coi là chỗ định nghĩa thì id: bên
    // dưới sẽ rơi vào "thân hàm".
    const content = "sections: this.getSectionsToRender().map((s) => s.id),\nconst x = [{ id: 'outside' }];";

    expect(loads(content)).toEqual([]);
  });

  it('trong file Liquid thì không xét section: và id:', () => {
    const liquid = "{% render 'x', section: 'header', id: 'main' %}\ngetSectionsToRender() { return [{ id: 'a' }]; }";

    expect(loads(liquid, 'liquid')).toEqual([]);
  });
});

describe('extractSectionLoads — dạng của kết quả', () => {
  it('mọi kết quả là ref section_load có điều kiện, giữ file và nguồn', () => {
    expect(extractSectionLoads('assets/cart.js', 'fetch(`?section_id=cart-drawer`)', 'js')).toEqual([
      { from: 'assets/cart.js', to: 'cart-drawer', kind: 'section_load', source: 'js', conditional: true, line: 1 },
    ]);
    expect(extractSectionLoads('sections/a.liquid', '<a href="?section_id=b">', 'liquid')[0]?.source).toBe('liquid');
  });

  it('nội dung không có gì thì trả mảng rỗng', () => {
    expect(loads('')).toEqual([]);
    expect(loads('const sectionId = el.dataset.section;')).toEqual([]);
  });
});
