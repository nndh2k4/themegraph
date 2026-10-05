import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../src/run.js';

const FIXTURE = path.join(import.meta.dirname, '../../core/tests/fixtures/mini-theme');
const BUILT_BIN = path.join(import.meta.dirname, '../dist/cli.js');

let tmp: string;
let themeRoot: string;

beforeEach(async () => {
  // Như test của core: theme được chép ra thư mục tạm NGOÀI repo.
  tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-cli-'));
  themeRoot = path.join(tmp, 'mini-theme');
  await cp(FIXTURE, themeRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Chạy lệnh trong tiến trình test và gom lại những gì nó in ra. */
async function runCli(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

describe('themegraph analyze', () => {
  it('phân tích theme theo đường dẫn được đưa vào và in thống kê', async () => {
    const result = await runCli(['analyze', themeRoot]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(themeRoot);
    expect(result.stdout).toMatch(/File\s+13\b/);
    expect(result.stdout).toMatch(/Node\s+17\b/);
    expect(result.stdout).toMatch(/Cạnh\s+17\b/);
    expect(result.stdout).toContain('RENDERS 9');
    expect(result.stdout).toContain('page_type 4');
    expect(result.stdout).toContain(path.join(themeRoot, '.themegraph', 'graph.db'));
    expect(existsSync(path.join(themeRoot, '.themegraph', 'graph.db'))).toBe(true);
  });

  it('không có đường dẫn thì phân tích thư mục đang đứng', async () => {
    const originalCwd = process.cwd();

    try {
      process.chdir(themeRoot);
      const result = await runCli(['analyze']);

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/Node\s+17\b/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('liệt kê tham chiếu hỏng theo dạng file:dòng', async () => {
    const result = await runCli(['analyze', themeRoot]);

    expect(result.stdout).toContain('Tham chiếu hỏng (2)');
    expect(result.stdout).toContain('snippets/card.liquid:4');
    expect(result.stdout).toContain('assets/icon-star');
    // Ref lấy từ JSON không có số dòng: chỉ in tên file.
    expect(result.stdout).toMatch(/templates\/customers\/login\.json\s/);
    expect(result.stdout).toContain('sections/missing-section.liquid');
  });

  it('liệt kê file không phân tích được nhưng vẫn kết thúc thành công', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'broken.liquid'), "{% render 'card'");

    const result = await runCli(['analyze', themeRoot]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('File lỗi (1)');
    expect(result.stdout).toContain('snippets/broken.liquid');
  });

  it('không in mục tham chiếu hỏng hay file lỗi khi không có gì để báo', async () => {
    // Bỏ hai tham chiếu hỏng cố ý của fixture.
    await writeFile(path.join(themeRoot, 'snippets', 'card.liquid'), '<div class="card"></div>');
    await writeFile(path.join(themeRoot, 'templates', 'customers', 'login.json'), '{ "sections": {} }');

    const result = await runCli(['analyze', themeRoot]);

    expect(result.stdout).not.toContain('Tham chiếu hỏng');
    expect(result.stdout).not.toContain('File lỗi');
  });

  it('báo lỗi ra stderr và trả mã 1 khi thư mục không phải theme', async () => {
    const result = await runCli(['analyze', tmp]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('thiếu layout');
  });

  it('từ chối tham số thừa', async () => {
    const result = await runCli(['analyze', themeRoot, 'thua']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('analyze');
  });
});

describe('themegraph — lệnh chung', () => {
  it('in phiên bản với --version', async () => {
    const result = await runCli(['--version']);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('in hướng dẫn với --help và khi không có tham số', async () => {
    const help = await runCli(['--help']);
    const bare = await runCli([]);

    expect(help.code).toBe(0);
    expect(help.stdout).toContain('themegraph analyze');
    expect(bare).toEqual(help);
  });

  it('báo lỗi và trả mã 2 với lệnh không tồn tại', async () => {
    const result = await runCli(['khong-co-lenh-nay']);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('khong-co-lenh-nay');
    expect(result.stderr).toContain('themegraph --help');
  });
});

describe('themegraph — lệnh đã build', () => {
  // Các test ở trên gọi thẳng hàm run() với mã nguồn. Test này chạy đúng file
  // mà người dùng sẽ chạy sau khi cài: dist/cli.js, qua một tiến trình node
  // riêng, đứng ở một thư mục không liên quan gì tới repo.
  it('chạy được từ một thư mục khác, với theme nằm ngoài repo', () => {
    expect(existsSync(BUILT_BIN), 'chưa có dist/cli.js: chạy "pnpm build" trước').toBe(true);

    const stdout = execFileSync(process.execPath, [BUILT_BIN, 'analyze', themeRoot], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
    });

    expect(stdout).toMatch(/Node\s+17\b/);
    expect(existsSync(path.join(themeRoot, '.themegraph', 'graph.db'))).toBe(true);
  });

  it('trả mã thoát khác 0 khi thư mục không phải theme', () => {
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [BUILT_BIN, 'analyze', tmp], { cwd: os.tmpdir(), stdio: 'pipe' });
    } catch (error) {
      exitCode = (error as { status: number }).status;
    }

    expect(exitCode).toBe(1);
  });
});
