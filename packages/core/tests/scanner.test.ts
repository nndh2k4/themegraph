import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scanThemeDir } from '../src/scanner.js';

// Vị trí fixture tính theo vị trí của chính file test này,
// KHÔNG theo process.cwd() — scanner phải độc lập với thư mục làm việc.
const MINI_THEME = path.join(import.meta.dirname, 'fixtures', 'mini-theme');

describe('scanThemeDir', () => {
  it('phân loại snippets/card.liquid là snippet', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const file = result.files.find((f) => f.path === 'snippets/card.liquid');

    expect(file).toBeDefined();
    expect(file?.kind).toBe('snippet');
  });

  it('phân biệt section và section_group bằng đuôi file, không bằng tên', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const section = result.files.find((f) => f.path === 'sections/hero.liquid');
    const group = result.files.find((f) => f.path === 'sections/footer-group.json');

    expect(section).toBeDefined();
    expect(section?.kind).toBe('section');

    expect(group).toBeDefined();
    expect(group?.kind).toBe('section_group');
  });

  it('đi vào thư mục con của templates và trả path dùng dấu /', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const file = result.files.find((f) => f.kind === 'template' && f.path.includes('login'));

    expect(file).toBeDefined();
    // Khoá chặt cả đệ quy lẫn dấu phân cách: trên Windows một scanner quên
    // chuẩn hoá sẽ trả 'templates\\customers\\login.json'.
    expect(file?.path).toBe('templates/customers/login.json');
  });

  it('nhận templates/*.liquid là template, ext không có dấu chấm', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const file = result.files.find((f) => f.path === 'templates/gift_card.liquid');

    expect(file).toBeDefined();
    expect(file?.kind).toBe('template');
    expect(file?.ext).toBe('liquid');
  });

  it('tách locale_schema khỏi locale bằng đuôi kép .schema.json', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const locale = result.files.find((f) => f.path === 'locales/en.default.json');
    const schema = result.files.find((f) => f.path === 'locales/en.default.schema.json');

    expect(locale).toBeDefined();
    expect(locale?.kind).toBe('locale');

    // Cả hai đều có ext === 'json', nên nhánh .schema.json phải được hỏi TRƯỚC.
    expect(schema).toBeDefined();
    expect(schema?.kind).toBe('locale_schema');
  });

  it('phân loại layout, asset và config theo thư mục cấp một', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const kindOf = (p: string) => result.files.find((f) => f.path === p)?.kind;

    expect(kindOf('layout/theme.liquid')).toBe('layout');
    expect(kindOf('assets/base.css')).toBe('asset');
    expect(kindOf('config/settings_schema.json')).toBe('config');
  });

  it('phân loại blocks/*.liquid là block', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const file = result.files.find((f) => f.path === 'blocks/text.liquid');

    expect(file).toBeDefined();
    expect(file?.kind).toBe('block');
  });

  it('đưa file ngoài quy ước thư mục của Shopify vào skipped', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const paths = result.files.map((f) => f.path);

    // listings/ là thư mục riêng của Purity, không phải thư mục chuẩn.
    expect(paths).not.toContain('listings/velyn/index.json');
    expect(result.skipped).toContain('listings/velyn/index.json');
  });

  it('không đi vào thư mục ẩn như .themegraph', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const all = [...result.files.map((f) => f.path), ...result.skipped];

    // .themegraph/ là output của chính công cụ: không vào files, cũng không
    // vào skipped. Thư mục bị chặn thì coi như không tồn tại.
    expect(all.filter((p) => p.startsWith('.themegraph/'))).toEqual([]);
  });

  it('không trả đường dẫn nào chứa dấu gạch chéo ngược', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const all = [...result.files.map((f) => f.path), ...result.skipped];

    expect(all.filter((p) => p.includes('\\'))).toEqual([]);
  });

  it('trả files và skipped đã sắp xếp theo đường dẫn', async () => {
    const result = await scanThemeDir(MINI_THEME);

    const paths = result.files.map((f) => f.path);

    expect(paths).toEqual([...paths].sort());
    expect(result.skipped).toEqual([...result.skipped].sort());
  });

  it('ném lỗi khi thư mục không có layout/*.liquid', async () => {
    const emptyDir = await mkdtemp(path.join(os.tmpdir(), 'themegraph-test-'));

    try {
      await expect(scanThemeDir(emptyDir)).rejects.toThrow('thiếu layout');
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('cho cùng kết quả khi thư mục làm việc ở chỗ khác', async () => {
    const before = await scanThemeDir(MINI_THEME);
    const originalCwd = process.cwd();

    try {
      // Đứng ở một thư mục không liên quan gì tới repo hay fixture.
      process.chdir(os.tmpdir());
      const after = await scanThemeDir(MINI_THEME);

      expect(after).toEqual(before);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
