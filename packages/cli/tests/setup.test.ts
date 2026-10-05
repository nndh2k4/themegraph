import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatSetup, manualClaudeCommand, setup } from '../src/setup.js';
import type { ClaudeRun, SetupOptions, SetupStep } from '../src/setup.js';

const SKILL_SOURCE = path.join(import.meta.dirname, '../skills/themegraph/SKILL.md');

let home: string;

beforeEach(async () => {
  // Thư mục home GIẢ: mọi test trong file này chỉ ghi vào đây.
  home = await mkdtemp(path.join(os.tmpdir(), 'themegraph-setup-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/**
 * Lệnh `claude` giả: giữ danh sách MCP server trong bộ nhớ và trả lời như
 * lệnh thật ở các điểm setup dựa vào (đã kiểm với Claude Code 2.1.289):
 *   - `mcp get` thoát mã 1 khi chưa có server, mã 0 kèm Command/Args khi có
 *   - `mcp add` thoát mã 1 khi server đã tồn tại
 */
function fakeClaude(initial: Record<string, string[]> = {}) {
  const servers = new Map(Object.entries(initial));
  const calls: string[][] = [];

  const run = (args: string[]): ClaudeRun => {
    calls.push(args);
    const [first, second, name] = args;

    if (first === '--version') return { ok: true, output: '2.1.289 (Claude Code)' };
    if (first !== 'mcp' || name === undefined) return { ok: false, output: 'unknown' };

    if (second === 'get') {
      const found = servers.get(name);
      return found === undefined
        ? { ok: false, output: `No MCP server named "${name}".` }
        : { ok: true, output: `${name}:\n  Command: ${found[0]}\n  Args: ${found.slice(1).join(' ')}` };
    }
    if (second === 'remove') {
      return servers.delete(name) ? { ok: true, output: 'Removed' } : { ok: false, output: 'No MCP server' };
    }
    if (second === 'add') {
      // args: mcp add --scope user <name> -- <command> <args...>
      const serverName = args[4];
      if (serverName === undefined || args[2] !== '--scope' || args[3] !== 'user' || args[5] !== '--') {
        return { ok: false, output: 'bad usage' };
      }
      if (servers.has(serverName)) return { ok: false, output: `MCP server ${serverName} already exists` };
      servers.set(serverName, args.slice(6));
      return { ok: true, output: 'Added' };
    }
    return { ok: false, output: 'unknown' };
  };

  return { run, servers, calls };
}

function optionsWith(overrides: Partial<SetupOptions> = {}): SetupOptions {
  return {
    homeDir: home,
    nodePath: path.join(home, 'bin', 'node.exe'),
    cliPath: path.join(home, 'lib', 'dist', 'cli.js'),
    skillSource: SKILL_SOURCE,
    dryRun: false,
    remove: false,
    runClaude: () => null,
    ...overrides,
  };
}

const stepOf = (steps: SetupStep[], target: string): SetupStep => {
  const found = steps.find((step) => step.target === target);
  if (found === undefined) throw new Error(`không có bước ${target}`);
  return found;
};

const cursorConfig = () => path.join(home, '.cursor', 'mcp.json');
const skillFile = () => path.join(home, '.claude', 'skills', 'themegraph', 'SKILL.md');
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

describe('setup — máy không có client nào', () => {
  it('bỏ qua cả ba bước và không tạo ra gì trong thư mục home', async () => {
    const steps = setup(optionsWith());

    expect(steps.map((step) => [step.target, step.outcome])).toEqual([
      ['Claude Code', 'skipped'],
      ['Skill cho Claude Code', 'skipped'],
      ['Cursor', 'skipped'],
    ]);
    expect(existsSync(path.join(home, '.claude'))).toBe(false);
    expect(existsSync(path.join(home, '.cursor'))).toBe(false);
  });

  it('coi như không có Claude Code khi lệnh claude chạy lỗi', () => {
    const steps = setup(optionsWith({ runClaude: () => ({ ok: false, output: 'hỏng' }) }));

    expect(stepOf(steps, 'Claude Code').outcome).toBe('skipped');
  });
});

describe('setup — Claude Code', () => {
  it('đăng ký MCP server ở mức người dùng, trỏ tới node và cli.js bằng đường dẫn tuyệt đối', () => {
    const claude = fakeClaude();
    const options = optionsWith({ runClaude: claude.run });

    const step = stepOf(setup(options), 'Claude Code');

    expect(step.outcome).toBe('done');
    expect(claude.servers.get('themegraph')).toEqual([options.nodePath, options.cliPath, 'mcp']);
    expect(claude.calls).toContainEqual([
      'mcp',
      'add',
      '--scope',
      'user',
      'themegraph',
      '--',
      options.nodePath,
      options.cliPath,
      'mcp',
    ]);
  });

  it('chạy lần hai không đăng ký lại', () => {
    const claude = fakeClaude();
    const options = optionsWith({ runClaude: claude.run });

    setup(options);
    claude.calls.length = 0;
    const step = stepOf(setup(options), 'Claude Code');

    expect(step.outcome).toBe('unchanged');
    expect(claude.calls.some((call) => call[1] === 'add' || call[1] === 'remove')).toBe(false);
  });

  it('server đã có nhưng trỏ tới bản cài khác: gỡ rồi đăng ký lại', () => {
    const claude = fakeClaude({ themegraph: ['node', '/cu/cli.js', 'mcp'] });
    const options = optionsWith({ runClaude: claude.run });

    const step = stepOf(setup(options), 'Claude Code');

    expect(step.outcome).toBe('done');
    expect(claude.servers.get('themegraph')).toEqual([options.nodePath, options.cliPath, 'mcp']);
  });

  it('cùng node nhưng khác cli.js: cũng đăng ký lại', () => {
    const options = optionsWith();
    const claude = fakeClaude({ themegraph: [options.nodePath, '/ban/cu/cli.js', 'mcp'] });

    const step = stepOf(setup({ ...options, runClaude: claude.run }), 'Claude Code');

    expect(step.outcome).toBe('done');
    expect(claude.servers.get('themegraph')?.[1]).toBe(options.cliPath);
  });

  it('cùng cli.js nhưng khác node: cũng đăng ký lại', () => {
    const options = optionsWith();
    const claude = fakeClaude({ themegraph: ['/node/cu', options.cliPath, 'mcp'] });

    const step = stepOf(setup({ ...options, runClaude: claude.run }), 'Claude Code');

    expect(step.outcome).toBe('done');
    expect(claude.servers.get('themegraph')?.[0]).toBe(options.nodePath);
  });

  it('không đụng tới MCP server khác', () => {
    const claude = fakeClaude({ gitnexus: ['gitnexus', 'mcp'] });

    setup(optionsWith({ runClaude: claude.run }));

    expect(claude.servers.get('gitnexus')).toEqual(['gitnexus', 'mcp']);
  });

  it('báo lỗi kèm lệnh tự chạy khi claude mcp add thất bại', () => {
    const claude = fakeClaude();
    const options = optionsWith({
      runClaude: (args) => (args[1] === 'add' ? { ok: false, output: 'không có quyền ghi\n' } : claude.run(args)),
    });

    const step = stepOf(setup(options), 'Claude Code');

    expect(step.outcome).toBe('failed');
    expect(step.detail).toContain('không có quyền ghi');
    expect(step.detail).toContain(manualClaudeCommand(options));
  });

  it('lệnh tự chạy đặt đường dẫn trong dấu nháy, vì đường dẫn thường có dấu cách', () => {
    const options = optionsWith({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', cliPath: 'D:\\New folder (2)\\cli.js' });

    expect(manualClaudeCommand(options)).toBe(
      'claude mcp add --scope user themegraph -- "C:\\Program Files\\nodejs\\node.exe" "D:\\New folder (2)\\cli.js" mcp',
    );
  });
});

describe('setup — skill cho Claude Code', () => {
  beforeEach(async () => {
    await mkdir(path.join(home, '.claude'));
  });

  it('chép SKILL.md vào ~/.claude/skills/themegraph/', async () => {
    const step = stepOf(setup(optionsWith()), 'Skill cho Claude Code');

    expect(step.outcome).toBe('done');
    expect(step.detail).toContain(skillFile());
    expect(await readFile(skillFile(), 'utf8')).toBe(await readFile(SKILL_SOURCE, 'utf8'));
  });

  it('cài skill dù không gọi được lệnh claude, miễn có thư mục ~/.claude', () => {
    const steps = setup(optionsWith());

    expect(stepOf(steps, 'Claude Code').outcome).toBe('skipped');
    expect(stepOf(steps, 'Skill cho Claude Code').outcome).toBe('done');
  });

  it('chạy lần hai giữ nguyên; skill cũ thì được ghi đè bằng bản mới', async () => {
    setup(optionsWith());
    expect(stepOf(setup(optionsWith()), 'Skill cho Claude Code').outcome).toBe('unchanged');

    await writeFile(skillFile(), 'bản cũ');
    expect(stepOf(setup(optionsWith()), 'Skill cho Claude Code').outcome).toBe('done');
    expect(await readFile(skillFile(), 'utf8')).toBe(await readFile(SKILL_SOURCE, 'utf8'));
  });

  it('file skill đi kèm gói có frontmatter với name và description', async () => {
    const content = await readFile(SKILL_SOURCE, 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(content.replaceAll('\r\n', '\n'))?.[1] ?? '';

    expect(frontmatter).toMatch(/^name: themegraph$/m);
    expect(frontmatter).toMatch(/^description: .*Shopify theme/m);
    // Skill phải nhắc đủ sáu tool mà server khai.
    for (const tool of ['impact', 'render_flow', 'context', 'search', 'dead_code', 'list_themes']) {
      expect(content, tool).toContain(`\`${tool}\``);
    }
  });
});

describe('setup — Cursor', () => {
  beforeEach(async () => {
    await mkdir(path.join(home, '.cursor'));
  });

  it('tạo mcp.json khi chưa có', async () => {
    const options = optionsWith();
    const step = stepOf(setup(options), 'Cursor');

    expect(step.outcome).toBe('done');
    expect(await readJson(cursorConfig())).toEqual({
      mcpServers: { themegraph: { command: options.nodePath, args: [options.cliPath, 'mcp'] } },
    });
  });

  it('thêm mục themegraph mà giữ nguyên các server và các khoá khác', async () => {
    await writeFile(
      cursorConfig(),
      JSON.stringify({ mcpServers: { figma: { url: 'https://x' }, other: { command: 'o' } }, theme: 'dark' }),
    );

    setup(optionsWith());
    const config = await readJson(cursorConfig());

    expect(config.theme).toBe('dark');
    expect(Object.keys(config.mcpServers as object)).toEqual(['figma', 'other', 'themegraph']);
    expect((config.mcpServers as Record<string, unknown>).figma).toEqual({ url: 'https://x' });
  });

  it('nhận file chưa có khoá mcpServers', async () => {
    await writeFile(cursorConfig(), '{}');

    expect(stepOf(setup(optionsWith()), 'Cursor').outcome).toBe('done');
    expect(Object.keys((await readJson(cursorConfig())).mcpServers as object)).toEqual(['themegraph']);
  });

  it('chạy lần hai giữ nguyên, không ghi lại file', async () => {
    setup(optionsWith());
    const before = await readFile(cursorConfig(), 'utf8');
    // Đổi cách trình bày của file: nếu setup ghi lại thì nó sẽ mất.
    await writeFile(cursorConfig(), JSON.stringify(JSON.parse(before)));

    const step = stepOf(setup(optionsWith()), 'Cursor');

    expect(step.outcome).toBe('unchanged');
    expect(await readFile(cursorConfig(), 'utf8')).toBe(JSON.stringify(JSON.parse(before)));
  });

  it('sửa mục themegraph khi nó trỏ tới bản cài khác', async () => {
    await writeFile(cursorConfig(), JSON.stringify({ mcpServers: { themegraph: { command: 'node', args: ['/cu', 'mcp'] } } }));
    const options = optionsWith();

    expect(stepOf(setup(options), 'Cursor').outcome).toBe('done');
    expect(((await readJson(cursorConfig())).mcpServers as Record<string, unknown>).themegraph).toEqual({
      command: options.nodePath,
      args: [options.cliPath, 'mcp'],
    });
  });

  it('không ghi đè file không phải JSON hợp lệ', async () => {
    await writeFile(cursorConfig(), '{ "mcpServers": { ');

    const step = stepOf(setup(optionsWith()), 'Cursor');

    expect(step.outcome).toBe('failed');
    expect(step.detail).toContain('không phải JSON hợp lệ');
    expect(await readFile(cursorConfig(), 'utf8')).toBe('{ "mcpServers": { ');
  });

  it('không ghi đè file JSON có dạng lạ', async () => {
    for (const content of ['[]', '"x"', '{"mcpServers": []}', '{"mcpServers": "x"}']) {
      await writeFile(cursorConfig(), content);

      const step = stepOf(setup(optionsWith()), 'Cursor');

      expect(step.outcome, content).toBe('failed');
      expect(await readFile(cursorConfig(), 'utf8')).toBe(content);
    }
  });
});

describe('setup --dry-run', () => {
  it('báo việc sẽ làm mà không ghi gì và không đăng ký gì', async () => {
    await mkdir(path.join(home, '.claude'));
    await mkdir(path.join(home, '.cursor'));
    const claude = fakeClaude();
    const options = optionsWith({ runClaude: claude.run, dryRun: true });

    const steps = setup(options);

    expect(steps.map((step) => step.outcome)).toEqual(['planned', 'planned', 'planned']);
    expect(stepOf(steps, 'Claude Code').detail).toContain(manualClaudeCommand(options));
    expect(claude.servers.size).toBe(0);
    expect(existsSync(skillFile())).toBe(false);
    expect(existsSync(cursorConfig())).toBe(false);
  });

  it('báo giữ nguyên với những gì đã đúng sẵn', async () => {
    await mkdir(path.join(home, '.claude'));
    await mkdir(path.join(home, '.cursor'));
    const claude = fakeClaude();
    setup(optionsWith({ runClaude: claude.run }));

    const steps = setup(optionsWith({ runClaude: claude.run, dryRun: true }));

    expect(steps.map((step) => step.outcome)).toEqual(['unchanged', 'unchanged', 'unchanged']);
  });

  it('với --remove cũng không gỡ gì', async () => {
    await mkdir(path.join(home, '.claude'));
    await mkdir(path.join(home, '.cursor'));
    const claude = fakeClaude();
    setup(optionsWith({ runClaude: claude.run }));

    const steps = setup(optionsWith({ runClaude: claude.run, dryRun: true, remove: true }));

    expect(steps.map((step) => step.outcome)).toEqual(['planned', 'planned', 'planned']);
    expect(claude.servers.has('themegraph')).toBe(true);
    expect(existsSync(skillFile())).toBe(true);
    expect(Object.keys((await readJson(cursorConfig())).mcpServers as object)).toEqual(['themegraph']);
  });
});

describe('setup --remove', () => {
  beforeEach(async () => {
    await mkdir(path.join(home, '.claude'));
    await mkdir(path.join(home, '.cursor'));
  });

  it('gỡ đúng những gì setup đã cài, giữ lại phần của người dùng', async () => {
    await writeFile(cursorConfig(), JSON.stringify({ mcpServers: { figma: { url: 'https://x' } } }));
    const claude = fakeClaude({ gitnexus: ['gitnexus', 'mcp'] });
    setup(optionsWith({ runClaude: claude.run }));

    const steps = setup(optionsWith({ runClaude: claude.run, remove: true }));

    expect(steps.map((step) => step.outcome)).toEqual(['done', 'done', 'done']);
    expect([...claude.servers.keys()]).toEqual(['gitnexus']);
    expect(existsSync(path.join(home, '.claude', 'skills', 'themegraph'))).toBe(false);
    expect(existsSync(path.join(home, '.claude', 'skills'))).toBe(true);
    expect(await readJson(cursorConfig())).toEqual({ mcpServers: { figma: { url: 'https://x' } } });
  });

  it('giữ thư mục skill nếu người dùng để file khác trong đó', async () => {
    setup(optionsWith());
    await writeFile(path.join(home, '.claude', 'skills', 'themegraph', 'ghi-chu.md'), 'của tôi');

    setup(optionsWith({ remove: true }));

    expect(existsSync(skillFile())).toBe(false);
    expect(existsSync(path.join(home, '.claude', 'skills', 'themegraph', 'ghi-chu.md'))).toBe(true);
  });

  it('không có gì để gỡ thì giữ nguyên, và không tạo ra file nào', async () => {
    const claude = fakeClaude();

    const steps = setup(optionsWith({ runClaude: claude.run, remove: true }));

    expect(steps.map((step) => step.outcome)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(existsSync(cursorConfig())).toBe(false);
    expect(existsSync(path.join(home, '.claude', 'skills'))).toBe(false);
  });

  it('báo lỗi khi claude mcp remove thất bại', () => {
    const claude = fakeClaude({ themegraph: ['node', 'cli.js', 'mcp'] });
    const options = optionsWith({
      remove: true,
      runClaude: (args) => (args[1] === 'remove' ? { ok: false, output: 'bị khoá' } : claude.run(args)),
    });

    const step = stepOf(setup(options), 'Claude Code');

    expect(step.outcome).toBe('failed');
    expect(step.detail).toContain('bị khoá');
  });
});

describe('setup — lỗi của một bước không cản bước khác', () => {
  it('không đọc được file skill nguồn: bước đó lỗi, Cursor vẫn được cấu hình', async () => {
    await mkdir(path.join(home, '.claude'));
    await mkdir(path.join(home, '.cursor'));

    const steps = setup(optionsWith({ skillSource: path.join(home, 'khong-co.md') }));

    expect(stepOf(steps, 'Skill cho Claude Code').outcome).toBe('failed');
    expect(stepOf(steps, 'Cursor').outcome).toBe('done');
  });
});

describe('formatSetup', () => {
  const step = (target: string, outcome: SetupStep['outcome'], detail = 'chi tiết'): SetupStep => ({ target, outcome, detail });

  it('in mỗi bước một dòng, căn cột, và nhắc khởi động lại khi có thay đổi', () => {
    const lines = formatSetup(
      [step('Claude Code', 'done', 'đã đăng ký.'), step('Skill cho Claude Code', 'unchanged', 'đã đúng.'), step('Cursor', 'skipped', 'không có.')],
      { dryRun: false, remove: false },
    );

    expect(lines).toEqual([
      'Nối ThemeGraph vào các AI agent:',
      '  Claude Code            xong        đã đăng ký.',
      '  Skill cho Claude Code  giữ nguyên  đã đúng.',
      '  Cursor                 bỏ qua      không có.',
      '',
      'Khởi động lại Claude Code / Cursor để nhận cấu hình mới.',
    ]);
  });

  it('không nhắc khởi động lại khi không có gì đổi, khi chạy thử, và khi gỡ', () => {
    const restart = 'Khởi động lại';
    const unchanged = [step('Cursor', 'unchanged')];
    const done = [step('Cursor', 'done')];

    expect(formatSetup(unchanged, { dryRun: false, remove: false }).join('\n')).not.toContain(restart);
    expect(formatSetup([step('Cursor', 'planned')], { dryRun: true, remove: false }).join('\n')).not.toContain(restart);
    expect(formatSetup(done, { dryRun: false, remove: true }).join('\n')).not.toContain(restart);
  });

  it('ghi rõ đang chạy thử và đang gỡ ở dòng tiêu đề', () => {
    expect(formatSetup([step('Cursor', 'planned')], { dryRun: true, remove: false })[0]).toBe(
      'Nối ThemeGraph vào các AI agent (chạy thử, không ghi gì):',
    );
    expect(formatSetup([step('Cursor', 'done')], { dryRun: false, remove: true })[0]).toBe(
      'Gỡ ThemeGraph khỏi các AI agent:',
    );
  });

  it('nói rõ khi không tìm thấy client nào', () => {
    const lines = formatSetup([step('Claude Code', 'skipped'), step('Cursor', 'skipped')], { dryRun: false, remove: false });

    expect(lines.at(-1)).toBe('Không tìm thấy Claude Code hay Cursor trên máy này.');
  });

  it('đánh dấu bước lỗi bằng chữ hoa', () => {
    expect(formatSetup([step('Cursor', 'failed', 'hỏng')], { dryRun: false, remove: false })[1]).toBe('  Cursor  LỖI         hỏng');
  });
});
