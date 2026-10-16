import { describe, expect, it } from 'vitest';

import { lineIndex } from '../src/analyze/parsers/line-index.js';

describe('lineIndex', () => {
  it('trả số dòng đếm từ 1, đúng ở đầu, giữa và cuối dòng', () => {
    const at = lineIndex('ab\ncd\r\n\nx');
    expect([0, 2, 3, 5, 7, 8, 9].map(at)).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });

  it('nội dung rỗng luôn là dòng 1', () => {
    expect(lineIndex('')(0)).toBe(1);
  });
});
