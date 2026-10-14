import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GraphNotReadyError } from '../src/common/errors.js';
import { graphDbPath } from '../src/infrastructure/sqlite/schema.js';
import { core, registry } from './helpers.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'mini-theme');

let tmp: string;
let themeRoot: string;
let previousHome: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-status-'));
  themeRoot = path.join(tmp, 'mini-theme');
  await cp(FIXTURE, themeRoot, { recursive: true });

  // Sổ đăng ký trống của riêng từng test, để đếm được chính xác số mục.
  previousHome = process.env.THEMEGRAPH_HOME;
  process.env.THEMEGRAPH_HOME = path.join(tmp, 'home');
});

afterEach(async () => {
  process.env.THEMEGRAPH_HOME = previousHome;
  await rm(tmp, { recursive: true, force: true });
});

/** Đặt thời điểm sửa của một file về một giờ sau, KHÔNG đổi nội dung. */
async function touch(relPath: string): Promise<void> {
  const later = new Date(Date.now() + 3_600_000);
  await utimes(path.join(themeRoot, relPath), later, later);
}

/** Thêm một dòng vào cuối file: nội dung đổi thật. */
async function edit(relPath: string): Promise<void> {
  await appendFile(path.join(themeRoot, relPath), '\n');
}

describe('themeStatus', () => {
  it('báo đồ thị còn mới ngay sau khi phân tích', async () => {
    const analyzed = await core().analyzer.analyze(themeRoot);

    const status = await core().themes.status(themeRoot);

    expect(status).toEqual({
      themeRoot,
      dbPath: graphDbPath(themeRoot),
      analyzedAt: status.analyzedAt,
      toolVersion: status.toolVersion,
      nodes: analyzed.stats.nodes,
      edges: analyzed.stats.edges,
      stale: false,
      modified: [],
      added: [],
      removed: [],
    });
    expect(status.toolVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(registry().list()[0]?.analyzedAt).toBe(status.analyzedAt);
  });

  it('đếm node và cạnh từ đúng bảng của mỗi thứ', async () => {
    // Thêm một snippet không ai gọi: thêm một node, không thêm cạnh nào.
    await writeFile(path.join(themeRoot, 'snippets', 'le-loi.liquid'), '<p></p>');
    const analyzed = await core().analyzer.analyze(themeRoot);

    const status = await core().themes.status(themeRoot);

    expect(analyzed.stats.nodes).not.toBe(analyzed.stats.edges);
    expect([status.nodes, status.edges]).toEqual([analyzed.stats.nodes, analyzed.stats.edges]);
  });

  it('báo file Liquid và JSON có nội dung đổi từ lần phân tích', async () => {
    await core().analyzer.analyze(themeRoot);
    await edit('snippets/card.liquid');
    await edit('templates/index.json');

    const status = await core().themes.status(themeRoot);

    expect(status.stale).toBe(true);
    expect(status.modified).toEqual(['snippets/card.liquid', 'templates/index.json']);
    expect(status.added).toEqual([]);
    expect(status.removed).toEqual([]);
  });

  it('không coi là đã sửa khi file được lưu lại mà nội dung không đổi', async () => {
    // Đây là điều xảy ra sau git checkout, hoặc khi trình soạn thảo lưu lại file.
    await core().analyzer.analyze(themeRoot);
    await touch('snippets/card.liquid');
    await touch('templates/index.json');

    const status = await core().themes.status(themeRoot);

    expect(status.stale).toBe(false);
    expect(status.modified).toEqual([]);
  });

  it('nhận ra nội dung đổi dù thời điểm sửa của file lùi về quá khứ', async () => {
    await core().analyzer.analyze(themeRoot);
    await edit('snippets/card.liquid');
    const longAgo = new Date('2020-01-01T00:00:00Z');
    await utimes(path.join(themeRoot, 'snippets/card.liquid'), longAgo, longAgo);

    expect((await core().themes.status(themeRoot)).modified).toEqual(['snippets/card.liquid']);
  });

  it('không còn coi là đã sửa khi nội dung được trả về như cũ', async () => {
    const file = path.join(themeRoot, 'snippets/card.liquid');
    const original = await readFile(file);
    await core().analyzer.analyze(themeRoot);

    await writeFile(file, 'khac han');
    expect((await core().themes.status(themeRoot)).modified).toEqual(['snippets/card.liquid']);

    await writeFile(file, original);
    expect((await core().themes.status(themeRoot)).modified).toEqual([]);
  });

  it('coi file không có hash trong đồ thị là đã đổi', async () => {
    // Xảy ra khi lần phân tích không đọc được file: không biết nội dung cũ.
    await core().analyzer.analyze(themeRoot);
    const db = new DatabaseSync(graphDbPath(themeRoot));
    db.prepare('DELETE FROM file_hashes WHERE file = ?').run('snippets/card.liquid');
    db.close();

    expect((await core().themes.status(themeRoot)).modified).toEqual(['snippets/card.liquid']);
  });

  it('bỏ qua file không phải Liquid hay JSON bị sửa: chúng không làm đồ thị đổi', async () => {
    await core().analyzer.analyze(themeRoot);
    await edit('assets/base.css');

    const status = await core().themes.status(themeRoot);

    expect(status.stale).toBe(false);
    expect(status.modified).toEqual([]);
  });

  it('vẫn theo dõi được file mà lần phân tích không đọc hiểu nổi', async () => {
    // File hỏng cú pháp vẫn có trong đồ thị và vẫn được ghi hash.
    await writeFile(path.join(themeRoot, 'snippets', 'hong.liquid'), "{% render 'card'");
    const analyzed = await core().analyzer.analyze(themeRoot);

    expect(analyzed.errors.map((e) => e.path)).toEqual(['snippets/hong.liquid']);
    expect((await core().themes.status(themeRoot)).modified).toEqual([]);

    await edit('snippets/hong.liquid');
    expect((await core().themes.status(themeRoot)).modified).toEqual(['snippets/hong.liquid']);
  });

  it('báo file mới thêm, kể cả asset, và không tính nó là đã sửa', async () => {
    await core().analyzer.analyze(themeRoot);
    await writeFile(path.join(themeRoot, 'snippets', 'moi.liquid'), '<p></p>');
    await writeFile(path.join(themeRoot, 'assets', 'moi.png'), '');

    const status = await core().themes.status(themeRoot);

    expect(status.stale).toBe(true);
    expect(status.added).toEqual(['assets/moi.png', 'snippets/moi.liquid']);
    expect(status.modified).toEqual([]);
  });

  it('báo file đã bị xoá khỏi đĩa', async () => {
    await core().analyzer.analyze(themeRoot);
    await rm(path.join(themeRoot, 'snippets', 'card.liquid'));
    await rm(path.join(themeRoot, 'assets', 'base.css'));

    const status = await core().themes.status(themeRoot);

    expect(status.stale).toBe(true);
    expect(status.removed).toEqual(['assets/base.css', 'snippets/card.liquid']);
  });

  it('không coi loại trang, khoá dịch hay setting là file đã bị xoá', async () => {
    // Fixture có cả ba loại node này; không loại nào ứng với một file trên đĩa.
    await core().analyzer.analyze(themeRoot);

    expect((await core().themes.status(themeRoot)).removed).toEqual([]);
  });

  it('không coi file nằm ngoài quy ước thư mục là file mới', async () => {
    await core().analyzer.analyze(themeRoot);
    await writeFile(path.join(themeRoot, 'README.md'), 'x');

    expect((await core().themes.status(themeRoot)).added).toEqual([]);
  });

  it('không giữ graph.db sau khi chạy xong', async () => {
    await core().analyzer.analyze(themeRoot);
    await core().themes.status(themeRoot);

    // Nếu database còn mở, Windows sẽ từ chối xoá file này.
    await expect(rm(graphDbPath(themeRoot))).resolves.toBeUndefined();
  });

  it('nhận đường dẫn tương đối', async () => {
    await core().analyzer.analyze(themeRoot);
    const originalCwd = process.cwd();
    try {
      process.chdir(themeRoot);
      expect((await core().themes.status('.')).themeRoot).toBe(themeRoot);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('ném GraphNotReadyError khi theme chưa có đồ thị dùng được', async () => {
    // Fixture có sẵn một graph.db giả chứa chữ.
    await expect(core().themes.status(themeRoot)).rejects.toBeInstanceOf(GraphNotReadyError);
  });
});

describe('cleanTheme', () => {
  it('xoá graph.db, .gitignore, thư mục .themegraph và mục trong sổ đăng ký', async () => {
    await core().analyzer.analyze(themeRoot);
    const dataDir = path.join(themeRoot, '.themegraph');

    const result = core().themes.clean(themeRoot);

    expect(result).toEqual({
      themeRoot,
      removedFiles: [path.join(dataDir, 'graph.db'), path.join(dataDir, '.gitignore')],
      removedDir: true,
      unregistered: true,
    });
    expect(existsSync(dataDir)).toBe(false);
    expect(registry().list()).toEqual([]);
  });

  it('không đụng tới file nào của theme', async () => {
    await core().analyzer.analyze(themeRoot);
    const before = (await readdir(themeRoot, { recursive: true })).filter((p) => !p.startsWith('.themegraph')).sort();

    core().themes.clean(themeRoot);

    expect((await readdir(themeRoot, { recursive: true })).sort()).toEqual(before);
  });

  it('xoá cả file phụ của SQLite và file tạm còn sót', async () => {
    await core().analyzer.analyze(themeRoot);
    const dataDir = path.join(themeRoot, '.themegraph');
    for (const name of ['graph.db-wal', 'graph.db-shm', 'graph.db.tmp']) await writeFile(path.join(dataDir, name), 'x');

    const result = core().themes.clean(themeRoot);

    expect(result.removedFiles.map((f) => path.basename(f))).toEqual([
      'graph.db',
      'graph.db-wal',
      'graph.db-shm',
      'graph.db.tmp',
      '.gitignore',
    ]);
    expect(result.removedDir).toBe(true);
  });

  it('giữ lại file lạ và thư mục chứa nó', async () => {
    await core().analyzer.analyze(themeRoot);
    const stranger = path.join(themeRoot, '.themegraph', 'ghi-chu.txt');
    await writeFile(stranger, 'cua nguoi dung');

    const result = core().themes.clean(themeRoot);

    expect(result.removedDir).toBe(false);
    expect(existsSync(stranger)).toBe(true);
    expect(existsSync(graphDbPath(themeRoot))).toBe(false);
  });

  it('không làm gì và không báo lỗi trên theme chưa từng phân tích', async () => {
    const fresh = path.join(tmp, 'chua-phan-tich');
    await mkdir(fresh);

    expect(core().themes.clean(fresh)).toEqual({ themeRoot: fresh, removedFiles: [], removedDir: false, unregistered: false });
  });

  it('chạy lần hai trên theme đã sạch thì không còn gì để xoá', async () => {
    await core().analyzer.analyze(themeRoot);
    core().themes.clean(themeRoot);

    expect(core().themes.clean(themeRoot)).toMatchObject({ removedFiles: [], removedDir: false, unregistered: false });
  });

  it('gỡ mục trong sổ đăng ký dù thư mục theme đã bị xoá', async () => {
    await core().analyzer.analyze(themeRoot);
    await rm(themeRoot, { recursive: true });

    expect(core().themes.clean(themeRoot)).toMatchObject({ removedFiles: [], removedDir: false, unregistered: true });
    expect(registry().list()).toEqual([]);
  });

  it('chỉ gỡ theme được chỉ khỏi sổ đăng ký', async () => {
    const other = path.join(tmp, 'theme-khac');
    await cp(FIXTURE, other, { recursive: true });
    await core().analyzer.analyze(themeRoot);
    await core().analyzer.analyze(other);

    core().themes.clean(themeRoot);

    expect(registry().list().map((e) => e.path)).toEqual([other]);
    expect(existsSync(graphDbPath(other))).toBe(true);
  });

  it('nhận đường dẫn tương đối', async () => {
    await core().analyzer.analyze(themeRoot);
    const originalCwd = process.cwd();
    try {
      process.chdir(themeRoot);
      expect(core().themes.clean('.').themeRoot).toBe(themeRoot);
    } finally {
      process.chdir(originalCwd);
    }
    expect(existsSync(graphDbPath(themeRoot))).toBe(false);
  });
});

describe('cleanAllThemes', () => {
  it('xoá dữ liệu của mọi theme trong sổ đăng ký', async () => {
    const other = path.join(tmp, 'theme-khac');
    await cp(FIXTURE, other, { recursive: true });
    await core().analyzer.analyze(themeRoot);
    await core().analyzer.analyze(other);

    const results = core().themes.cleanAll();

    expect(results.map((r) => [r.themeRoot, r.removedDir, r.unregistered])).toEqual([
      [themeRoot, true, true],
      [other, true, true],
    ]);
    expect(existsSync(graphDbPath(themeRoot))).toBe(false);
    expect(existsSync(graphDbPath(other))).toBe(false);
    expect(registry().list()).toEqual([]);
  });

  it('trả mảng rỗng khi sổ đăng ký trống', () => {
    expect(core().themes.cleanAll()).toEqual([]);
  });
});
