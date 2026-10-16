import type { DeadCodeResult } from '@themegraph/core';
import { describe, expect, it } from 'vitest';

import { DeadCodeView } from '../src/dead-code.view.js';

describe('DeadCodeView — nhóm dùng mà không nạp', () => {
  const view = new DeadCodeView();

  const EMPTY: DeadCodeResult = {
    files: [],
    certain: 0,
    review: 0,
    notLoaded: [],
    fileErrors: [],
    acceptsThemeBlocks: false,
    unusedTranslationKeys: [],
    unusedSettings: [],
  };

  it('không in gì về nhóm này khi nó rỗng', () => {
    expect(view.render(EMPTY)).toEqual(['Không tìm thấy file nào không được dùng.']);
  });

  it('in mỗi thẻ một dòng, kèm lời khuyên không xoá', () => {
    const lines = view.render({
      ...EMPTY,
      notLoaded: [
        {
          id: 'assets/x.js',
          elements: [
            { name: 'a-el', usedBy: ['sections/hero.liquid'] },
            { name: 'z-el', usedBy: ['layout/theme.liquid', 'sections/hero.liquid'] },
          ],
          usedBy: [],
        },
      ],
    });

    expect(lines).toEqual([
      'Không tìm thấy file nào không được dùng.',
      '',
      'Có nơi dùng thẻ nhưng không trang nào nạp file (1), KHÔNG xoá:',
      '  assets/x.js  định nghĩa <a-el>, được viết ở sections/hero.liquid',
      '  assets/x.js  định nghĩa <z-el>, được viết ở layout/theme.liquid, sections/hero.liquid',
      '  File định nghĩa một custom element mà theme đang viết ra, nhưng không thẻ <script> nào nạp nó:',
      '  thẻ hiện trên trang mà JavaScript của nó không chạy. Cách chữa là nạp file, không phải xoá.',
    ]);
  });

  it('đứng sau danh sách file không dùng và trước mục khoá dịch', () => {
    const lines = view.render({
      ...EMPTY,
      files: [{ id: 'snippets/old.liquid', kind: 'snippet', confidence: 'certain', reason: 'unreferenced', usedBy: [] }],
      certain: 1,
      notLoaded: [{ id: 'assets/x.js', elements: [{ name: 'a-el', usedBy: ['sections/hero.liquid'] }], usedBy: [] }],
      unusedTranslationKeys: ['a.b'],
    });
    const at = (text: string) => lines.findIndex((line) => line.includes(text));

    expect(at('Chắc chắn không dùng')).toBeGreaterThan(-1);
    expect(at('Có nơi dùng thẻ')).toBeGreaterThan(at('snippets/old.liquid'));
    expect(at('Khoá dịch')).toBeGreaterThan(at('Có nơi dùng thẻ'));
  });

  it('cắt danh sách theo --limit', () => {
    const lines = view.render(
      {
        ...EMPTY,
        notLoaded: [
          { id: 'assets/x.js', elements: [{ name: 'a-el', usedBy: ['s.liquid'] }, { name: 'b-el', usedBy: ['s.liquid'] }], usedBy: [] },
        ],
      },
      { limit: 1 },
    );

    expect(lines.filter((line) => line.includes('định nghĩa <'))).toHaveLength(1);
    expect(lines.join('\n')).toContain('... và 1 dòng nữa');
  });

  it('in cảnh báo file lỗi ở ĐẦU, trước mọi mục khác', () => {
    const lines = view.render({
      ...EMPTY,
      files: [{ id: 'snippets/old.liquid', kind: 'snippet', confidence: 'review', reason: 'unreferenced', usedBy: [] }],
      review: 1,
      fileErrors: [{ file: 'sections/header.liquid', message: 'Không đọc được JSON trong {% schema %}: x' }],
    });

    expect(lines.slice(0, 3)).toEqual([
      'Cảnh báo: 1 file không phân tích được trọn vẹn; kết quả có thể thiếu quan hệ của chúng:',
      '  sections/header.liquid  Không đọc được JSON trong {% schema %}: x',
      '',
    ]);
    expect(lines[3]).toContain('Không trang nào dùng tới');
  });
});
