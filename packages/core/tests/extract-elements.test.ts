import { describe, expect, it } from 'vitest';

import { extractElements } from '../src/extract-elements.js';

/** Viết gọn kết quả thành "vai trò tên@dòng". */
const found = (content: string) => extractElements(content).map((e) => `${e.role} ${e.name}@${e.line}`);

describe('extractElements — định nghĩa thẻ', () => {
  it('đọc customElements.define với ba kiểu nháy', () => {
    expect(found(`customElements.define("cart-drawer", CartDrawer);`)).toEqual(['define cart-drawer@1']);
    expect(found(`customElements.define('cart-drawer', CartDrawer);`)).toEqual(['define cart-drawer@1']);
    expect(found('customElements.define(`cart-drawer`, CartDrawer);')).toEqual(['define cart-drawer@1']);
  });

  it('nhận cả window.customElements, xuống dòng và khoảng trắng trong lời gọi', () => {
    expect(found(`window.customElements.define(\n  "quick-add",\n  QuickAdd\n);`)).toEqual(['define quick-add@1']);
    expect(found(`customElements . define( 'a-b', X)`)).toEqual(['define a-b@1']);
  });

  it('ghi số dòng của lời gọi', () => {
    const js = `class A extends HTMLElement {}\n\nif (!customElements.get("my-el")) {\n  customElements.define("my-el", A);\n}`;

    expect(found(js)).toEqual(['define my-el@4']);
  });

  it('bỏ qua tên là biến, và tên không hợp lệ cho một custom element', () => {
    expect(found(`customElements.define(name, Klass);`)).toEqual([]);
    expect(found('customElements.define(`x-${kind}`, Klass);')).toEqual([]);
    // Tên custom element bắt buộc có gạch ngang và bắt đầu bằng chữ thường.
    expect(found(`customElements.define("button", B);`)).toEqual([]);
    expect(found(`customElements.define("My-El", B);`)).toEqual([]);
  });

  it('bỏ qua lời gọi nằm sau // trên cùng dòng, nhưng không nhầm với // trong URL ở dòng khác', () => {
    expect(found(`// customElements.define("old-el", Old);`)).toEqual([]);
    expect(found(`  //customElements.define("old-el", Old);`)).toEqual([]);
    expect(found(`const u = "https://x.y";\ncustomElements.define("new-el", N);`)).toEqual(['define new-el@2']);
  });

  it('đọc định nghĩa nằm trong thẻ <script> của một file Liquid', () => {
    const liquid = `<div></div>\n<script>\n  customElements.define('inline-el', class extends HTMLElement {});\n</script>`;

    expect(found(liquid)).toEqual(['define inline-el@3']);
  });
});

describe('extractElements — dùng thẻ', () => {
  it('đọc thẻ mở có gạch ngang trong HTML, với ba cách kết thúc tên', () => {
    expect(found(`<disclosures-close class="x">`)).toEqual(['use disclosures-close@1']);
    expect(found(`<cart-drawer>`)).toEqual(['use cart-drawer@1']);
    expect(found(`<a-b/>`)).toEqual(['use a-b@1']);
    expect(found(`<product-form\n  data-x>`)).toEqual(['use product-form@1']);
  });

  it('không tính thẻ đóng, thẻ HTML thường, và tên ghép bằng Liquid', () => {
    expect(found(`</cart-drawer>`)).toEqual([]);
    expect(found(`<div class="a-b"><span></span></div>`)).toEqual([]);
    expect(found(`<my-{{ kind }} class="x">`)).toEqual([]);
    expect(found(`<{{ tag }}-el>`)).toEqual([]);
  });

  it('đọc thuộc tính is="tên" của thẻ có sẵn được mở rộng', () => {
    expect(found(`<details is="collapsible-row" open>`)).toEqual(['use collapsible-row@1']);
    expect(found(`<ul is='menu-list'>`)).toEqual(['use menu-list@1']);
    // "this=" không phải thuộc tính is.
    expect(found(`<div this="a-b">`)).toEqual([]);
  });

  it('đọc document.createElement với tên viết sẵn', () => {
    expect(found(`const el = document.createElement("toast-item");`)).toEqual(['use toast-item@1']);
    expect(found(`document.createElement(tagName)`)).toEqual([]);
    expect(found(`document.createElement("div")`)).toEqual([]);
  });

  it('đọc thẻ nằm trong chuỗi HTML của JavaScript', () => {
    expect(found('el.innerHTML = `<loading-spinner></loading-spinner>`;')).toEqual(['use loading-spinner@1']);
  });

  it('bỏ qua thẻ nằm trong chú thích Liquid và chú thích HTML, giữ đúng số dòng phía sau', () => {
    const liquid = [
      '{% comment %}',
      '  <old-el></old-el>',
      '{% endcomment %}',
      '{%- comment -%}<old-two></old-two>{%- endcomment -%}',
      '<!-- <old-three> -->',
      '<live-el>',
    ].join('\n');

    expect(found(liquid)).toEqual(['use live-el@6']);
  });
});

describe('extractElements — gộp và thứ tự', () => {
  it('mỗi cặp (tên, vai trò) chỉ ghi một lần, ở dòng đầu tiên nó xuất hiện', () => {
    const liquid = `<a-b>\n</a-b>\n<a-b>\n<c-d>`;

    expect(found(liquid)).toEqual(['use a-b@1', 'use c-d@4']);
  });

  it('một file vừa định nghĩa vừa dùng cùng một thẻ thì ghi cả hai', () => {
    const liquid = `<x-y></x-y>\n<script>customElements.define("x-y", X)</script>`;

    expect(found(liquid)).toEqual(['use x-y@1', 'define x-y@2']);
  });

  it('nội dung không có gì thì trả mảng rỗng', () => {
    expect(found('')).toEqual([]);
    expect(found('body { color: red; }')).toEqual([]);
  });
});
