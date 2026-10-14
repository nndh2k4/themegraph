import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultRegistryDir } from '../src/infrastructure/registry/json-theme-registry.repository.js';
import type { RegistryEntry } from '../src/models/index.js';
import { core, queryGraph, registry, removeTempTheme, saveToTempTheme } from './helpers.js';

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
    expect(defaultRegistryDir()).toBe(home);
    expect(registry().location).toBe(path.join(home, 'registry.json'));
  });

  it('mặc định là .themegraph trong thư mục home khi biến không được đặt hoặc rỗng', () => {
    const expected = path.join(os.homedir(), '.themegraph');

    delete process.env.THEMEGRAPH_HOME;
    expect(defaultRegistryDir()).toBe(expected);

    process.env.THEMEGRAPH_HOME = '';
    expect(defaultRegistryDir()).toBe(expected);
  });

  it('đổi THEMEGRAPH_HOME tương đối thành đường dẫn tuyệt đối', () => {
    process.env.THEMEGRAPH_HOME = 'mot-thu-muc';

    expect(path.isAbsolute(defaultRegistryDir())).toBe(true);
  });
});

describe('readRegistry', () => {
  it('trả danh sách rỗng khi chưa có file, và không tạo ra file', () => {
    expect(registry().list()).toEqual([]);
    expect(existsSync(registry().location)).toBe(false);
  });

  it('trả danh sách rỗng khi file không phải JSON', async () => {
    await writeFile(registry().location, '{ hong');

    expect(registry().list()).toEqual([]);
  });

  it('trả danh sách rỗng khi file là JSON nhưng sai cấu trúc', async () => {
    for (const content of ['null', '[]', '"x"', '{}', '{ "version": 1 }', '{ "version": 1, "themes": {} }']) {
      await writeFile(registry().location, content);
      expect(registry().list()).toEqual([]);
    }
  });

  it('trả danh sách rỗng khi file thuộc phiên bản định dạng khác', async () => {
    await writeFile(registry().location, JSON.stringify({ version: 2, themes: [entry(themeAt('dawn'))] }));

    expect(registry().list()).toEqual([]);
  });

  it('bỏ riêng mục sai hình dạng, giữ các mục còn lại', async () => {
    const good = entry(themeAt('dawn'));
    const themes = [good, null, 'x', { path: 5 }, { ...good, nodes: '10' }, { ...good, name: undefined }];
    await writeFile(registry().location, JSON.stringify({ version: 1, themes }));

    expect(registry().list()).toEqual([good]);
  });
});

describe('registerTheme', () => {
  it('tạo thư mục và file khi chưa có', () => {
    process.env.THEMEGRAPH_HOME = path.join(home, 'chua', 'co');

    registry().register(entry(themeAt('dawn')));

    expect(registry().list()).toEqual([entry(themeAt('dawn'))]);
  });

  it('ghi file JSON đọc được, có số phiên bản, không để sót file tạm', async () => {
    registry().register(entry(themeAt('dawn')));

    const data = JSON.parse(await readFile(registry().location, 'utf8')) as { version: number; themes: unknown[] };

    expect(data.version).toBe(1);
    expect(data.themes).toEqual([entry(themeAt('dawn'))]);
    expect(await readdir(home)).toEqual(['registry.json']);
  });

  it('giữ các theme khác khi thêm một theme mới', () => {
    registry().register(entry(themeAt('dawn')));
    registry().register(entry(themeAt('purity')));

    expect(registry().list().map((e) => e.name)).toEqual(['dawn', 'purity']);
  });

  it('thay mục cũ khi phân tích lại cùng một theme, không thêm mục trùng', () => {
    registry().register(entry(themeAt('dawn'), { nodes: 1 }));
    registry().register(entry(themeAt('purity')));
    registry().register(entry(themeAt('dawn'), { nodes: 99, analyzedAt: '2026-10-06T00:00:00.000Z' }));

    expect(registry().list()).toEqual([
      entry(themeAt('dawn'), { nodes: 99, analyzedAt: '2026-10-06T00:00:00.000Z' }),
      entry(themeAt('purity')),
    ]);
  });

  it('coi hai cách viết của cùng một đường dẫn là một theme', () => {
    registry().register(entry(themeAt('dawn')));
    // Cùng thư mục, viết vòng qua một thư mục con rồi quay ra.
    registry().register(entry(path.join(themeAt('dawn'), 'sections', '..'), { nodes: 2 }));

    expect(registry().list()).toHaveLength(1);
    expect(registry().list()[0]?.nodes).toBe(2);
  });

  it.runIf(process.platform === 'win32')('trên Windows không phân biệt hoa thường trong đường dẫn', () => {
    registry().register(entry(themeAt('dawn')));
    registry().register(entry(themeAt('dawn').toUpperCase(), { nodes: 2 }));

    expect(registry().list()).toHaveLength(1);
  });

  it.runIf(process.platform !== 'win32')('trên hệ khác thì phân biệt hoa thường trong đường dẫn', () => {
    registry().register(entry(themeAt('dawn')));
    registry().register(entry(themeAt('DAWN')));

    expect(registry().list()).toHaveLength(2);
  });

  it('xếp theo tên rồi theo đường dẫn, không theo thứ tự đăng ký', () => {
    registry().register(entry(themeAt('purity')));
    registry().register(entry(path.join(home, 'b', 'dawn')));
    registry().register(entry(path.join(home, 'a', 'dawn')));

    expect(registry().list().map((e) => e.path)).toEqual([
      path.join(home, 'a', 'dawn'),
      path.join(home, 'b', 'dawn'),
      themeAt('purity'),
    ]);
  });

  it('ghi đè lên một registry.json hỏng', async () => {
    await writeFile(registry().location, '{ hong');

    registry().register(entry(themeAt('dawn')));

    expect(registry().list()).toHaveLength(1);
  });
});

describe('unregisterTheme', () => {
  it('gỡ đúng theme được chỉ, giữ các theme khác', () => {
    registry().register(entry(themeAt('dawn')));
    registry().register(entry(themeAt('purity')));

    expect(registry().unregister(themeAt('dawn'))).toBe(true);
    expect(registry().list().map((e) => e.name)).toEqual(['purity']);
  });

  it('trả false và không tạo file nào khi chưa có sổ', async () => {
    expect(registry().unregister(themeAt('dawn'))).toBe(false);
    // Kể cả file khoá cũng không được tạo.
    expect(await readdir(home)).toEqual([]);
  });

  it('không tạo thư mục home khi nó chưa tồn tại', () => {
    // clean trên một máy chưa từng analyze không được để lại ~/.themegraph rỗng.
    process.env.THEMEGRAPH_HOME = path.join(home, 'chua', 'co');

    expect(registry().unregister(themeAt('dawn'))).toBe(false);
    expect(existsSync(path.join(home, 'chua'))).toBe(false);
  });

  it('trả false và giữ nguyên sổ khi gỡ một theme khác', () => {
    registry().register(entry(themeAt('dawn')));

    expect(registry().unregister(themeAt('purity'))).toBe(false);
    expect(registry().list()).toHaveLength(1);
  });

  it('để lại sổ rỗng nhưng hợp lệ khi gỡ theme cuối cùng', async () => {
    registry().register(entry(themeAt('dawn')));
    registry().unregister(themeAt('dawn'));

    expect(JSON.parse(await readFile(registry().location, 'utf8'))).toEqual({ version: 1, themes: [] });
  });
});

describe('khoá của sổ đăng ký', () => {
  const lockPath = () => path.join(home, 'registry.lock');

  it('không để lại file khoá sau khi ghi xong', async () => {
    registry().register(entry(themeAt('dawn')));
    registry().unregister(themeAt('dawn'));

    expect(await readdir(home)).toEqual(['registry.json']);
  });

  it('gỡ khoá cả khi việc ghi thất bại', async () => {
    // Đặt một THƯ MỤC ở chỗ của registry.json: đổi tên file tạm đè lên nó sẽ lỗi.
    await mkdir(registry().location);

    expect(() => registry().register(entry(themeAt('dawn')))).toThrow();
    // Không còn khoá, và cũng không còn file tạm.
    expect(await readdir(home)).toEqual(['registry.json']);
  });

  it('bỏ qua khoá cũ do một tiến trình đã chết để lại', async () => {
    await writeFile(lockPath(), '');
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(lockPath(), longAgo, longAgo);

    registry().register(entry(themeAt('dawn')));

    expect(registry().list()).toHaveLength(1);
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
    registry().register(entry(themeAt('dawn')));
    const waited = Date.now() - startedAt;
    await new Promise((resolve) => releaser.on('exit', resolve));

    expect(waited).toBeGreaterThanOrEqual(200);
    expect(registry().list()).toHaveLength(1);
  });

  it('nhiều tiến trình cùng đăng ký thì không mục nào bị mất', async () => {
    // Mười tiến trình thật, mỗi tiến trình đăng ký một theme khác nhau, chạy
    // cùng lúc. Không có khoá thì các lượt đọc-sửa-ghi chồng lên nhau và một số
    // mục bị ghi đè mất.
    const built = path.join(import.meta.dirname, '../dist/infrastructure/registry/json-theme-registry.repository.js');
    expect(existsSync(built), 'chưa có dist: chạy "pnpm build"').toBe(true);
    const registryModule = pathToFileURL(built).href;

    const script = (name: string) => `
      const { defaultRegistryDir, JsonThemeRegistryRepository } = await import(${JSON.stringify(registryModule)});
      new JsonThemeRegistryRepository(defaultRegistryDir()).register({
        path: ${JSON.stringify(themeAt('x'))} + ${JSON.stringify(name)}, name: ${JSON.stringify(name)},
        analyzedAt: '2026-10-05T08:00:00.000Z', nodes: 1, edges: 1 });`;

    const exits = Array.from({ length: 10 }, (_, i) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script(`t${i}`)], {
        env: { ...process.env, THEMEGRAPH_HOME: home },
        stdio: 'ignore',
      });
      return new Promise<number | null>((resolve) => child.on('exit', resolve));
    });

    expect(await Promise.all(exits)).toEqual(Array.from({ length: 10 }, () => 0));
    expect(registry().list().map((e) => e.name).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `t${i}`).sort());
    expect(await readdir(home)).toEqual(['registry.json']);
  });
});

describe('findRegisteredTheme', () => {
  it('tìm theme có trong sổ từ chính thư mục của nó và từ thư mục con', () => {
    registry().register(entry(themeAt('dawn')));

    expect(core().themes.findRegistered(themeAt('dawn'))).toBe(themeAt('dawn'));
    expect(core().themes.findRegistered(path.join(themeAt('dawn'), 'sections', 'nested'))).toBe(themeAt('dawn'));
  });

  it('trả null khi không thư mục cha nào có trong sổ', () => {
    registry().register(entry(themeAt('dawn')));

    expect(core().themes.findRegistered(themeAt('purity'))).toBeNull();
    // Thư mục CHA của một theme không phải là theme đó.
    expect(core().themes.findRegistered(path.dirname(themeAt('dawn')))).toBeNull();
  });

  it('trả null khi sổ đăng ký trống', () => {
    expect(core().themes.findRegistered(themeAt('dawn'))).toBeNull();
  });

  it('không nhầm thư mục có tên bắt đầu giống tên theme', () => {
    registry().register(entry(themeAt('dawn')));

    expect(core().themes.findRegistered(themeAt('dawn-backup'))).toBeNull();
  });
});

describe('listThemes', () => {
  it('đánh dấu theme còn graph.db và theme đã mất', async () => {
    const real = await saveToTempTheme(queryGraph());
    try {
      const gone = themeAt('da-xoa');
      await mkdir(gone, { recursive: true });

      registry().register(entry(real, { name: 'con' }));
      registry().register(entry(gone, { name: 'mat' }));

      expect(core().themes.list().map((t) => [t.name, t.present])).toEqual([
        ['con', true],
        ['mat', false],
      ]);
    } finally {
      await removeTempTheme(real);
    }
  });

  it('giữ đủ các trường của mục trong sổ', () => {
    registry().register(entry(themeAt('dawn')));

    expect(core().themes.list()).toEqual([{ ...entry(themeAt('dawn')), present: false }]);
  });
});
