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
      { path: 'locales/fr.json', kind: 'locale', ext: 'json' },
      { path: 'locales/en.default.schema.json', kind: 'locale_schema', ext: 'json' },
      { path: 'config/settings_schema.json', kind: 'config', ext: 'json' },
    ];

    // Nội dung cố ý không phải JSON hợp lệ: các file này không được đem đi parse.
    for (const file of files) {
      expect(core.extractRefs(file, "{% render 'x' %} { hỏng")).toEqual([]);
    }
  });
});

describe('extractFile', () => {
  it('trả cả ref lẫn dữ kiện schema của file .liquid', () => {
    const file: ThemeFile = { path: 'sections/hero.liquid', kind: 'section', ext: 'liquid' };
    const content = "{% render 'price' %}{% schema %}{ \"presets\": [{ \"name\": \"Hero\" }] }{% endschema %}";

    const result = core.extractFile(file, content);

    expect(result.refs.map((r) => r.to)).toEqual(['price']);
    expect(result.schema).toEqual({ presets: 1, acceptsThemeBlocks: false });
  });

  it('trả schema null cho file .json và file không chứa quan hệ', () => {
    const template: ThemeFile = { path: 'templates/index.json', kind: 'template', ext: 'json' };
    const asset: ThemeFile = { path: 'assets/base.css', kind: 'asset', ext: 'css' };

    const fromJson = core.extractFile(template, JSON.stringify({ sections: { a: { type: 'hero' } } }));

    expect(fromJson.refs.map((r) => r.to)).toEqual(['hero']);
    expect(fromJson.schema).toBeNull();
    expect(core.extractFile(asset, 'body {}')).toEqual({ refs: [], schema: null, translationKeys: [] });
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
