import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveWebRoot } from '../src/web-root.js';

describe('resolveWebRoot', () => {
  const has = (...present: string[]) => (dir: string) => present.includes(dir);

  it('lấy thư mục đầu tiên có index.html, theo thứ tự ưu tiên', () => {
    expect(resolveWebRoot(['goi/web', 'repo/web/dist'], has('goi/web', 'repo/web/dist'))).toBe('goi/web');
    expect(resolveWebRoot(['goi/web', 'repo/web/dist'], has('repo/web/dist'))).toBe('repo/web/dist');
    expect(resolveWebRoot(['a', 'b', 'c'], has('b', 'c'))).toBe('b');
  });

  it('không nơi nào có thì trả thư mục cuối cùng, để server hiện trang hướng dẫn build', () => {
    expect(resolveWebRoot(['goi/web', 'repo/web/dist'], has())).toBe('repo/web/dist');
    expect(resolveWebRoot(['chi-mot-noi'], has())).toBe('chi-mot-noi');
  });

  it('danh sách rỗng là lỗi của nơi gọi', () => {
    expect(() => resolveWebRoot([], has())).toThrow('ít nhất một thư mục');
  });
});

describe('resolveWebRoot — đọc đĩa thật', () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp !== undefined) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('một thư mục chỉ được chọn khi có file index.html bên trong', async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-webroot-'));
    const packed = path.join(tmp, 'goi', 'web');
    const source = path.join(tmp, 'repo', 'web', 'dist');
    await mkdir(packed, { recursive: true });
    await mkdir(source, { recursive: true });

    // Cả hai thư mục đều có nhưng trống: chưa nơi nào là bản build.
    expect(resolveWebRoot([packed, source])).toBe(source);

    await writeFile(path.join(source, 'index.html'), '<!doctype html>');
    expect(resolveWebRoot([packed, source])).toBe(source);

    await writeFile(path.join(packed, 'index.html'), '<!doctype html>');
    expect(resolveWebRoot([packed, source])).toBe(packed);
  });
});
