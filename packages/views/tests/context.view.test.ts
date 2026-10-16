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
