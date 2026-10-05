import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatThemeNote } from '../src/format.js';
import type { StatusResult } from '../src/status.js';

const themeRoot = path.join(path.sep, 'themes', 'dawn');

const status = (changes: Partial<Pick<StatusResult, 'modified' | 'added' | 'removed'>> = {}): StatusResult => {
  const modified = changes.modified ?? [];
  const added = changes.added ?? [];
  const removed = changes.removed ?? [];

  return {
    themeRoot,
    dbPath: path.join(themeRoot, '.themegraph', 'graph.db'),
    analyzedAt: '2026-10-05T00:00:00.000Z',
    toolVersion: '0.1.0',
    nodes: 1,
    edges: 0,
    stale: modified.length + added.length + removed.length > 0,
    modified,
    added,
    removed,
  };
};

describe('formatThemeNote', () => {
  it('đồ thị còn mới: chỉ một dòng nêu tên và đường dẫn của theme', () => {
    expect(formatThemeNote(status())).toEqual([`Theme: dawn (${themeRoot})`]);
  });

  it('đồ thị cũ: thêm một dòng nêu file sửa, file thêm và file xoá, theo thứ tự đó', () => {
    const lines = formatThemeNote(
      status({ modified: ['snippets/a.liquid'], added: ['snippets/b.liquid'], removed: ['snippets/c.liquid'] }),
    );

    expect(lines).toEqual([
      `Theme: dawn (${themeRoot})`,
      'ĐỒ THỊ ĐÃ CŨ: 3 file đã đổi từ lần phân tích (snippets/a.liquid, snippets/b.liquid, snippets/c.liquid). Kết quả dưới đây chưa tính các thay đổi đó; chạy "themegraph analyze" trong thư mục theme để cập nhật.',
    ]);
  });

  it('chỉ có file bị xoá cũng là đồ thị cũ', () => {
    const lines = formatThemeNote(status({ removed: ['snippets/c.liquid'] }));

    expect(lines[1]).toContain('1 file đã đổi');
    expect(lines[1]).toContain('(snippets/c.liquid)');
  });

  it('nêu tên tối đa năm file và đếm phần còn lại', () => {
    const modified = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `snippets/${name}.liquid`);
    const [, note] = formatThemeNote(status({ modified }));

    expect(note).toContain('7 file đã đổi');
    expect(note).toContain('(snippets/a.liquid, snippets/b.liquid, snippets/c.liquid, snippets/d.liquid, snippets/e.liquid, và 2 file khác)');
    expect(note).not.toContain('snippets/f.liquid');
  });

  it('đúng năm file thì nêu hết, không có "file khác"', () => {
    const modified = ['a', 'b', 'c', 'd', 'e'].map((name) => `snippets/${name}.liquid`);
    const [, note] = formatThemeNote(status({ modified }));

    expect(note).toContain('snippets/e.liquid)');
    expect(note).not.toContain('file khác');
  });
});
