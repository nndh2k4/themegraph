import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findRegisteredTheme, listThemes, readRegistry, registerTheme, registryDir, registryPath, unregisterTheme } from '../src/registry.js';
import type { RegistryEntry } from '../src/registry.js';
import { queryGraph, removeTempTheme, saveToTempTheme } from './helpers.js';

let home: string;
let previousHome: string | undefined;

beforeEach(async () => {
  // Mỗi test một sổ đăng ký trống của riêng nó.
  previousHome = process.env.THEMEGRAPH_HOME;
  home = await mkdtemp(path.join(os.tmpdir(), 'themegraph-registry-'));
  process.env.THEMEGRAPH_HOME = home;
});

afterEach(async () => {
  process.env.THEMEGRAPH_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});

const entry = (themePath: string, extra: Partial<RegistryEntry> = {}): RegistryEntry => ({
  path: themePath,
  name: path.basename(themePath),
  analyzedAt: '2026-10-05T08:00:00.000Z',
  nodes: 10,
  edges: 20,
  ...extra,
});

/** Một đường dẫn tuyệt đối hợp lệ trên hệ điều hành đang chạy test. */
const themeAt = (name: string) => path.join(home, 'themes', name);

describe('registryDir và registryPath', () => {
  it('dùng thư mục trong THEMEGRAPH_HOME khi biến này được đặt', () => {
    expect(registryDir()).toBe(home);
    expect(registryPath()).toBe(path.join(home, 'registry.json'));
  });

  it('mặc định là .themegraph trong thư mục home khi biến không được đặt hoặc rỗng', () => {
    const expected = path.join(os.homedir(), '.themegraph');

    delete process.env.THEMEGRAPH_HOME;
    expect(registryDir()).toBe(expected);

    process.env.THEMEGRAPH_HOME = '';
    expect(registryDir()).toBe(expected);
  });

  it('đổi THEMEGRAPH_HOME tương đối thành đường dẫn tuyệt đối', () => {
    process.env.THEMEGRAPH_HOME = 'mot-thu-muc';

    expect(path.isAbsolute(registryDir())).toBe(true);
  });
});

describe('readRegistry', () => {
  it('trả danh sách rỗng khi chưa có file, và không tạo ra file', () => {
    expect(readRegistry()).toEqual([]);
    expect(existsSync(registryPath())).toBe(false);
  });

  it('trả danh sách rỗng khi file không phải JSON', async () => {
    await writeFile(registryPath(), '{ hong');

    expect(readRegistry()).toEqual([]);
  });

  it('trả danh sách rỗng khi file là JSON nhưng sai cấu trúc', async () => {
    for (const content of ['null', '[]', '"x"', '{}', '{ "version": 1 }', '{ "version": 1, "themes": {} }']) {
      await writeFile(registryPath(), content);
      expect(readRegistry()).toEqual([]);
    }
  });

  it('trả danh sách rỗng khi file thuộc phiên bản định dạng khác', async () => {
    await writeFile(registryPath(), JSON.stringify({ version: 2, themes: [entry(themeAt('dawn'))] }));

    expect(readRegistry()).toEqual([]);
  });

  it('bỏ riêng mục sai hình dạng, giữ các mục còn lại', async () => {
    const good = entry(themeAt('dawn'));
    const themes = [good, null, 'x', { path: 5 }, { ...good, nodes: '10' }, { ...good, name: undefined }];
    await writeFile(registryPath(), JSON.stringify({ version: 1, themes }));

    expect(readRegistry()).toEqual([good]);
  });
});

describe('registerTheme', () => {
  it('tạo thư mục và file khi chưa có', () => {
    process.env.THEMEGRAPH_HOME = path.join(home, 'chua', 'co');

    registerTheme(entry(themeAt('dawn')));

    expect(readRegistry()).toEqual([entry(themeAt('dawn'))]);
  });

  it('ghi file JSON đọc được, có số phiên bản, không để sót file tạm', async () => {
    registerTheme(entry(themeAt('dawn')));

    const data = JSON.parse(await readFile(registryPath(), 'utf8')) as { version: number; themes: unknown[] };

    expect(data.version).toBe(1);
    expect(data.themes).toEqual([entry(themeAt('dawn'))]);
    expect(await readdir(home)).toEqual(['registry.json']);
  });

  it('giữ các theme khác khi thêm một theme mới', () => {
    registerTheme(entry(themeAt('dawn')));
    registerTheme(entry(themeAt('purity')));

    expect(readRegistry().map((e) => e.name)).toEqual(['dawn', 'purity']);
  });

  it('thay mục cũ khi phân tích lại cùng một theme, không thêm mục trùng', () => {
    registerTheme(entry(themeAt('dawn'), { nodes: 1 }));
    registerTheme(entry(themeAt('purity')));
    registerTheme(entry(themeAt('dawn'), { nodes: 99, analyzedAt: '2026-10-06T00:00:00.000Z' }));

    expect(readRegistry()).toEqual([
      entry(themeAt('dawn'), { nodes: 99, analyzedAt: '2026-10-06T00:00:00.000Z' }),
      entry(themeAt('purity')),
    ]);
  });

  it('coi hai cách viết của cùng một đường dẫn là một theme', () => {
    registerTheme(entry(themeAt('dawn')));
    // Cùng thư mục, viết vòng qua một thư mục con rồi quay ra.
    registerTheme(entry(path.join(themeAt('dawn'), 'sections', '..'), { nodes: 2 }));

    expect(readRegistry()).toHaveLength(1);
    expect(readRegistry()[0]?.nodes).toBe(2);
  });

  it.runIf(process.platform === 'win32')('trên Windows không phân biệt hoa thường trong đường dẫn', () => {
    registerTheme(entry(themeAt('dawn')));
    registerTheme(entry(themeAt('dawn').toUpperCase(), { nodes: 2 }));

    expect(readRegistry()).toHaveLength(1);
  });

  it.runIf(process.platform !== 'win32')('trên hệ khác thì phân biệt hoa thường trong đường dẫn', () => {
    registerTheme(entry(themeAt('dawn')));
    registerTheme(entry(themeAt('DAWN')));

    expect(readRegistry()).toHaveLength(2);
  });

  it('xếp theo tên rồi theo đường dẫn, không theo thứ tự đăng ký', () => {
    registerTheme(entry(themeAt('purity')));
    registerTheme(entry(path.join(home, 'b', 'dawn')));
    registerTheme(entry(path.join(home, 'a', 'dawn')));

    expect(readRegistry().map((e) => e.path)).toEqual([
      path.join(home, 'a', 'dawn'),
      path.join(home, 'b', 'dawn'),
      themeAt('purity'),
    ]);
  });

  it('ghi đè lên một registry.json hỏng', async () => {
    await writeFile(registryPath(), '{ hong');

    registerTheme(entry(themeAt('dawn')));

    expect(readRegistry()).toHaveLength(1);
  });
});

describe('unregisterTheme', () => {
  it('gỡ đúng theme được chỉ, giữ các theme khác', () => {
    registerTheme(entry(themeAt('dawn')));
    registerTheme(entry(themeAt('purity')));

    expect(unregisterTheme(themeAt('dawn'))).toBe(true);
    expect(readRegistry().map((e) => e.name)).toEqual(['purity']);
  });

  it('trả false và không tạo file nào khi chưa có sổ', async () => {
    expect(unregisterTheme(themeAt('dawn'))).toBe(false);
    // Kể cả file khoá cũng không được tạo.
    expect(await readdir(home)).toEqual([]);
  });

  it('không tạo thư mục home khi nó chưa tồn tại', () => {
    // clean trên một máy chưa từng analyze không được để lại ~/.themegraph rỗng.
    process.env.THEMEGRAPH_HOME = path.join(home, 'chua', 'co');

    expect(unregisterTheme(themeAt('dawn'))).toBe(false);
    expect(existsSync(path.join(home, 'chua'))).toBe(false);
  });

  it('trả false và giữ nguyên sổ khi gỡ một theme khác', () => {
    registerTheme(entry(themeAt('dawn')));

    expect(unregisterTheme(themeAt('purity'))).toBe(false);
    expect(readRegistry()).toHaveLength(1);
  });

  it('để lại sổ rỗng nhưng hợp lệ khi gỡ theme cuối cùng', async () => {
    registerTheme(entry(themeAt('dawn')));
    unregisterTheme(themeAt('dawn'));

    expect(JSON.parse(await readFile(registryPath(), 'utf8'))).toEqual({ version: 1, themes: [] });
  });
});

describe('khoá của sổ đăng ký', () => {
  const lockPath = () => path.join(home, 'registry.lock');

  it('không để lại file khoá sau khi ghi xong', async () => {
    registerTheme(entry(themeAt('dawn')));
    unregisterTheme(themeAt('dawn'));

    expect(await readdir(home)).toEqual(['registry.json']);
  });

  it('gỡ khoá cả khi việc ghi thất bại', async () => {
    // Đặt một THƯ MỤC ở chỗ của registry.json: đổi tên file tạm đè lên nó sẽ lỗi.
    await mkdir(registryPath());

    expect(() => registerTheme(entry(themeAt('dawn')))).toThrow();
    // Không còn khoá, và cũng không còn file tạm.
    expect(await readdir(home)).toEqual(['registry.json']);
  });

  it('bỏ qua khoá cũ do một tiến trình đã chết để lại', async () => {
    await writeFile(lockPath(), '');
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(lockPath(), longAgo, longAgo);

    registerTheme(entry(themeAt('dawn')));

    expect(readRegistry()).toHaveLength(1);
    expect(existsSync(lockPath())).toBe(false);
  });

  it('chờ khi khoá đang được giữ, rồi ghi tiếp khi khoá được nhả', async () => {
    await writeFile(lockPath(), '');
    // Một tiến trình khác nhả khoá sau 300 ms. Phải là tiến trình thật:
    // registerTheme chạy đồng bộ, nên hẹn giờ trong chính tiến trình này sẽ
    // không chạy được trong lúc nó đang chờ.
    const releaser = spawn(process.execPath, [
      '-e',
      `setTimeout(() => require('node:fs').rmSync(${JSON.stringify(lockPath())}, { force: true }), 300)`,
    ]);

    const startedAt = Date.now();
    registerTheme(entry(themeAt('dawn')));
    const waited = Date.now() - startedAt;
    await new Promise((resolve) => releaser.on('exit', resolve));

    expect(waited).toBeGreaterThanOrEqual(200);
    expect(readRegistry()).toHaveLength(1);
  });

  it('nhiều tiến trình cùng đăng ký thì không mục nào bị mất', async () => {
    // Mười tiến trình thật, mỗi tiến trình đăng ký một theme khác nhau, chạy
    // cùng lúc. Không có khoá thì các lượt đọc-sửa-ghi chồng lên nhau và một số
    // mục bị ghi đè mất.
    const registryModule = pathToFileURL(path.join(import.meta.dirname, '../dist/registry.js')).href;
    expect(existsSync(path.join(import.meta.dirname, '../dist/registry.js')), 'chưa có dist: chạy "pnpm build"').toBe(true);

    const script = (name: string) => `
      const { registerTheme } = await import(${JSON.stringify(registryModule)});
      registerTheme({ path: ${JSON.stringify(themeAt('x'))} + ${JSON.stringify(name)}, name: ${JSON.stringify(name)},
        analyzedAt: '2026-10-05T08:00:00.000Z', nodes: 1, edges: 1 });`;

    const exits = Array.from({ length: 10 }, (_, i) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script(`t${i}`)], {
        env: { ...process.env, THEMEGRAPH_HOME: home },
        stdio: 'ignore',
      });
      return new Promise<number | null>((resolve) => child.on('exit', resolve));
    });

    expect(await Promise.all(exits)).toEqual(Array.from({ length: 10 }, () => 0));
    expect(readRegistry().map((e) => e.name).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `t${i}`).sort());
    expect(await readdir(home)).toEqual(['registry.json']);
  });
});

describe('findRegisteredTheme', () => {
  it('tìm theme có trong sổ từ chính thư mục của nó và từ thư mục con', () => {
    registerTheme(entry(themeAt('dawn')));

    expect(findRegisteredTheme(themeAt('dawn'))).toBe(themeAt('dawn'));
    expect(findRegisteredTheme(path.join(themeAt('dawn'), 'sections', 'nested'))).toBe(themeAt('dawn'));
  });

  it('trả null khi không thư mục cha nào có trong sổ', () => {
    registerTheme(entry(themeAt('dawn')));

    expect(findRegisteredTheme(themeAt('purity'))).toBeNull();
    // Thư mục CHA của một theme không phải là theme đó.
    expect(findRegisteredTheme(path.dirname(themeAt('dawn')))).toBeNull();
  });

  it('trả null khi sổ đăng ký trống', () => {
    expect(findRegisteredTheme(themeAt('dawn'))).toBeNull();
  });

  it('không nhầm thư mục có tên bắt đầu giống tên theme', () => {
    registerTheme(entry(themeAt('dawn')));

    expect(findRegisteredTheme(themeAt('dawn-backup'))).toBeNull();
  });
});

describe('listThemes', () => {
  it('đánh dấu theme còn graph.db và theme đã mất', async () => {
    const real = await saveToTempTheme(queryGraph());
    try {
      const gone = themeAt('da-xoa');
      await mkdir(gone, { recursive: true });

      registerTheme(entry(real, { name: 'con' }));
      registerTheme(entry(gone, { name: 'mat' }));

      expect(listThemes().map((t) => [t.name, t.present])).toEqual([
        ['con', true],
        ['mat', false],
      ]);
    } finally {
      await removeTempTheme(real);
    }
  });

  it('giữ đủ các trường của mục trong sổ', () => {
    registerTheme(entry(themeAt('dawn')));

    expect(listThemes()).toEqual([{ ...entry(themeAt('dawn')), present: false }]);
  });
});
