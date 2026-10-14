import type { OverviewResult } from '@themegraph/core';
import { describe, expect, it } from 'vitest';

import { OverviewView } from '../src/overview.view.js';

/** Một kết quả overview tối thiểu; từng test ghi đè phần nó cần. */
const base = (changes: Partial<OverviewResult> = {}): OverviewResult => ({
  themeRoot: '/themes/dawn',
  meta: { schemaVersion: 6, toolVersion: '0.1.0', analyzedAt: '2026-10-05T00:00:00.000Z' },
  nodes: 1,
  edges: 0,
  nodesByKind: { snippet: 1 },
  edgesByType: {},
  refsByStatus: {},
  pages: [],
  brokenRefs: 0,
  unused: { certain: 0, review: 0, notLoaded: 0, translationKeys: 0, settings: 0 },
  mostUsed: [],
  ...changes,
});

describe('OverviewView', () => {
  const view = new OverviewView();

  it('không có mục file được gọi nhiều khi danh sách rỗng, và ghi 0 trang', () => {
    const lines = view.render(base());

    expect(lines.some((line) => line.includes('File được nhiều nơi gọi nhất'))).toBe(false);
    expect(lines).toContain('Trang            0  ()');
  });

  it('không lẫn số khoá dịch với số setting, hay số chắc chắn với số cần xem lại', () => {
    const lines = view.render(base({ unused: { certain: 1, review: 2, notLoaded: 0, translationKeys: 2, settings: 1 } }));

    expect(lines).toContain('File không dùng  1 chắc chắn, 2 cần xem lại');
    expect(lines).toContain('Không thấy dùng  2 khoá dịch, 1 setting');
    // Nhóm "dùng mà không nạp" chỉ hiện khi có.
    expect(lines.join('\n')).not.toContain('Dùng mà không nạp');
  });

  it('đếm riêng nhóm asset dùng mà không nạp', () => {
    const lines = view.render(base({ unused: { certain: 0, review: 1, notLoaded: 1, translationKeys: 0, settings: 0 } }));

    expect(lines.join('\n')).toContain('Dùng mà không nạp  1 file JavaScript');
  });
});
