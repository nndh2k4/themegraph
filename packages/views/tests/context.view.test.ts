import type { ContextResult } from '@themegraph/core';
import { describe, expect, it } from 'vitest';

import { ContextView } from '../src/context.view.js';

describe('ContextView — cảnh báo lỗi phân tích', () => {
  const BASE: ContextResult = {
    node: { id: 'sections/x.liquid', kind: 'section' },
    usedBy: [],
    uses: [],
    translations: [],
    settings: [],
    broken: [],
    errors: [],
    pages: [],
    totalPages: 3,
  };

  it('không in cảnh báo khi file đọc được trọn vẹn', () => {
    expect(new ContextView().render(BASE).join('\n')).not.toContain('Cảnh báo');
  });

  it('in mỗi lỗi một dòng ngay sau tiêu đề', () => {
    const lines = new ContextView().render({ ...BASE, errors: ['lỗi một', 'lỗi hai'] });

    expect(lines.slice(0, 3)).toEqual(['sections/x.liquid (section)', '  Cảnh báo: lỗi một', '  Cảnh báo: lỗi hai']);
  });
});

describe('ContextView — nguồn của quan hệ', () => {
  const link = (sources: string, lines: number[]) => ({
    id: 'blocks/text.liquid',
    kind: 'block' as const,
    type: 'RENDERS' as const,
    conditional: true,
    count: 1,
    sources,
    lines,
  });
  const BASE: ContextResult = {
    node: { id: 'sections/x.liquid', kind: 'section' },
    usedBy: [],
    uses: [],
    translations: [],
    settings: [],
    broken: [],
    errors: [],
    pages: [],
    totalPages: 3,
  };
  const render = (result: ContextResult) => new ContextView().render(result).join('\n');

  it('ghi nguồn schema sau số dòng ở cả hai chiều', () => {
    const out = render({ ...BASE, usedBy: [link('schema', [51])], uses: [link('schema', [51])] });

    expect(out).toContain('blocks/text.liquid:51 (schema)');
    expect(out).toContain('dòng 51 (schema)');
  });

  it('ghi đủ các nguồn khi quan hệ gộp từ nhiều nguồn', () => {
    expect(render({ ...BASE, uses: [link('liquid,schema', [153, 160])] })).toContain('dòng 153, 160 (liquid, schema)');
  });

  it('nguồn liquid thì không có ngoặc', () => {
    const out = render({ ...BASE, usedBy: [link('liquid', [5])], uses: [link('liquid', [5])] });

    expect(out).not.toContain('(liquid)');
    expect(out).toContain('dòng 5');
  });
});
