import { describe, expect, it } from 'vitest';

import { extractFile } from '../src/extract.js';
import { collectTranslationKeys, isDefaultLocale } from '../src/extract-locale.js';
import type { ThemeFile } from '../src/types.js';

const DEFAULT: ThemeFile = { path: 'locales/en.default.json', kind: 'locale', ext: 'json' };

const keysOf = (data: unknown) => collectTranslationKeys(DEFAULT, JSON.stringify(data));

describe('isDefaultLocale', () => {
  it('chỉ nhận file locale có tên kết thúc bằng .default.json', () => {
    expect(isDefaultLocale(DEFAULT)).toBe(true);
    expect(isDefaultLocale({ path: 'locales/vi.default.json', kind: 'locale', ext: 'json' })).toBe(true);
    expect(isDefaultLocale({ path: 'locales/fr.json', kind: 'locale', ext: 'json' })).toBe(false);
  });

  it('không nhận file chữ của theme editor dù tên có .default', () => {
    const schemaLocale: ThemeFile = { path: 'locales/en.default.schema.json', kind: 'locale_schema', ext: 'json' };

    expect(isDefaultLocale(schemaLocale)).toBe(false);
  });

  it('không nhận file ngoài locales/ dù tên giống', () => {
    expect(isDefaultLocale({ path: 'templates/en.default.json', kind: 'template', ext: 'json' })).toBe(false);
  });
});

describe('collectTranslationKeys', () => {
  it('nối đường đi từ gốc tới câu dịch bằng dấu chấm', () => {
    expect(keysOf({ general: { cart: { title: 'Cart', empty: 'Empty' } }, footer: 'Footer' })).toEqual([
      'general.cart.title',
      'general.cart.empty',
      'footer',
    ]);
  });

  it('coi nhóm số nhiều là một khoá duy nhất', () => {
    const data = { cart: { items: { one: '{{ count }} item', other: '{{ count }} items' } } };

    expect(keysOf(data)).toEqual(['cart.items']);
  });

  it('nhận đủ sáu dạng số nhiều', () => {
    const data = { n: { zero: '0', one: '1', two: '2', few: 'f', many: 'm', other: 'o' } };

    expect(keysOf(data)).toEqual(['n']);
  });

  it('không coi object có khoá lạ là nhóm số nhiều', () => {
    // "one" và "other" đi cùng "title": đây là ba câu dịch riêng.
    const data = { step: { one: 'Step one', other: 'Other', title: 'Steps' } };

    expect(keysOf(data)).toEqual(['step.one', 'step.other', 'step.title']);
  });

  it('không coi object có giá trị lồng là nhóm số nhiều', () => {
    const data = { other: { one: { label: 'x' } } };

    expect(keysOf(data)).toEqual(['other.one.label']);
  });

  it('bỏ qua giá trị không phải chuỗi hay object', () => {
    expect(keysOf({ a: 1, b: null, c: ['x'], d: true, e: 'ok', f: {} })).toEqual(['e']);
  });

  it('trả mảng rỗng khi file không phải một object', () => {
    expect(keysOf([])).toEqual([]);
    expect(keysOf('chuoi')).toEqual([]);
  });

  it('đọc được file có khối chú thích ở đầu', () => {
    const content = '/*\n * auto-generated\n */\n{ "a": { "b": "x" } }';

    expect(collectTranslationKeys(DEFAULT, content)).toEqual(['a.b']);
  });

  it('ném lỗi có tên file khi JSON hỏng', () => {
    expect(() => collectTranslationKeys(DEFAULT, '{ "a": ')).toThrow('locales/en.default.json');
  });
});

describe('extractFile với file locale', () => {
  it('trả khoá dịch của locale mặc định, không có ref nào', () => {
    const result = extractFile(DEFAULT, JSON.stringify({ a: { b: 'x' } }));

    expect(result).toEqual({ refs: [], schema: null, translationKeys: ['a.b'], settings: [], elements: [] });
  });

  it('không đọc khoá của các file locale khác', () => {
    const french: ThemeFile = { path: 'locales/fr.json', kind: 'locale', ext: 'json' };

    expect(extractFile(french, JSON.stringify({ a: { b: 'x' } })).translationKeys).toEqual([]);
  });
});

describe('file dịch có chú thích nằm giữa JSON', () => {
  // Theme Horizon của Shopify viết ghi chú cho người dịch ngay giữa file dịch mặc định.
  const HORIZON_STYLE = [
    '/*',
    ' * IMPORTANT: The contents of this file are auto-generated.',
    ' */',
    '{',
    '  "accessibility": {',
    '    "menu": "Menu",',
    '    // This is the label for the header navigation menu.',
    '    "header_navigation_label": "Main navigation",',
    '    "docs": "https://shopify.dev/docs" // địa chỉ có // bên trong chuỗi',
    '  }',
    '}',
  ].join('\r\n');

  it('vẫn thu được đủ khoá dịch', () => {
    const keys = collectTranslationKeys(DEFAULT, HORIZON_STYLE);

    // Theo thứ tự trong file.
    expect(keys).toEqual(['accessibility.menu', 'accessibility.header_navigation_label', 'accessibility.docs']);
  });

  it('file sai cú pháp thật thì thông báo lỗi ghi đúng số dòng của file gốc', () => {
    const broken = HORIZON_STYLE.replace('"menu": "Menu",', '"menu" "Menu",');

    // Dòng 6 của file, kể cả ba dòng chú thích ở đầu.
    expect(() => collectTranslationKeys(DEFAULT, broken)).toThrow(/locales\/en\.default\.json.*line 6/s);
  });
});
