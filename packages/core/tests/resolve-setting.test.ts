import { describe, expect, it } from 'vitest';

import { resolveSettingRef } from '../src/resolve-setting.js';
import type { Ancestor } from '../src/resolve-setting.js';
import type { FileKind, RawRef } from '../src/types.js';

const read = (from: string, to: string): RawRef => ({
  from,
  to,
  kind: 'setting',
  source: 'liquid',
  conditional: false,
  line: 1,
});

const KNOWN = new Set([
  'setting:settings.cart_type',
  'setting:sections/hero.liquid#section.title',
  'setting:sections/hero.liquid#block.heading',
  'setting:sections/grid.liquid#section.title',
  'setting:sections/grid.liquid#section.columns',
  'setting:blocks/text.liquid#block.text',
  'setting:blocks/text.liquid#block.heading',
]);

const ANCESTORS: Ancestor[] = [
  { path: 'blocks/text.liquid', kind: 'block' },
  { path: 'sections/grid.liquid', kind: 'section' },
  { path: 'sections/hero.liquid', kind: 'section' },
  { path: 'snippets/wrapper.liquid', kind: 'snippet' },
];

const resolve = (from: string, kind: FileKind | undefined, to: string, ancestors: Ancestor[] = []) =>
  resolveSettingRef(read(from, to), kind, ancestors, KNOWN);

describe('resolveSettingRef — setting toàn cục', () => {
  it('đưa settings.x về setting toàn cục, từ bất kỳ loại file nào', () => {
    const expected = { status: 'resolved', targets: ['setting:settings.cart_type'] };

    expect(resolve('layout/theme.liquid', 'layout', 'settings.cart_type')).toEqual(expected);
    expect(resolve('snippets/card.liquid', 'snippet', 'settings.cart_type')).toEqual(expected);
    expect(resolve('sections/hero.liquid', 'section', 'settings.cart_type')).toEqual(expected);
  });

  it('báo missing khi setting toàn cục không được khai', () => {
    expect(resolve('layout/theme.liquid', 'layout', 'settings.rtl')).toEqual({
      status: 'missing',
      expected: 'setting:settings.rtl',
    });
  });

  it('không lẫn với setting cùng tên của một section', () => {
    // "title" có ở hero và grid nhưng không có ở mức toàn cục.
    expect(resolve('layout/theme.liquid', 'layout', 'settings.title').status).toBe('missing');
  });
});

describe('resolveSettingRef — section.settings', () => {
  it('trong một section: setting của chính section đó', () => {
    expect(resolve('sections/hero.liquid', 'section', 'section.settings.title')).toEqual({
      status: 'resolved',
      targets: ['setting:sections/hero.liquid#section.title'],
    });
  });

  it('trong một section: báo missing khi schema của nó không khai setting đó', () => {
    // grid có khai "columns" nhưng hero thì không: không được mượn của grid.
    expect(resolve('sections/hero.liquid', 'section', 'section.settings.columns', ANCESTORS)).toEqual({
      status: 'missing',
      expected: 'setting:sections/hero.liquid#section.columns',
    });
  });

  it('trong một snippet: setting của mọi section tổ tiên có khai nó', () => {
    expect(resolve('snippets/card.liquid', 'snippet', 'section.settings.title', ANCESTORS)).toEqual({
      status: 'resolved',
      targets: ['setting:sections/grid.liquid#section.title', 'setting:sections/hero.liquid#section.title'],
    });
    expect(resolve('snippets/card.liquid', 'snippet', 'section.settings.columns', ANCESTORS)).toEqual({
      status: 'resolved',
      targets: ['setting:sections/grid.liquid#section.columns'],
    });
  });

  it('trong một snippet: unresolved khi không section tổ tiên nào khai nó', () => {
    expect(resolve('snippets/card.liquid', 'snippet', 'section.settings.gone', ANCESTORS)).toEqual({ status: 'unresolved' });
    expect(resolve('snippets/card.liquid', 'snippet', 'section.settings.title', [])).toEqual({ status: 'unresolved' });
  });

  it('trong một theme block: setting của section tổ tiên, không phải của chính block', () => {
    expect(resolve('blocks/text.liquid', 'block', 'section.settings.title', ANCESTORS)).toEqual({
      status: 'resolved',
      targets: ['setting:sections/grid.liquid#section.title', 'setting:sections/hero.liquid#section.title'],
    });
  });

  it('không lấy setting của block tổ tiên cho section.settings', () => {
    // blocks/text.liquid có "heading" ở dạng block, không phải dạng section.
    expect(resolve('snippets/card.liquid', 'snippet', 'section.settings.heading', ANCESTORS)).toEqual({ status: 'unresolved' });
  });
});

describe('resolveSettingRef — block.settings', () => {
  it('trong một theme block: setting của chính block đó', () => {
    expect(resolve('blocks/text.liquid', 'block', 'block.settings.text')).toEqual({
      status: 'resolved',
      targets: ['setting:blocks/text.liquid#block.text'],
    });
  });

  it('trong một theme block: báo missing khi schema của nó không khai', () => {
    expect(resolve('blocks/text.liquid', 'block', 'block.settings.gone', ANCESTORS)).toEqual({
      status: 'missing',
      expected: 'setting:blocks/text.liquid#block.gone',
    });
  });

  it('trong một section: setting của block cục bộ khai trong section đó', () => {
    expect(resolve('sections/hero.liquid', 'section', 'block.settings.heading')).toEqual({
      status: 'resolved',
      targets: ['setting:sections/hero.liquid#block.heading'],
    });
    expect(resolve('sections/hero.liquid', 'section', 'block.settings.title').status).toBe('missing');
  });

  it('trong một snippet: setting block của mọi section và block tổ tiên có khai nó', () => {
    expect(resolve('snippets/card.liquid', 'snippet', 'block.settings.heading', ANCESTORS)).toEqual({
      status: 'resolved',
      targets: ['setting:blocks/text.liquid#block.heading', 'setting:sections/hero.liquid#block.heading'],
    });
  });

  it('trong một snippet: unresolved khi không tổ tiên nào khai nó', () => {
    expect(resolve('snippets/card.liquid', 'snippet', 'block.settings.gone', ANCESTORS)).toEqual({ status: 'unresolved' });
  });
});

describe('resolveSettingRef — trường hợp biên', () => {
  it('unresolved khi cách viết không thuộc ba dạng đã biết', () => {
    expect(resolve('sections/hero.liquid', 'section', 'product.settings.x')).toEqual({ status: 'unresolved' });
    expect(resolve('sections/hero.liquid', 'section', 'settings')).toEqual({ status: 'unresolved' });
    expect(resolve('sections/hero.liquid', 'section', 'section.settings')).toEqual({ status: 'unresolved' });
  });

  it('coi file không rõ loại như một file được render gián tiếp', () => {
    expect(resolve('la/x.liquid', undefined, 'section.settings.title', ANCESTORS).status).toBe('resolved');
    expect(resolve('la/x.liquid', undefined, 'section.settings.title', []).status).toBe('unresolved');
  });
});
