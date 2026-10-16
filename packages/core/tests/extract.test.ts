import { describe, expect, it } from 'vitest';

import * as core from '../src/index.js';
import type { ThemeFile } from '../src/index.js';

/** Bộ phân tích đúng như AnalyzeModule nối, lấy qua API công khai của gói. */
const parser = new core.ThemeFileParser(core.defaultParsers());

describe('ThemeFileParser — chọn parser theo loại file', () => {
  it('dùng bộ trích Liquid cho file .liquid', () => {
    const file: ThemeFile = { path: 'snippets/card.liquid', kind: 'snippet', ext: 'liquid' };

    expect(parser.parse(file, "{% render 'price' %}").refs.map((r) => [r.source, r.kind, r.to])).toEqual([
      ['liquid', 'render', 'price'],
    ]);
  });

  it('dùng bộ trích JSON cho template .json', () => {
    const file: ThemeFile = { path: 'templates/index.json', kind: 'template', ext: 'json' };
    const content = JSON.stringify({ sections: { a: { type: 'hero' } } });

    expect(parser.parse(file, content).refs.map((r) => [r.source, r.kind, r.to])).toEqual([
      ['json', 'section', 'hero'],
    ]);
  });

  it('trả mảng rỗng cho file không chứa quan hệ: asset, locale, config', () => {
    const files: ThemeFile[] = [
      { path: 'assets/base.css', kind: 'asset', ext: 'css' },
      { path: 'assets/app.js', kind: 'asset', ext: 'js' },
      { path: 'locales/fr.json', kind: 'locale', ext: 'json' },
      { path: 'locales/en.default.schema.json', kind: 'locale_schema', ext: 'json' },
      { path: 'config/settings_data.json', kind: 'config', ext: 'json' },
    ];

    // Nội dung cố ý không phải JSON hợp lệ: các file này không được đem đi parse.
    for (const file of files) {
      expect(parser.parse(file, "{% render 'x' %} { hỏng").refs).toEqual([]);
    }
  });
});

describe('ThemeFileParser — toàn bộ kết quả', () => {
  it('trả cả ref lẫn dữ kiện schema của file .liquid', () => {
    const file: ThemeFile = { path: 'sections/hero.liquid', kind: 'section', ext: 'liquid' };
    const content = "{% render 'price' %}{% schema %}{ \"presets\": [{ \"name\": \"Hero\" }] }{% endschema %}";

    const result = parser.parse(file, content);

    expect(result.refs.map((r) => r.to)).toEqual(['price']);
    expect(result.schema).toEqual({ presets: 1, acceptsThemeBlocks: false, localBlockTypes: [] });
  });

  it('trả schema null cho file .json và file không chứa quan hệ', () => {
    const template: ThemeFile = { path: 'templates/index.json', kind: 'template', ext: 'json' };
    const asset: ThemeFile = { path: 'assets/base.css', kind: 'asset', ext: 'css' };

    const fromJson = parser.parse(template, JSON.stringify({ sections: { a: { type: 'hero' } } }));

    expect(fromJson.refs.map((r) => r.to)).toEqual(['hero']);
    expect(fromJson.schema).toBeNull();
    expect(parser.parse(asset, 'body {}')).toEqual({
      refs: [],
      schema: null,
      translationKeys: [],
      settings: [],
      elements: [],
      importMap: [],
      calls: [],
      resourceSettings: [],
      warnings: [],
    });
  });
});

describe('gói @themegraph/core', () => {
  it('xuất module gốc và các provider chính ra ngoài qua index', () => {
    for (const name of ['CoreModule', 'AnalyzeService', 'ThemeService', 'GraphScopeFactory', 'ThemeFileParser', 'GraphBuilder'] as const) {
      expect(typeof core[name], name).toBe('function');
    }
  });
});
