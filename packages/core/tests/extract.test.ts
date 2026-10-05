import { describe, expect, it } from 'vitest';

import * as core from '../src/index.js';
import type { ThemeFile } from '../src/index.js';

describe('extractRefs', () => {
  it('dùng bộ trích Liquid cho file .liquid', () => {
    const file: ThemeFile = { path: 'snippets/card.liquid', kind: 'snippet', ext: 'liquid' };

    expect(core.extractRefs(file, "{% render 'price' %}").map((r) => [r.source, r.kind, r.to])).toEqual([
      ['liquid', 'render', 'price'],
    ]);
  });

  it('dùng bộ trích JSON cho template .json', () => {
    const file: ThemeFile = { path: 'templates/index.json', kind: 'template', ext: 'json' };
    const content = JSON.stringify({ sections: { a: { type: 'hero' } } });

    expect(core.extractRefs(file, content).map((r) => [r.source, r.kind, r.to])).toEqual([
      ['json', 'section', 'hero'],
    ]);
  });

  it('trả mảng rỗng cho file không chứa quan hệ: asset, locale, config', () => {
    const files: ThemeFile[] = [
      { path: 'assets/base.css', kind: 'asset', ext: 'css' },
      { path: 'assets/app.js', kind: 'asset', ext: 'js' },
      { path: 'locales/en.default.json', kind: 'locale', ext: 'json' },
      { path: 'config/settings_schema.json', kind: 'config', ext: 'json' },
    ];

    // Nội dung cố ý không phải JSON hợp lệ: các file này không được đem đi parse.
    for (const file of files) {
      expect(core.extractRefs(file, "{% render 'x' %} { hỏng")).toEqual([]);
    }
  });
});

describe('gói @themegraph/core', () => {
  it('xuất các hàm chính ra ngoài qua index', () => {
    expect(typeof core.scanThemeDir).toBe('function');
    expect(typeof core.extractRefs).toBe('function');
    expect(typeof core.extractLiquidRefs).toBe('function');
    expect(typeof core.extractJsonRefs).toBe('function');
  });
});
