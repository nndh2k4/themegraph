import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildGraph } from '../src/graph.js';
import { readRegistry, registerTheme, unregisterTheme } from '../src/registry.js';
import { selectTheme, ThemeSelectionError } from '../src/select-theme.js';
import { saveGraph } from '../src/store.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-select-'));
  // Sổ đăng ký tạm của file test này dùng chung cho mọi test trong file, nên
  // mỗi test bắt đầu từ một sổ trống.
  for (const entry of readRegistry()) unregisterTheme(entry.path);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Tạo một theme đã phân tích (có graph.db) ở tmp/<dir> và ghi nó vào sổ. */
async function makeTheme(dir: string, options: { register?: boolean } = {}): Promise<string> {
  const themeRoot = path.join(tmp, dir);
  await mkdir(path.join(themeRoot, 'sections'), { recursive: true });
  saveGraph(themeRoot, buildGraph([], [], {}));

  if (options.register ?? true) {
    registerTheme({ path: themeRoot, name: path.basename(themeRoot), analyzedAt: '2026-10-05T00:00:00.000Z', nodes: 0, edges: 0 });
  }
  return themeRoot;
}

/** Gọi selectTheme và trả về lỗi nó ném ra. */
function errorOf(requested: string | undefined, cwd: string): ThemeSelectionError {
  try {
    selectTheme(requested, cwd);
  } catch (error) {
    if (error instanceof ThemeSelectionError) return error;
    throw error;
  }
  throw new Error('selectTheme không ném lỗi');
}

describe('selectTheme — có nêu theme', () => {
  it('nhận tên theme, không phân biệt hoa thường', async () => {
    const dawn = await makeTheme('dawn');
    await makeTheme('purity');

    expect(selectTheme('dawn', tmp)).toBe(dawn);
    expect(selectTheme('  DAWN ', tmp)).toBe(dawn);
    // Đứng ở nơi mà "DAWN" không thể là đường dẫn tới theme: chỉ còn cách
    // hiểu là tên. (Trên Windows, đường dẫn vốn không phân biệt hoa thường,
    // nên hai dòng trên chưa đủ để kiểm phép so tên.)
    expect(selectTheme('DAWN', path.join(tmp, 'purity'))).toBe(dawn);
  });

  it('nhận đường dẫn tuyệt đối và đường dẫn tương đối so với cwd', async () => {
    await makeTheme('dawn');
    const purity = await makeTheme('purity');

    expect(selectTheme(purity, os.tmpdir())).toBe(purity);
    expect(selectTheme('purity', tmp)).toBe(purity);
    expect(selectTheme('../purity', path.join(tmp, 'dawn'))).toBe(purity);
  });

  it('đường dẫn trong sổ thắng tên: thư mục con trùng tên với một theme khác', async () => {
    // tmp/a/dawn và tmp/dawn đều là theme tên "dawn". Đứng ở tmp/a mà nói
    // "dawn" thì đó là đường dẫn tương đối tới tmp/a/dawn.
    const inner = await makeTheme(path.join('a', 'dawn'));
    await makeTheme('dawn');

    expect(selectTheme('dawn', path.join(tmp, 'a'))).toBe(inner);
  });

  it('báo mơ hồ khi hai theme trùng tên và tên không chỉ ra được đường dẫn nào', async () => {
    const first = await makeTheme(path.join('a', 'dawn'));
    const second = await makeTheme(path.join('b', 'dawn'));

    const error = errorOf('dawn', tmp);

    expect(error.reason).toBe('ambiguous');
    expect(error.message).toContain('Có 2 theme cùng tên "dawn"');
    expect(error.message).toContain(first);
    expect(error.message).toContain(second);
    expect(error.message).toContain('đường dẫn');
  });

  it('nhận thư mục có graph.db dù không có trong sổ đăng ký', async () => {
    const loose = await makeTheme('loose', { register: false });

    expect(selectTheme(loose, os.tmpdir())).toBe(loose);
  });

  it('báo không có theme và liệt kê các theme đang có', async () => {
    const dawn = await makeTheme('dawn');

    const error = errorOf('khong-co', tmp);

    expect(error.reason).toBe('unknown');
    expect(error.message).toContain('Không có theme "khong-co"');
    expect(error.message).toContain(`dawn (${dawn})`);
    expect(error.themes.map((theme) => theme.name)).toEqual(['dawn']);
  });

  it('báo không có theme và chỉ cách analyze khi sổ trống', () => {
    const error = errorOf('dawn', tmp);

    expect(error.reason).toBe('unknown');
    expect(error.message).toContain('themegraph analyze');
    expect(error.themes).toEqual([]);
  });

  it('không lấy theme chứa cwd khi tên được nêu không khớp gì', async () => {
    const dawn = await makeTheme('dawn');

    expect(errorOf('purity', dawn).reason).toBe('unknown');
  });
});

describe('selectTheme — không nêu theme', () => {
  it('lấy theme chứa thư mục đang đứng, kể cả khi đứng trong thư mục con', async () => {
    const dawn = await makeTheme('dawn');
    await makeTheme('purity');

    expect(selectTheme(undefined, dawn)).toBe(dawn);
    expect(selectTheme(undefined, path.join(dawn, 'sections'))).toBe(dawn);
    // Chuỗi rỗng hay toàn dấu cách cũng là "không nêu".
    expect(selectTheme('', dawn)).toBe(dawn);
    expect(selectTheme('  ', dawn)).toBe(dawn);
    // Kể cả khi đứng trong thư mục con, nơi chuỗi rỗng không thể bị hiểu
    // nhầm thành "đường dẫn tới chính thư mục này".
    expect(selectTheme('', path.join(dawn, 'sections'))).toBe(dawn);
  });

  it('theme chứa cwd thắng "chỉ có một theme trong sổ"', async () => {
    await makeTheme('dawn');
    const loose = await makeTheme('loose', { register: false });

    expect(selectTheme(undefined, loose)).toBe(loose);
  });

  it('lấy theme chứa cwd theo sổ đăng ký khi graph.db của nó đã mất', async () => {
    const dawn = await makeTheme('dawn');
    await makeTheme('purity');
    await rm(path.join(dawn, '.themegraph'), { recursive: true });

    expect(selectTheme(undefined, path.join(dawn, 'sections'))).toBe(dawn);
  });

  it('đứng ngoài mọi theme mà sổ chỉ có một theme thì lấy theme đó', async () => {
    const dawn = await makeTheme('dawn');

    expect(selectTheme(undefined, tmp)).toBe(dawn);
  });

  it('đứng ngoài mọi theme mà sổ có nhiều theme thì báo mơ hồ và liệt kê', async () => {
    const dawn = await makeTheme('dawn');
    const purity = await makeTheme('purity');

    const error = errorOf(undefined, tmp);

    expect(error.reason).toBe('ambiguous');
    expect(error.message).toContain('có 2 theme đã phân tích');
    expect(error.message).toContain(`dawn (${dawn})`);
    expect(error.message).toContain(`purity (${purity})`);
    expect(error.themes).toHaveLength(2);
  });

  it('báo chưa có theme nào khi sổ trống', () => {
    const error = errorOf(undefined, tmp);

    expect(error.reason).toBe('none_registered');
    expect(error.message).toContain('themegraph analyze');
  });
});
