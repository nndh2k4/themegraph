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
});
