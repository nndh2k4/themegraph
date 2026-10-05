import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { analyze } from '../src/analyze.js';
import { readRegistry, registryPath } from '../src/registry.js';
import { graphDbPath } from '../src/store.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'mini-theme');

let themeRoot: string;

beforeEach(async () => {
  // Chép fixture ra thư mục tạm của hệ điều hành rồi phân tích bản chép.
  // analyze() ghi graph.db vào thư mục theme; không được để nó ghi vào repo,
  // và theme "nằm ngoài repo" cũng chính là cách công cụ được dùng thật.
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-analyze-'));
  themeRoot = path.join(tmp, 'mini-theme');
  await cp(FIXTURE, themeRoot, { recursive: true });
});

afterEach(async () => {
  await rm(path.dirname(themeRoot), { recursive: true, force: true });
});

/** Chạy một câu SELECT trên graph.db của bản chép, trả về mọi dòng. */
function query(sql: string, ...params: string[]): Record<string, unknown>[] {
  const db = new DatabaseSync(graphDbPath(themeRoot), { readOnly: true });
  try {
    return db
      .prepare(sql)
      .all(...params)
      .map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

/**
 * Các mục của sổ đăng ký ứng với theme của test đang chạy. Mọi test trong file
 * này dùng chung một sổ đăng ký tạm, nên sổ còn chứa theme của các test khác.
 */
const registered = () => readRegistry().filter((entry) => entry.path === themeRoot);

describe('analyze', () => {
  it('trả về thống kê của đồ thị', async () => {
    const result = await analyze(themeRoot);

    expect(result.stats).toEqual({
      files: 13,
      nodes: 22,
      edges: 22,
      refs: 18,
      nodesByKind: {
        asset: 1,
        block: 1,
        config: 1,
        layout: 1,
        locale: 1,
        locale_schema: 1,
        page_type: 4,
        section: 1,
        section_group: 1,
        setting: 3,
        snippet: 1,
        template: 4,
        translation_key: 2,
      },
      edgesByType: {
        READS_SETTING: 3,
        RENDERS: 9,
        USES_ASSET: 1,
        USES_LAYOUT: 3,
        USES_TEMPLATE: 4,
        USES_TRANSLATION: 2,
      },
      refsByStatus: { missing: 2, none: 1, resolved: 15 },
    });
  });

  it('ghi graph.db vào thư mục theme và trả về đường dẫn tuyệt đối của nó', async () => {
    const result = await analyze(themeRoot);

    expect(result.dbPath).toBe(graphDbPath(themeRoot));
    expect(path.isAbsolute(result.dbPath)).toBe(true);
    expect(existsSync(result.dbPath)).toBe(true);
  });

  it('thay database cũ trong fixture bằng database thật', async () => {
    // Fixture có sẵn .themegraph/graph.db chứa chữ, không phải SQLite.
    await analyze(themeRoot);

    expect(query('SELECT count(*) AS n FROM nodes')).toEqual([{ n: 22 }]);
  });

  it('ghi dữ kiện schema của section và block vào database', async () => {
    await analyze(themeRoot);

    // hero có một preset; "blocks" của nó liệt kê text và @app, không có @theme.
    expect(query('SELECT file, presets, accepts_theme_blocks FROM schemas ORDER BY file')).toEqual([
      { file: 'blocks/text.liquid', presets: 0, accepts_theme_blocks: 0 },
      { file: 'sections/hero.liquid', presets: 1, accepts_theme_blocks: 0 },
    ]);
  });

  it('liệt kê các tham chiếu hỏng kèm file và dòng', async () => {
    const result = await analyze(themeRoot);

    expect(result.missing.map((r) => [r.from, r.line, r.kind, r.target])).toEqual([
      ['snippets/card.liquid', 4, 'asset', 'assets/icon-star'],
      ['templates/customers/login.json', 0, 'section', 'sections/missing-section.liquid'],
    ]);
  });

  it('báo khoá dịch không có trong locale mặc định là tham chiếu hỏng', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'badge.liquid'), "<b>{{ 'general.tilte' | t }}</b>");

    const result = await analyze(themeRoot);

    expect(result.missing.map((r) => [r.from, r.line, r.kind, r.target])).toContainEqual([
      'snippets/badge.liquid',
      1,
      'translation',
      't:general.tilte',
    ]);
  });

  it('nối file tới khoá dịch nó dùng, kể cả khoá số nhiều', async () => {
    await analyze(themeRoot);

    expect(query("SELECT src, dst FROM edges WHERE type = 'USES_TRANSLATION' ORDER BY src")).toEqual([
      { src: 'sections/hero.liquid', dst: 't:general.title' },
      { src: 'snippets/card.liquid', dst: 't:cart.items' },
    ]);
  });

  it('ghi lỗi của file locale mặc định hỏng mà không dừng cả lần phân tích', async () => {
    await writeFile(path.join(themeRoot, 'locales', 'en.default.json'), '{ "general": ');

    const result = await analyze(themeRoot);

    expect(result.errors.map((e) => e.path)).toEqual(['locales/en.default.json']);
    // Không đọc được khoá nào thì mọi lời gọi t đều thành tham chiếu hỏng.
    expect(result.stats.nodesByKind.translation_key).toBeUndefined();
    expect(result.missing.filter((r) => r.kind === 'translation')).toHaveLength(2);
  });

  it('nối file tới setting nó đọc: toàn cục, của section, của theme block', async () => {
    await analyze(themeRoot);

    expect(query("SELECT src, dst FROM edges WHERE type = 'READS_SETTING' ORDER BY src")).toEqual([
      { src: 'blocks/text.liquid', dst: 'setting:blocks/text.liquid#block.text' },
      { src: 'layout/theme.liquid', dst: 'setting:settings.accent' },
      { src: 'sections/hero.liquid', dst: 'setting:sections/hero.liquid#section.show_card' },
    ]);
  });

  it('báo setting được đọc trực tiếp mà không được khai là tham chiếu hỏng', async () => {
    await writeFile(
      path.join(themeRoot, 'sections', 'promo.liquid'),
      '{{ section.settings.title }}\n{{ settings.acent }}\n{% schema %}{ "name": "Promo", "settings": [{ "type": "text", "id": "heading" }] }{% endschema %}',
    );

    const result = await analyze(themeRoot);

    expect(result.missing.filter((r) => r.kind === 'setting').map((r) => [r.from, r.line, r.target])).toEqual([
      ['sections/promo.liquid', 1, 'setting:sections/promo.liquid#section.title'],
      ['sections/promo.liquid', 2, 'setting:settings.acent'],
    ]);
  });

  it('nối section.settings trong snippet tới section đang render nó', async () => {
    // hero render card; cho card đọc setting của section.
    await writeFile(path.join(themeRoot, 'snippets', 'card.liquid'), '{{ section.settings.show_card }}');

    await analyze(themeRoot);

    expect(query("SELECT dst FROM edges WHERE src = 'snippets/card.liquid' AND type = 'READS_SETTING'")).toEqual([
      { dst: 'setting:sections/hero.liquid#section.show_card' },
    ]);
  });

  it('ghi unresolved cho lần đọc trong snippet không tìm ra chủ, và không coi là hỏng', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'card.liquid'), '{{ section.settings.khong_ai_khai }}');

    const result = await analyze(themeRoot);

    expect(result.stats.refsByStatus.unresolved).toBe(1);
    expect(result.missing.some((r) => r.kind === 'setting')).toBe(false);
  });

  it('ghi theme vào sổ đăng ký toàn cục, khớp với những gì ghi trong graph.db', async () => {
    const result = await analyze(themeRoot);

    const [meta] = query("SELECT value FROM meta WHERE key = 'analyzed_at'");

    expect(result.registered).toBe(true);
    expect(registered()).toEqual([
      { path: themeRoot, name: 'mini-theme', analyzedAt: meta?.value, nodes: 22, edges: 22 },
    ]);
  });

  it('phân tích lại thì cập nhật mục cũ trong sổ đăng ký, không thêm mục trùng', async () => {
    await analyze(themeRoot);
    await writeFile(path.join(themeRoot, 'snippets', 'moi.liquid'), '<p></p>');
    await analyze(themeRoot);

    expect(registered().map((e) => [e.name, e.nodes])).toEqual([['mini-theme', 23]]);
  });

  it('vẫn phân tích thành công khi không ghi được sổ đăng ký', async () => {
    const previous = process.env.THEMEGRAPH_HOME;
    // Đặt "thư mục home" là đường dẫn đi xuyên qua một FILE: không tạo được.
    process.env.THEMEGRAPH_HOME = path.join(themeRoot, 'layout', 'theme.liquid', 'home');

    try {
      const result = await analyze(themeRoot);

      expect(result.registered).toBe(false);
      expect(result.stats.nodes).toBe(22);
      expect(existsSync(result.dbPath)).toBe(true);
    } finally {
      process.env.THEMEGRAPH_HOME = previous;
    }
  });

  it('không ghi vào sổ đăng ký khi thư mục không phải theme', async () => {
    const before = existsSync(registryPath()) ? readRegistry() : [];
    const notTheme = await mkdtemp(path.join(os.tmpdir(), 'themegraph-empty-'));

    try {
      await expect(analyze(notTheme)).rejects.toThrow();
      expect(readRegistry()).toEqual(before);
    } finally {
      await rm(notTheme, { recursive: true, force: true });
    }
  });

  it('ghi hash nội dung của mọi file Liquid và JSON, không ghi cho file khác', async () => {
    await analyze(themeRoot);

    const rows = query('SELECT file, hash FROM file_hashes ORDER BY file');
    const files = rows.map((r) => String(r.file));

    // 12 file .liquid / .json của fixture; assets/base.css không được đọc.
    expect(files).toHaveLength(12);
    expect(files).toContain('snippets/card.liquid');
    expect(files).toContain('locales/en.default.json');
    expect(files).not.toContain('assets/base.css');
    expect(rows.every((r) => /^[0-9a-f]{40}$/.test(String(r.hash)))).toBe(true);
  });

  it('hai file cùng nội dung có cùng hash, khác nội dung thì khác hash', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'a.liquid'), '<p>giong</p>');
    await writeFile(path.join(themeRoot, 'snippets', 'b.liquid'), '<p>giong</p>');
    await writeFile(path.join(themeRoot, 'snippets', 'c.liquid'), '<p>khac</p>');
    await analyze(themeRoot);

    const hashOf = (file: string) => query('SELECT hash FROM file_hashes WHERE file = ?', file)[0]?.hash;

    expect(hashOf('snippets/a.liquid')).toBe(hashOf('snippets/b.liquid'));
    expect(hashOf('snippets/a.liquid')).not.toBe(hashOf('snippets/c.liquid'));
  });

  it('liệt kê file bị bỏ qua', async () => {
    const result = await analyze(themeRoot);

    expect(result.skipped).toEqual(['listings/velyn/index.json']);
  });

  it('trả lời được: sửa snippets/card.liquid thì trang nào bị ảnh hưởng', async () => {
    await analyze(themeRoot);

    const pages = query(
      `WITH RECURSIVE affected(id) AS (
         SELECT ?
         UNION
         SELECT e.src FROM edges e JOIN affected a ON e.dst = a.id
       )
       SELECT n.id FROM affected a JOIN nodes n ON n.id = a.id
       WHERE n.kind = 'page_type' ORDER BY n.id`,
      'snippets/card.liquid',
    ).map((r) => r.id);

    // gift_card gọi card trực tiếp; index và product đi qua section hero;
    // customers/login không có section nào hợp lệ nhưng vẫn dùng layout
    // theme.liquid, mà layout gọi footer-group -> hero -> card.
    expect(pages).toEqual(['page:customers/login', 'page:gift_card', 'page:index', 'page:product']);
  });

  it('trả lời được: trang index render những file nào', async () => {
    await analyze(themeRoot);

    const reached = query(
      `WITH RECURSIVE reach(id) AS (
         SELECT ?
         UNION
         SELECT e.dst FROM edges e JOIN reach r ON e.src = r.id
       )
       SELECT id FROM reach ORDER BY id`,
      'page:index',
    ).map((r) => r.id);

    expect(reached).toEqual([
      'assets/base.css',
      'blocks/text.liquid',
      'layout/theme.liquid',
      'page:index',
      'sections/footer-group.json',
      'sections/hero.liquid',
      // Câu SQL này đi qua mọi loại cạnh nên gặp cả setting và khoá dịch mà
      // các file trên đường đi dùng tới.
      'setting:blocks/text.liquid#block.text',
      'setting:sections/hero.liquid#section.show_card',
      'setting:settings.accent',
      'snippets/card.liquid',
      't:cart.items',
      't:general.title',
      'templates/index.json',
    ]);
  });

  it('một file hỏng không làm dừng cả lần phân tích', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'broken.liquid'), "{% render 'card'");

    const result = await analyze(themeRoot);

    expect(result.errors.map((e) => e.path)).toEqual(['snippets/broken.liquid']);
    expect(result.errors[0]?.message).toContain('snippets/broken.liquid');
    // File hỏng vẫn là một node; các file khác vẫn được phân tích đầy đủ.
    expect(result.stats.files).toBe(14);
    expect(result.stats.edgesByType.RENDERS).toBe(9);
  });

  it('không có lỗi nào khi mọi file đều đọc được', async () => {
    const result = await analyze(themeRoot);

    expect(result.errors).toEqual([]);
  });

  it('chạy hai lần liên tiếp cho cùng nội dung database', async () => {
    const dump = () => ({
      nodes: query('SELECT * FROM nodes ORDER BY id'),
      edges: query('SELECT * FROM edges ORDER BY src, dst, type'),
      refs: query('SELECT * FROM refs ORDER BY id'),
      schemas: query('SELECT * FROM schemas ORDER BY file'),
      fileHashes: query('SELECT * FROM file_hashes ORDER BY file'),
    });

    const first = await analyze(themeRoot);
    const firstDump = dump();
    const second = await analyze(themeRoot);

    // Lần hai gặp .themegraph/graph.db do lần một ghi ra: không được quét nó.
    expect(second.stats).toEqual(first.stats);
    expect(dump()).toEqual(firstDump);
    expect((await readdir(path.join(themeRoot, '.themegraph'))).sort()).toEqual(['.gitignore', 'graph.db']);
  });

  it('nhận đường dẫn tương đối, tính từ thư mục đang đứng', async () => {
    const originalCwd = process.cwd();

    try {
      // Đây là cách dùng chính của lệnh: đứng trong thư mục theme, gõ "analyze ."
      process.chdir(themeRoot);
      const result = await analyze('.');

      expect(result.stats.files).toBe(13);
      expect(existsSync(path.join(themeRoot, '.themegraph', 'graph.db'))).toBe(true);

      // Kết quả trả về phải là đường dẫn tuyệt đối, để người gọi dùng tiếp được
      // dù sau đó có đổi thư mục đang đứng.
      expect(path.isAbsolute(result.themeRoot)).toBe(true);
      expect(path.isAbsolute(result.dbPath)).toBe(true);

      process.chdir(originalCwd);
      expect(existsSync(result.dbPath)).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('ném lỗi và không tạo .themegraph khi thư mục không phải theme', async () => {
    const notTheme = await mkdtemp(path.join(os.tmpdir(), 'themegraph-empty-'));

    try {
      await expect(analyze(notTheme)).rejects.toThrow('thiếu layout');
      expect(existsSync(path.join(notTheme, '.themegraph'))).toBe(false);
    } finally {
      await rm(notTheme, { recursive: true, force: true });
    }
  });
});
