import { describe, expect, it } from 'vitest';

import { resolveRef } from '../src/resolver.js';
import type { RawRef, RefKind, RefSource } from '../src/types.js';

/** Các file "có trong theme" dùng cho mọi test bên dưới. */
const PATHS = new Set([
  'layout/theme.liquid',
  'layout/password.liquid',
  'sections/hero.liquid',
  'sections/header-group.json',
  'snippets/card.liquid',
  'blocks/_text.liquid',
  'assets/base.css',
  'assets/theme.js.liquid',
  // Cùng tên "header" ở hai thư mục khác nhau: resolver phải chọn theo kind.
  'sections/header.liquid',
  'snippets/header.liquid',
]);

const ref = (kind: RefKind, to: string, source: RefSource = 'liquid'): RawRef => ({
  from: 'sections/hero.liquid',
  to,
  kind,
  source,
  conditional: false,
  line: 1,
});

describe('resolveRef', () => {
  it.each<[RefKind, string, string]>([
    ['render', 'card', 'snippets/card.liquid'],
    ['include', 'card', 'snippets/card.liquid'],
    ['section', 'hero', 'sections/hero.liquid'],
    ['section_group', 'header-group', 'sections/header-group.json'],
    ['block', '_text', 'blocks/_text.liquid'],
    ['asset', 'base.css', 'assets/base.css'],
    ['layout', 'password', 'layout/password.liquid'],
  ])('đổi ref %s "%s" thành %s', (kind, to, expected) => {
    expect(resolveRef(ref(kind, to), PATHS)).toEqual({ status: 'resolved', path: expected });
  });

  it('chọn thư mục theo kind khi cùng một tên có ở nhiều thư mục', () => {
    expect(resolveRef(ref('render', 'header'), PATHS)).toEqual({
      status: 'resolved',
      path: 'snippets/header.liquid',
    });
    expect(resolveRef(ref('section', 'header'), PATHS)).toEqual({
      status: 'resolved',
      path: 'sections/header.liquid',
    });
  });

  it('tìm được asset có đuôi .liquid khi mã gọi nó bằng tên không có .liquid', () => {
    // Shopify cho đặt assets/theme.js.liquid và gọi bằng 'theme.js' | asset_url.
    expect(resolveRef(ref('asset', 'theme.js'), PATHS)).toEqual({
      status: 'resolved',
      path: 'assets/theme.js.liquid',
    });
  });

  it.each<[RefKind, string, string]>([
    ['render', 'khong-co', 'snippets/khong-co.liquid'],
    ['section', 'khong-co', 'sections/khong-co.liquid'],
    ['section_group', 'khong-co', 'sections/khong-co.json'],
    ['asset', 'icon-error', 'assets/icon-error'],
    ['layout', 'khong-co', 'layout/khong-co.liquid'],
  ])('báo missing cho ref %s "%s" không có file', (kind, to, expected) => {
    expect(resolveRef(ref(kind, to), PATHS)).toEqual({ status: 'missing', expected });
  });

  it('coi block không có file là block cục bộ khi ref đến từ JSON', () => {
    // JSON template liệt kê cả block cục bộ (khai trong schema của section),
    // nên không tìm thấy file ở đây không phải là lỗi.
    expect(resolveRef(ref('block', 'heading', 'json'), PATHS)).toEqual({ status: 'local_block' });
  });

  it('báo missing cho block không có file khi ref đến từ Liquid hoặc schema', () => {
    // content_for 'block' và mục chỉ-có-type trong schema luôn trỏ tới theme block.
    const expected = { status: 'missing', expected: 'blocks/_gone.liquid' };

    expect(resolveRef(ref('block', '_gone', 'liquid'), PATHS)).toEqual(expected);
    expect(resolveRef(ref('block', '_gone', 'schema'), PATHS)).toEqual(expected);
  });

  it('báo missing cho section không có file dù ref đến từ JSON', () => {
    // Ngoại lệ "block cục bộ" chỉ dành cho block. Một template JSON trỏ tới
    // section không tồn tại là tham chiếu hỏng thật.
    expect(resolveRef(ref('section', 'da-xoa', 'json'), PATHS)).toEqual({
      status: 'missing',
      expected: 'sections/da-xoa.liquid',
    });
  });

  it('chỉ asset mới được thử thêm đuôi .liquid', () => {
    const paths = new Set(['snippets/odd.liquid.liquid']);

    expect(resolveRef(ref('render', 'odd'), paths)).toEqual({
      status: 'missing',
      expected: 'snippets/odd.liquid',
    });
  });

  it('trả none cho ref no_layout', () => {
    expect(resolveRef(ref('no_layout', ''), PATHS)).toEqual({ status: 'none' });
  });

  it('phân biệt chữ hoa chữ thường như Shopify', () => {
    expect(resolveRef(ref('render', 'Card'), PATHS)).toEqual({
      status: 'missing',
      expected: 'snippets/Card.liquid',
    });
  });
});
