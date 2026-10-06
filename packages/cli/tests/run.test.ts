import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
    expect(result.stdout).toMatch(/Node\s+22\b/);
    expect(result.stdout).toMatch(/Cạnh\s+22\b/);
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
      expect(result.stdout).toMatch(/Node\s+22\b/);
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

describe('themegraph analyze --json', () => {
  it('in kết quả phân tích dạng JSON đọc lại được', async () => {
    const result = await runCli(['analyze', themeRoot, '--json']);
    const json = JSON.parse(result.stdout) as { stats: { nodes: number }; missing: unknown[]; dbPath: string };

    expect(result.code).toBe(0);
    expect(json.stats.nodes).toBe(22);
    expect(json.missing).toHaveLength(2);
    expect(json.dbPath).toBe(path.join(themeRoot, '.themegraph', 'graph.db'));
  });
});

describe('themegraph — chọn theme để truy vấn', () => {
  beforeEach(async () => {
    await runCli(['analyze', themeRoot]);
  });

  it('truy vấn theme ở thư mục đang đứng khi không có --theme', async () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(themeRoot);
      const result = await runCli(['impact', 'snippets/card.liquid']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Sửa snippets/card.liquid');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('đứng trong thư mục con của theme vẫn truy vấn được, tên file tính từ chỗ đang đứng', async () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(path.join(themeRoot, 'snippets'));
      const result = await runCli(['impact', 'card.liquid']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Sửa snippets/card.liquid');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('truy vấn theme ở --theme dù đang đứng ở nơi khác', async () => {
    const long = await runCli(['impact', 'snippets/card.liquid', '--theme', themeRoot]);
    const short = await runCli(['impact', 'snippets/card.liquid', '-t', themeRoot]);

    expect(long.code).toBe(0);
    expect(long.stdout).toContain('Sửa snippets/card.liquid');
    expect(short).toEqual(long);
  });

  it('báo cần analyze khi không tìm thấy theme nào từ thư mục đang đứng', async () => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'themegraph-nowhere-'));
    const originalCwd = process.cwd();
    try {
      process.chdir(elsewhere);
      const result = await runCli(['dead-code']);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Chưa có đồ thị');
      expect(result.stderr).toContain('themegraph analyze');
    } finally {
      process.chdir(originalCwd);
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('báo cần analyze lại khi graph.db không đọc được', async () => {
    await writeFile(path.join(themeRoot, '.themegraph', 'graph.db'), 'khong phai sqlite');

    const result = await runCli(['verify', '-t', themeRoot]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Không đọc được');
  });

  it('không giữ graph.db sau khi lệnh chạy xong, kể cả khi lệnh lỗi', async () => {
    await runCli(['impact', 'snippets/card.liquid', '-t', themeRoot]);
    await runCli(['impact', 'khong-co', '-t', themeRoot]);

    // Nếu database còn mở, Windows sẽ từ chối xoá file này.
    await expect(rm(path.join(themeRoot, '.themegraph', 'graph.db'))).resolves.toBeUndefined();
  });
});

describe('themegraph impact', () => {
  beforeEach(async () => {
    await runCli(['analyze', themeRoot]);
  });

  const impact = (...args: string[]) => runCli(['impact', ...args, '-t', themeRoot]);

  it('in câu tóm tắt, danh sách trang và danh sách file', async () => {
    const result = await impact('snippets/card.liquid');

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.split('\n')).toEqual([
      'Sửa snippets/card.liquid (snippet) ảnh hưởng 8 file và 4 trên 4 trang.',
      '',
      'Trang (4):',
      '  gift_card        cách 2 tầng                  qua templates/gift_card.liquid',
      '  index            cách 3 tầng                  qua blocks/text.liquid, sections/hero.liquid',
      '  product          cách 3 tầng  [có điều kiện]  qua blocks/text.liquid, sections/hero.liquid',
      '  customers/login  cách 5 tầng  [có điều kiện]  qua blocks/text.liquid, sections/hero.liquid',
      '',
      'File (8), gần nhất trước:',
      '  1  blocks/text.liquid                block',
      '  1  sections/hero.liquid              section        [có điều kiện]',
      '  1  templates/gift_card.liquid        template',
      '  2  sections/footer-group.json        section_group  [có điều kiện]',
      '  2  templates/index.json              template',
      '  2  templates/product.2-columns.json  template       [có điều kiện]',
      '  3  layout/theme.liquid               layout         [có điều kiện]',
      '  4  templates/customers/login.json    template       [có điều kiện]',
    ]);
  });

  it('nói rõ khi không ai dùng tới file', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'old.liquid'), '<p>cu</p>');
    await runCli(['analyze', themeRoot]);

    const result = await impact('snippets/old.liquid');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Không file hay trang nào dùng tới snippets/old.liquid (snippet).');
  });

  it('đánh dấu file có dùng target nhưng không nằm trên trang nào, kèm một dòng giải thích', async () => {
    // Một section gọi card nhưng không template nào chứa section đó.
    await writeFile(path.join(themeRoot, 'sections', 'lonely.liquid'), "{% render 'card' %}");
    await runCli(['analyze', themeRoot]);

    const result = await impact('snippets/card.liquid');
    const lines = result.stdout.split('\n');

    // Cột "có điều kiện" của dòng này trống, nên chỉ kiểm thứ tự các ô.
    expect(lines.some((line) => /^ +1 +sections\/lonely\.liquid +section +\[không trang nào dùng\]$/.test(line))).toBe(true);
    expect(lines.at(-1)).toBe(
      'File ghi [không trang nào dùng]: theo đồ thị, nó có dùng snippets/card.liquid nhưng không template hay file nào trên một trang gọi tới nó. Nó vẫn có thể lên trang nếu merchant thêm nó từ theme editor, hoặc nếu JavaScript tải nó (Section Rendering API), hai cách mà đồ thị không thấy.',
    );
    // Trang nào cũng không đi qua section đó.
    expect(lines.filter((line) => line.includes('qua ')).some((line) => line.includes('lonely'))).toBe(false);
    // File nằm trên trang thì không có nhãn.
    expect(lines.find((line) => line.includes('sections/hero.liquid  '))).not.toContain('không trang nào dùng');
  });

  it('không có dòng giải thích khi mọi file đều nằm trên một trang', async () => {
    const result = await impact('snippets/card.liquid');

    expect(result.stdout).not.toContain('không trang nào dùng');
  });

  it('nêu tối đa ba file sau chữ "qua" và đếm phần còn lại', async () => {
    // hero gọi thêm bốn snippet, mỗi snippet lại gọi card: trang index đi tới
    // card qua sáu file gọi trực tiếp.
    const names = ['w1', 'w2', 'w3', 'w4'];
    for (const name of names) await writeFile(path.join(themeRoot, 'snippets', `${name}.liquid`), "{% render 'card' %}");
    await appendFile(path.join(themeRoot, 'sections', 'hero.liquid'), names.map((name) => `{% render '${name}' %}`).join(''));
    await runCli(['analyze', themeRoot]);

    const result = await impact('snippets/card.liquid');
    const index = result.stdout.split('\n').find((line) => line.startsWith('  index '));

    expect(index).toMatch(/qua blocks\/text\.liquid, sections\/hero\.liquid, snippets\/w1\.liquid và 3 file khác$/);
  });

  it('trang gọi thẳng target thì không có chữ "qua"', async () => {
    const result = await impact('templates/index.json');

    // Cả dòng, để một chữ "qua" trơ trọi ở cuối cũng bị bắt.
    expect(result.stdout.split('\n')).toContain('  index  cách 1 tầng');
    expect(result.stdout).not.toContain('qua');
  });

  it('--json có via của từng trang và danh sách offPage', async () => {
    await writeFile(path.join(themeRoot, 'sections', 'lonely.liquid'), "{% render 'card' %}");
    await runCli(['analyze', themeRoot]);

    const result = await impact('snippets/card.liquid', '--json');
    const json = JSON.parse(result.stdout) as { pages: { id: string; via: string[] }[]; offPage: string[] };

    expect(json.offPage).toEqual(['sections/lonely.liquid']);
    expect(json.pages.find((page) => page.id === 'page:gift_card')?.via).toEqual(['templates/gift_card.liquid']);
  });

  it('tách trang chỉ dính qua section do JavaScript tải: nhãn riêng, xếp sau, có dòng giải thích', async () => {
    // layout nạp cart.js; cart.js tải section drawer; drawer gọi card.
    await writeFile(path.join(themeRoot, 'sections', 'drawer.liquid'), "{% render 'only-drawer' %}");
    await writeFile(path.join(themeRoot, 'snippets', 'only-drawer.liquid'), '<p>x</p>');
    await writeFile(path.join(themeRoot, 'assets', 'cart.js'), 'fetch(`/cart?section_id=drawer`);');
    await appendFile(path.join(themeRoot, 'layout', 'theme.liquid'), "\n{{ 'cart.js' | asset_url | script_tag }}");
    // Thêm một đường tĩnh cho riêng trang gift_card.
    await appendFile(path.join(themeRoot, 'templates', 'gift_card.liquid'), "\n{% render 'only-drawer' %}");
    await runCli(['analyze', themeRoot]);

    const result = await impact('snippets/only-drawer.liquid');
    const lines = result.stdout.split('\n');
    const pageLines = lines.slice(lines.indexOf('Trang (4):') + 1, lines.indexOf('Trang (4):') + 5);

    expect(lines[0]).toMatch(/ảnh hưởng \d+ file và 4 trên 4 trang, trong đó 3 trang chỉ qua JavaScript\.$/);
    // gift_card có đường tĩnh nên đứng đầu và không mang nhãn.
    expect(pageLines[0]).toMatch(/^ {2}gift_card +cách 2 tầng +qua /);
    expect(pageLines[0]).not.toContain('[qua JavaScript]');
    expect(pageLines.slice(1).every((line) => line.includes('[qua JavaScript]'))).toBe(true);
    // Nhãn [qua JavaScript] thay cho [có điều kiện], không đứng cùng nó.
    expect(pageLines.slice(1).some((line) => line.includes('[có điều kiện]'))).toBe(false);
    expect(lines).toContain(
      'Trang ghi [qua JavaScript]: snippets/only-drawer.liquid chỉ lên trang đó khi JavaScript tải riêng một section (Section Rendering API), ví dụ lúc mở giỏ hàng hoặc gõ vào ô tìm kiếm.',
    );
  });

  it('không có nhãn hay dòng giải thích về JavaScript khi mọi trang đều có đường tĩnh', async () => {
    const result = await impact('snippets/card.liquid');

    expect(result.stdout).not.toContain('JavaScript');
    expect(result.stdout.split('\n')[0]).toBe('Sửa snippets/card.liquid (snippet) ảnh hưởng 8 file và 4 trên 4 trang.');
  });

  it('bỏ mục File khi chỉ có trang bị ảnh hưởng', async () => {
    const result = await impact('templates/index.json');

    expect(result.stdout).toContain('ảnh hưởng 0 file và 1 trên 4 trang');
    expect(result.stdout).toContain('Trang (1):');
    expect(result.stdout).not.toContain('File (');
  });

  it('in JSON với --json', async () => {
    const result = await impact('snippets/card.liquid', '--json');
    const json = JSON.parse(result.stdout) as { target: { id: string }; pages: unknown[]; totalPages: number };

    expect(result.code).toBe(0);
    expect(json.target.id).toBe('snippets/card.liquid');
    expect(json.pages).toHaveLength(4);
    expect(json.totalPages).toBe(4);
  });

  it('báo lỗi kèm gợi ý và trả mã 1 khi tên file không có trong đồ thị', async () => {
    const result = await impact('snippets/card');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Không có node "snippets/card"');
    expect(result.stderr).toContain('snippets/card.liquid');
  });

  it('trả mã 2 khi thiếu hoặc thừa tham số', async () => {
    const missing = await impact();
    const extra = await impact('snippets/card.liquid', 'thua');

    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('themegraph impact cần đúng một tham số');
    expect(extra.code).toBe(2);
  });
});

describe('themegraph render-flow', () => {
  beforeEach(async () => {
    await runCli(['analyze', themeRoot]);
  });

  it('in cây các file một trang kéo theo', async () => {
    const result = await runCli(['render-flow', 'index', '-t', themeRoot]);

    expect(result.code).toBe(0);
    expect(result.stdout.split('\n')).toEqual([
      'page:index (page_type) kéo theo 7 file, sâu nhất 3 tầng.',
      'Theo loại: 1 template, 1 layout, 1 section_group, 1 section, 1 block, 1 snippet, 1 asset.',
      'Section (1): sections/hero.liquid',
      '',
      'page:index',
      '  templates/index.json',
      '    blocks/text.liquid',
      '      snippets/card.liquid',
      '    layout/theme.liquid',
      '      assets/base.css',
      '      sections/footer-group.json',
      '        sections/hero.liquid  (các file con: xem ở chỗ khác trong cây)',
      '    sections/hero.liquid',
      '      blocks/text.liquid  [có điều kiện]  (các file con: xem ở chỗ khác trong cây)',
      // card là lá: lặp lại ở đây không giấu gì nên không có ghi chú.
      '      snippets/card.liquid  [có điều kiện]',
    ]);
  });

  it('ghi số lời gọi khi một file được gọi nhiều lần từ cùng một chỗ', async () => {
    await writeFile(path.join(themeRoot, 'templates', 'gift_card.liquid'), "{% render 'card' %}{% render 'card' %}");
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['render-flow', 'gift_card', '-t', themeRoot]);

    expect(result.stdout).toContain('    snippets/card.liquid  ×2');
  });

  it('nói rõ khi node không gọi tới file nào', async () => {
    const result = await runCli(['render-flow', 'assets/base.css', '-t', themeRoot]);

    expect(result.stdout).toBe('assets/base.css (asset) không gọi tới file nào.');
  });

  it('in JSON với --json', async () => {
    const result = await runCli(['render-flow', 'index', '-t', themeRoot, '--json']);
    const json = JSON.parse(result.stdout) as { root: { id: string }; files: unknown[]; tree: { children: unknown[] } };

    expect(json.root.id).toBe('page:index');
    expect(json.files).toHaveLength(7);
    expect(json.tree.children).toHaveLength(1);
  });

  it('trả mã 2 khi thiếu tên trang', async () => {
    const result = await runCli(['render-flow', '-t', themeRoot]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('tên một loại trang');
  });

  it('--depth cắt cây ở một tầng, ghi số file con chưa mở và nói rõ cây bị cắt', async () => {
    const result = await runCli(['render-flow', 'index', '-t', themeRoot, '--depth', '2']);

    expect(result.code).toBe(0);
    expect(result.stdout.split('\n')).toEqual([
      // Câu tóm tắt và hai dòng tổng hợp vẫn tính trên cả cây.
      'page:index (page_type) kéo theo 7 file, sâu nhất 3 tầng.',
      'Theo loại: 1 template, 1 layout, 1 section_group, 1 section, 1 block, 1 snippet, 1 asset.',
      'Section (1): sections/hero.liquid',
      'Cây dưới đây dừng ở tầng 2. Hỏi tiếp từ một file trong cây, hoặc tăng độ sâu, để xem phần bên dưới.',
      '',
      'page:index',
      '  templates/index.json',
      '    blocks/text.liquid  (1 file con chưa mở)',
      '    layout/theme.liquid  (2 file con chưa mở)',
      '    sections/hero.liquid  (2 file con chưa mở)',
    ]);
  });

  it('liệt kê đủ section của trang dù cây bị cắt ở tầng 1, và đánh dấu section có điều kiện', async () => {
    // Thêm một section chỉ được gọi trong một nhánh if, nằm sâu dưới hero.
    await writeFile(path.join(themeRoot, 'sections', 'deep.liquid'), '<p>x</p>');
    await appendFile(path.join(themeRoot, 'snippets', 'card.liquid'), "{% if x %}{% section 'deep' %}{% endif %}");
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['render-flow', 'index', '-t', themeRoot, '--depth', '1']);
    const lines = result.stdout.split('\n');

    // Cây chỉ còn template, nhưng dòng Section vẫn có cả hai, xếp theo id.
    expect(lines).toContain('Section (2): sections/deep.liquid [có điều kiện], sections/hero.liquid');
    expect(lines).toContain('Theo loại: 1 template, 1 layout, 1 section_group, 2 section, 1 block, 1 snippet, 1 asset.');
    expect(lines.filter((line) => line.startsWith('  ')).map((line) => line.trim())).toEqual([
      'templates/index.json  (3 file con chưa mở)',
    ]);
  });

  it('không có dòng Section khi gốc không kéo theo section nào, và bỏ loại có số đếm bằng 0', async () => {
    const result = await runCli(['render-flow', 'blocks/text.liquid', '-t', themeRoot]);

    expect(result.stdout.split('\n').slice(0, 3)).toEqual([
      'blocks/text.liquid (block) kéo theo 1 file, sâu nhất 1 tầng.',
      'Theo loại: 1 snippet.',
      '',
    ]);
  });

  it('--depth không giấu gì thì không có dòng báo cây bị cắt', async () => {
    const full = await runCli(['render-flow', 'index', '-t', themeRoot]);
    const deep = await runCli(['render-flow', 'index', '-t', themeRoot, '--depth', '9']);

    expect(deep.stdout).toBe(full.stdout);
    expect(deep.stdout).not.toContain('dừng ở tầng');
  });

  it('--limit cắt số dòng của cây và đếm phần còn lại', async () => {
    const result = await runCli(['render-flow', 'index', '-t', themeRoot, '--limit', '3']);

    expect(result.stdout.split('\n')).toEqual([
      'page:index (page_type) kéo theo 7 file, sâu nhất 3 tầng.',
      'Theo loại: 1 template, 1 layout, 1 section_group, 1 section, 1 block, 1 snippet, 1 asset.',
      'Section (1): sections/hero.liquid',
      '',
      'page:index',
      '  templates/index.json',
      '    blocks/text.liquid',
      // Cây đầy đủ có 11 dòng.
      '  ... và 8 dòng nữa (tăng limit để xem hết)',
    ]);
  });

  it('--json với --depth ghi maxDepth và số con bị giấu', async () => {
    const result = await runCli(['render-flow', 'index', '-t', themeRoot, '--depth', '1', '--json']);
    const json = JSON.parse(result.stdout) as {
      maxDepth: number | null;
      files: unknown[];
      tree: { children: { id: string; hidden: number; children: unknown[] }[] };
    };

    expect(json.maxDepth).toBe(1);
    expect(json.files).toHaveLength(7);
    expect(json.tree.children).toEqual([expect.objectContaining({ id: 'templates/index.json', hidden: 3, children: [] })]);
  });

  it('trả mã 2 khi --depth không phải số nguyên từ 1 trở lên', async () => {
    for (const bad of ['0', '1.5', 'abc', '-1', '']) {
      const result = await runCli(['render-flow', 'index', '-t', themeRoot, `--depth=${bad}`]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--depth cần một số nguyên từ 1 trở lên');
    }
  });
});

describe('themegraph search', () => {
  beforeEach(async () => {
    await runCli(['analyze', themeRoot]);
  });

  const search = (...args: string[]) => runCli(['search', ...args, '-t', themeRoot]);

  it('in các node khớp, sát nhất trước, kèm loại', async () => {
    const result = await search('card');

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.split('\n')).toEqual([
      'Node khớp "card" (4), sát nhất trước:',
      '  snippets/card.liquid                            snippet',
      '  page:gift_card                                  page_type',
      '  templates/gift_card.liquid                      template',
      '  setting:sections/hero.liquid#section.show_card  setting',
    ]);
  });

  it('nhận nhiều từ, viết rời hay trong một tham số đều được', async () => {
    const separate = await search('gift', 'templates');
    const joined = await search('gift templates');

    expect(separate.stdout.split('\n')).toEqual([
      'Node khớp "gift templates" (1), sát nhất trước:',
      '  templates/gift_card.liquid  template',
    ]);
    expect(joined.stdout).toBe(separate.stdout);
  });

  it('--kind lọc theo loại node, lặp lại được; không có từ khoá thì liệt kê', async () => {
    const result = await search('--kind', 'section', '--kind', 'block');

    expect(result.stdout.split('\n')).toEqual([
      'Node (2), sát nhất trước:',
      '  blocks/text.liquid    block',
      '  sections/hero.liquid  section',
    ]);
  });

  it('--limit cắt kết quả và nói rõ đang hiện bao nhiêu trên tổng số', async () => {
    const result = await search('card', '--limit', '2');

    expect(result.stdout.split('\n')).toEqual([
      'Node khớp "card" (2 trên 4), sát nhất trước:',
      '  snippets/card.liquid  snippet',
      '  page:gift_card        page_type',
    ]);
  });

  it('không có --limit thì hiện 20 kết quả đầu', async () => {
    const result = await search();

    // Fixture có 22 node.
    expect(result.stdout.split('\n')[0]).toBe('Node (20 trên 22), sát nhất trước:');
    expect(result.stdout.split('\n')).toHaveLength(21);
  });

  it('nói rõ khi không có gì khớp, và vẫn trả mã 0', async () => {
    const result = await search('khong-co');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Không có node nào khớp "khong-co".');

    const empty = await search('--kind', 'locale', 'khong-co');
    expect(empty.stdout).toBe('Không có node nào khớp "khong-co".');
  });

  it('in JSON với --json', async () => {
    const result = await search('card', '--json', '--limit', '1');

    expect(JSON.parse(result.stdout)).toEqual({
      query: 'card',
      hits: [{ id: 'snippets/card.liquid', kind: 'snippet', match: 'exact' }],
      total: 4,
    });
  });

  it('trả mã 2 khi --kind không phải một loại node, và liệt kê các loại', async () => {
    const result = await search('card', '--kind', 'snippets');

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Không có loại node "snippets"');
    expect(result.stderr).toContain('snippet, asset');
  });

  it('trả mã 2 khi --limit không phải số nguyên không âm', async () => {
    for (const bad of ['x', '1.5', '-2', '1e3', '']) {
      const result = await search('card', `--limit=${bad}`);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--limit cần một số nguyên từ 0 trở lên');
    }
  });

  it('--limit 0 hợp lệ: không hiện node nào nhưng vẫn đếm', async () => {
    const result = await search('card', '--limit', '0');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Node khớp "card" (0 trên 4), sát nhất trước:');
  });
});

describe('themegraph — --limit ở các lệnh khác', () => {
  beforeEach(async () => {
    await runCli(['analyze', themeRoot]);
  });

  it('impact: cắt danh sách file, giữ nguyên danh sách trang', async () => {
    const result = await runCli(['impact', 'snippets/card.liquid', '-t', themeRoot, '--limit', '2']);

    expect(result.stdout.split('\n')).toEqual([
      'Sửa snippets/card.liquid (snippet) ảnh hưởng 8 file và 4 trên 4 trang.',
      '',
      'Trang (4):',
      '  gift_card        cách 2 tầng                  qua templates/gift_card.liquid',
      '  index            cách 3 tầng                  qua blocks/text.liquid, sections/hero.liquid',
      '  product          cách 3 tầng  [có điều kiện]  qua blocks/text.liquid, sections/hero.liquid',
      '  customers/login  cách 5 tầng  [có điều kiện]  qua blocks/text.liquid, sections/hero.liquid',
      '',
      'File (8), gần nhất trước:',
      '  1  blocks/text.liquid                block',
      '  1  sections/hero.liquid              section        [có điều kiện]',
      '  ... và 6 file nữa (tăng limit để xem hết)',
    ]);
  });

  it('impact: limit bằng đúng số file thì không có dòng đếm', async () => {
    const full = await runCli(['impact', 'snippets/card.liquid', '-t', themeRoot]);
    const exact = await runCli(['impact', 'snippets/card.liquid', '-t', themeRoot, '--limit', '8']);

    expect(exact.stdout).toBe(full.stdout);
  });

  it('context: cắt riêng từng mục', async () => {
    const result = await runCli(['context', 'sections/hero.liquid', '-t', themeRoot, '--limit', '1']);
    const lines = result.stdout.split('\n');

    expect(lines).toContain('Được gọi bởi (3):');
    expect(lines).toContain('  ... và 2 file nữa (tăng limit để xem hết)');
    expect(lines).toContain('Gọi tới (2):');
    expect(lines).toContain('  ... và 1 file nữa (tăng limit để xem hết)');
    // Mục chỉ có một dòng thì không bị cắt.
    expect(lines).toContain('Khoá dịch (1):');
    expect(result.stdout).not.toContain('khoá dịch nữa');
    expect(result.stdout).not.toContain('setting nữa');
  });

  it('context: cắt cả mục khoá dịch và mục setting', async () => {
    await writeFile(
      path.join(themeRoot, 'snippets', 'many.liquid'),
      "{{ 'general.title' | t }}{{ 'cart.items' | t }}{{ settings.accent }}{{ settings.accent_2 }}",
    );
    await writeFile(
      path.join(themeRoot, 'config', 'settings_schema.json'),
      JSON.stringify([{ name: 'x', settings: [{ type: 'color', id: 'accent' }, { type: 'color', id: 'accent_2' }] }]),
    );
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['context', 'snippets/many.liquid', '-t', themeRoot, '--limit', '1']);

    expect(result.stdout).toContain('Khoá dịch (2):');
    expect(result.stdout).toContain('  ... và 1 khoá dịch nữa (tăng limit để xem hết)');
    expect(result.stdout).toContain('Setting được đọc (2):');
    expect(result.stdout).toContain('  ... và 1 setting nữa (tăng limit để xem hết)');
  });

  it('dead-code: cắt riêng từng mục', async () => {
    for (const name of ['old-a', 'old-b', 'old-c']) {
      await writeFile(path.join(themeRoot, 'snippets', `${name}.liquid`), '<p>cu</p>');
      await writeFile(path.join(themeRoot, 'sections', `${name}.liquid`), '<p>cu</p>');
    }
    await writeFile(
      path.join(themeRoot, 'locales', 'en.default.json'),
      JSON.stringify({ general: { title: 'a' }, cart: { items: 'b' }, unused: { a: '1', b: '2', c: '3' } }),
    );
    await writeFile(
      path.join(themeRoot, 'config', 'settings_schema.json'),
      JSON.stringify([
        { name: 'x', settings: ['accent', 'u1', 'u2', 'u3'].map((id) => ({ type: 'color', id })) },
      ]),
    );
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['dead-code', '-t', themeRoot, '--limit', '1']);
    const lines = result.stdout.split('\n');

    expect(lines).toContain('Chắc chắn không dùng (3):');
    expect(lines).toContain('Cần xem lại trước khi xoá (3):');
    // Hai mục file, mỗi mục giấu 2.
    expect(lines.filter((line) => line === '  ... và 2 file nữa (tăng limit để xem hết)')).toHaveLength(2);
    expect(lines).toContain('  ... và 2 khoá dịch nữa (tăng limit để xem hết)');
    expect(lines).toContain('  ... và 2 setting nữa (tăng limit để xem hết)');
  });
});

describe('themegraph context', () => {
  beforeEach(async () => {
    await runCli(['analyze', themeRoot]);
  });

  it('in các trang, ai gọi file và file gọi ai, kèm số dòng', async () => {
    const result = await runCli(['context', 'sections/hero.liquid', '-t', themeRoot]);

    expect(result.code).toBe(0);
    expect(result.stdout.split('\n')).toEqual([
      'sections/hero.liquid (section)',
      '  Thuộc 3 trên 4 trang: index, product [có điều kiện], customers/login',
      '',
      'Được gọi bởi (3):',
      '  sections/footer-group.json        RENDERS',
      '  templates/index.json              RENDERS',
      '  templates/product.2-columns.json  RENDERS  [có điều kiện]',
      '',
      'Gọi tới (2):',
      '  blocks/text.liquid    dòng 8  RENDERS  [có điều kiện]',
      '  snippets/card.liquid  dòng 3  RENDERS  [có điều kiện]',
      '',
      'Khoá dịch (1):',
      '  general.title  dòng 1',
      '',
      'Setting được đọc (1):',
      '  sections/hero.liquid#section.show_card  dòng 2',
    ]);
  });

  it('viết số dòng liền sau tên file gọi, và đếm lời gọi lặp', async () => {
    await writeFile(path.join(themeRoot, 'templates', 'gift_card.liquid'), "{% render 'card' %}\n\n{% render 'card' %}");
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['context', 'snippets/card.liquid', '-t', themeRoot]);

    expect(result.stdout).toContain('  templates/gift_card.liquid:1,3  RENDERS  ×2');
    expect(result.stdout).toContain('  blocks/text.liquid:2');
  });

  it('in mục tham chiếu hỏng, không có số dòng khi ref lấy từ JSON', async () => {
    const fromJson = await runCli(['context', 'templates/customers/login.json', '-t', themeRoot]);
    const fromLiquid = await runCli(['context', 'snippets/card.liquid', '-t', themeRoot]);

    expect(fromJson.stdout).toContain('Tham chiếu hỏng (1):\n  (JSON)  section -> sections/missing-section.liquid');
    expect(fromLiquid.stdout).toContain('Tham chiếu hỏng (1):\n  dòng 4  asset -> assets/icon-star');
  });

  it('in mục khoá dịch với số dòng, và bỏ mục đó khi file không dùng khoá nào', async () => {
    await writeFile(
      path.join(themeRoot, 'snippets', 'card.liquid'),
      "{{ 'cart.items' | t }}\n{% if a %}{{ 'general.title' | t }}{% endif %}\n{{ 'cart.items' | t }}",
    );
    await runCli(['analyze', themeRoot]);

    const card = await runCli(['context', 'snippets/card.liquid', '-t', themeRoot]);
    const css = await runCli(['context', 'assets/base.css', '-t', themeRoot]);

    expect(card.stdout).toContain(
      ['Khoá dịch (2):', '  cart.items     dòng 1, 3', '  general.title  dòng 2     [có điều kiện]'].join('\n'),
    );
    expect(css.stdout).not.toContain('Khoá dịch');
  });

  it('cho biết section.settings trong một snippet là setting của section nào', async () => {
    await writeFile(
      path.join(themeRoot, 'snippets', 'card.liquid'),
      '{% if section.settings.show_card %}\n  {% if a %}{{ settings.accent }}{% endif %}\n{% endif %}',
    );
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['context', 'snippets/card.liquid', '-t', themeRoot]);

    expect(result.stdout).toContain(
      [
        'Setting được đọc (2):',
        '  sections/hero.liquid#section.show_card  dòng 1',
        '  settings.accent                         dòng 2  [có điều kiện]',
      ].join('\n'),
    );
  });

  it('không in mục setting khi file không đọc setting nào', async () => {
    const result = await runCli(['context', 'assets/base.css', '-t', themeRoot]);

    expect(result.stdout).not.toContain('Setting được đọc');
  });

  it('hỏi được về một khoá dịch bằng id t:<khoá>', async () => {
    const result = await runCli(['context', 't:general.title', '-t', themeRoot]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('t:general.title (translation_key)');
    expect(result.stdout).toContain('  sections/hero.liquid:1  USES_TRANSLATION');
  });

  it('không in mục tham chiếu hỏng khi file không có cái nào', async () => {
    const result = await runCli(['context', 'sections/hero.liquid', '-t', themeRoot]);

    expect(result.stdout).not.toContain('Tham chiếu hỏng');
  });

  it('bỏ cột rỗng thay vì để khoảng trống giữa dòng', async () => {
    const result = await runCli(['context', 'templates/customers/login.json', '-t', themeRoot]);

    // Quan hệ với layout suy từ quy ước nên không có số dòng nào để in.
    expect(result.stdout).toContain('Gọi tới (1):\n  layout/theme.liquid  USES_LAYOUT');
  });

  it('nói rõ khi không trang nào dùng file, và bỏ dòng đó với node loại trang', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'old.liquid'), '<p>cu</p>');
    await runCli(['analyze', themeRoot]);

    const orphan = await runCli(['context', 'snippets/old.liquid', '-t', themeRoot]);
    const page = await runCli(['context', 'index', '-t', themeRoot]);

    expect(orphan.stdout).toContain('Không trang nào dùng tới.');
    expect(page.stdout.split('\n').slice(0, 3)).toEqual(['page:index (page_type)', '', 'Được gọi bởi (0):']);
  });

  it('in JSON với --json', async () => {
    const result = await runCli(['context', 'sections/hero.liquid', '-t', themeRoot, '--json']);
    const json = JSON.parse(result.stdout) as { node: { id: string }; usedBy: unknown[]; uses: unknown[] };

    expect(json.node.id).toBe('sections/hero.liquid');
    expect(json.usedBy).toHaveLength(3);
    expect(json.uses).toHaveLength(2);
  });
});

describe('themegraph dead-code', () => {
  beforeEach(async () => {
    await runCli(['analyze', themeRoot]);
  });

  it('nói rõ khi không có file nào thừa', async () => {
    const result = await runCli(['dead-code', '-t', themeRoot]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Không tìm thấy file nào không được dùng.');
  });

  it('in hai mục theo mức tin cậy, kèm lý do cần xem lại', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'old.liquid'), "{{ 'old.png' | asset_url }}");
    await writeFile(path.join(themeRoot, 'assets', 'old.png'), '');
    await writeFile(path.join(themeRoot, 'sections', 'drawer.liquid'), "{% render 'drawer-row' %}");
    await writeFile(path.join(themeRoot, 'snippets', 'drawer-row.liquid'), '<li></li>');
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['dead-code', '-t', themeRoot]);

    expect(result.code).toBe(0);
    expect(result.stdout.split('\n')).toEqual([
      'Không trang nào dùng tới 4 file: 1 chắc chắn, 3 cần xem lại.',
      '',
      'Chắc chắn không dùng (1):',
      '  snippets/old.liquid  snippet',
      '',
      'Cần xem lại trước khi xoá (3):',
      '  assets/old.png              asset    chỉ được gọi bởi snippets/old.liquid',
      '  sections/drawer.liquid      section',
      '  snippets/drawer-row.liquid  snippet  chỉ được gọi bởi sections/drawer.liquid',
      '',
      'Vì sao cần xem lại:',
      '  section: không có preset, không template nào dùng, và không file nào tải nó bằng tên viết sẵn; JavaScript của theme vẫn có thể tải nó qua Section Rendering API bằng tên là biến.',
      '  asset: có thể được gọi bằng tên ghép lúc chạy, hoặc từ bên trong một file CSS / JavaScript.',
      '  File khác trong mục này: chỉ được gọi bởi một file cần xem lại.',
    ]);
  });

  it('tách file JavaScript có nơi dùng thẻ mà không ai nạp thành mục riêng, ở cả dead-code lẫn overview', async () => {
    await writeFile(path.join(themeRoot, 'assets', 'x.js'), 'customElements.define("x-el", class extends HTMLElement {});');
    await appendFile(path.join(themeRoot, 'sections', 'hero.liquid'), '\n<x-el></x-el>\n');
    await runCli(['analyze', themeRoot]);

    const dead = await runCli(['dead-code', '-t', themeRoot]);
    const json = await runCli(['dead-code', '-t', themeRoot, '--json']);
    const summary = await runCli(['overview', '-t', themeRoot]);

    expect(dead.stdout.split('\n').slice(0, 4)).toEqual([
      'Không tìm thấy file nào không được dùng.',
      '',
      'Có nơi dùng thẻ nhưng không trang nào nạp file (1), KHÔNG xoá:',
      '  assets/x.js  định nghĩa <x-el>, được viết ở sections/hero.liquid',
    ]);
    expect(JSON.parse(json.stdout)).toMatchObject({
      files: [],
      notLoaded: [{ id: 'assets/x.js', elements: [{ name: 'x-el', usedBy: ['sections/hero.liquid'] }], usedBy: [] }],
    });
    expect(summary.stdout).toMatch(/Dùng mà không nạp\s+1 file JavaScript/);
  });

  it('chỉ in mục có file, và chỉ in lý do của loại file có mặt', async () => {
    await writeFile(path.join(themeRoot, 'assets', 'old.png'), '');
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['dead-code', '-t', themeRoot]);

    expect(result.stdout).not.toContain('Chắc chắn không dùng');
    expect(result.stdout).toContain('Cần xem lại trước khi xoá (1):');
    expect(result.stdout).toContain('  asset:');
    expect(result.stdout).not.toContain('  section:');
    expect(result.stdout).not.toContain('  layout:');
  });

  it('không in mục cần xem lại khi chỉ có file chắc chắn', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'old.liquid'), '<p>cu</p>');
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['dead-code', '-t', themeRoot]);

    expect(result.stdout).toContain('Chắc chắn không dùng (1):');
    expect(result.stdout).not.toContain('Cần xem lại');
    expect(result.stdout).not.toContain('Vì sao');
  });

  it('in mục khoá dịch không dùng, kể cả khi không có file thừa', async () => {
    await writeFile(
      path.join(themeRoot, 'locales', 'en.default.json'),
      JSON.stringify({ general: { title: 'x', old: 'y' }, cart: { items: { one: '1', other: 'n' } }, zz: 'z' }),
    );
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['dead-code', '-t', themeRoot]);

    expect(result.stdout.split('\n')).toEqual([
      'Không tìm thấy file nào không được dùng.',
      '',
      'Khoá dịch không file nào gọi bằng tên viết sẵn (2), cần xem lại:',
      '  general.old',
      '  zz',
      "  Khoá vẫn có thể được gọi bằng tên ghép lúc chạy, ví dụ 'products.' | append: handle | t.",
    ]);
  });

  it('in mục khoá dịch không dùng sau danh sách file', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'old.liquid'), '<p>cu</p>');
    await writeFile(path.join(themeRoot, 'locales', 'en.default.json'), JSON.stringify({ general: { title: 'x' }, cart: { items: 'n', old: 'o' } }));
    await runCli(['analyze', themeRoot]);

    const lines = (await runCli(['dead-code', '-t', themeRoot])).stdout.split('\n');

    expect(lines.slice(0, 4)).toEqual([
      'Không trang nào dùng tới 1 file: 1 chắc chắn, 0 cần xem lại.',
      '',
      'Chắc chắn không dùng (1):',
      '  snippets/old.liquid  snippet',
    ]);
    expect(lines.slice(4, 7)).toEqual(['', 'Khoá dịch không file nào gọi bằng tên viết sẵn (1), cần xem lại:', '  cart.old']);
  });

  it('in mục setting không đọc sau mục khoá dịch', async () => {
    await writeFile(
      path.join(themeRoot, 'config', 'settings_schema.json'),
      JSON.stringify([{ name: 'Colors', settings: [{ type: 'color', id: 'accent' }, { type: 'color', id: 'old_color' }] }]),
    );
    await writeFile(path.join(themeRoot, 'locales', 'en.default.json'), JSON.stringify({ general: { title: 'x', old: 'y' }, cart: { items: 'n' } }));
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['dead-code', '-t', themeRoot]);

    expect(result.stdout.split('\n')).toEqual([
      'Không tìm thấy file nào không được dùng.',
      '',
      'Khoá dịch không file nào gọi bằng tên viết sẵn (1), cần xem lại:',
      '  general.old',
      "  Khoá vẫn có thể được gọi bằng tên ghép lúc chạy, ví dụ 'products.' | append: handle | t.",
      '',
      'Setting không file nào đọc bằng tên viết sẵn (1), cần xem lại:',
      '  settings.old_color',
      '  Setting vẫn có thể được đọc bằng tên là biến (section.settings[ten]), hoặc do chính Shopify đọc.',
    ]);
  });

  it('không in mục setting khi mọi setting đều được đọc', async () => {
    const result = await runCli(['dead-code', '-t', themeRoot]);

    expect(result.stdout).not.toContain('Setting không file nào đọc');
  });

  it('in JSON với --json', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'old.liquid'), '<p>cu</p>');
    await runCli(['analyze', themeRoot]);

    const result = await runCli(['dead-code', '-t', themeRoot, '--json']);
    const json = JSON.parse(result.stdout) as { files: { id: string }[]; certain: number };

    expect(json.certain).toBe(1);
    expect(json.files.map((f) => f.id)).toEqual(['snippets/old.liquid']);
  });

  it('trả mã 2 khi có tham số thừa', async () => {
    const result = await runCli(['dead-code', 'thua', '-t', themeRoot]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('dead-code không nhận tham số');
  });
});

describe('themegraph verify', () => {
  beforeEach(async () => {
    await runCli(['analyze', themeRoot]);
  });

  /** Chèn thẳng vào graph.db các cạnh trỏ tới node không tồn tại. */
  function addGhostEdges(count: number): void {
    const db = new DatabaseSync(path.join(themeRoot, '.themegraph', 'graph.db'));
    db.exec('PRAGMA foreign_keys = OFF');
    const insert = db.prepare(
      "INSERT INTO edges (src, dst, type, conditional, sources, count) VALUES (?, ?, 'RENDERS', 1, 'liquid', 1)",
    );
    for (let i = 0; i < count; i++) insert.run('assets/base.css', `snippets/ma-${String(i).padStart(2, '0')}.liquid`);
    db.close();
  }

  it('in số liệu và ĐẠT, trả mã 0 khi SQL và BFS khớp nhau', async () => {
    const result = await runCli(['verify', '-t', themeRoot]);
    const lines = result.stdout.split('\n');

    expect(result.code).toBe(0);
    expect(lines.slice(0, 6)).toEqual([
      'Đã đối chiếu 44 phép duyệt (22 node × 2 chiều), 246 cặp so sánh.',
      '',
      '  Sai khác giữa SQL và BFS   0',
      '  Lỗi toàn vẹn của database  0',
      '  Độ sâu lớn nhất            6',
      '  Node nằm trên vòng         0',
    ]);
    expect(lines.at(-1)).toMatch(/^Kết quả: ĐẠT \(\d+ ms\)$/);
    expect(result.stdout).not.toContain('Sai khác (SQL so với BFS)');
    expect(result.stdout).not.toContain('Lỗi toàn vẹn:');
  });

  it('in từng sai khác và lỗi toàn vẹn, trả mã 1 khi không đạt', async () => {
    addGhostEdges(1);

    const result = await runCli(['verify', '-t', themeRoot]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      '  từ assets/base.css (forward) tới snippets/ma-00.liquid: SQL không tới, BFS sâu 1 [có điều kiện]',
    );
    expect(result.stdout).toContain('Lỗi toàn vẹn:\n  Bảng edges');
    // Ít hơn 20 sai khác thì in hết, không có dòng "và N sai khác nữa".
    expect(result.stdout).not.toContain('sai khác nữa');
    expect(result.stdout).toMatch(/Kết quả: KHÔNG ĐẠT \(\d+ ms\)$/);
  });

  it('chỉ in 20 sai khác đầu và đếm phần còn lại', async () => {
    addGhostEdges(3);

    const result = await runCli(['verify', '-t', themeRoot]);
    const shown = result.stdout.split('\n').filter((line) => line.startsWith('  từ '));

    // Mỗi node ma hiện ra trong phép duyệt xuôi của base.css và của mọi node
    // đi tới được base.css, nên số sai khác vượt xa 20.
    expect(shown).toHaveLength(20);
    expect(result.stdout).toMatch(/\.\.\. và \d+ sai khác nữa \(dùng --json để xem hết\)/);
  });

  it('in JSON với --json và vẫn trả mã 1 khi không đạt', async () => {
    addGhostEdges(1);

    const result = await runCli(['verify', '-t', themeRoot, '--json']);
    const json = JSON.parse(result.stdout) as { ok: boolean; mismatches: unknown[] };

    expect(result.code).toBe(1);
    expect(json.ok).toBe(false);
    expect(json.mismatches.length).toBeGreaterThan(0);
  });
});

describe('themegraph — sổ đăng ký: list, status, clean', () => {
  let other: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    // Sổ đăng ký trống của riêng từng test, và một theme thứ hai ở chỗ khác.
    previousHome = process.env.THEMEGRAPH_HOME;
    process.env.THEMEGRAPH_HOME = path.join(tmp, 'home');

    other = path.join(tmp, 'noi-khac', 'theme-hai');
    await cp(FIXTURE, other, { recursive: true });
  });

  afterEach(() => {
    process.env.THEMEGRAPH_HOME = previousHome;
  });

  const dataDir = (root: string) => path.join(root, '.themegraph');

  describe('list', () => {
    it('nói rõ khi chưa có theme nào', async () => {
      const result = await runCli(['list']);

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('Chưa có theme nào được phân tích. Chạy "themegraph analyze" trong thư mục một theme.');
    });

    it('hiện mọi theme đã phân tích, dù chúng nằm ở những nơi khác nhau', async () => {
      await runCli(['analyze', themeRoot]);
      await runCli(['analyze', other]);

      const lines = (await runCli(['list'])).stdout.split('\n');

      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('Theme đã phân tích (2):');
      expect(lines[1]).toMatch(/^ {2}mini-theme {2}22 node {2}22 cạnh {2}\d{4}-\d\d-\d\d \d\d:\d\d {2}/);
      expect(lines[1]?.endsWith(themeRoot)).toBe(true);
      expect(lines[2]?.endsWith(other)).toBe(true);
      expect(lines[2]).toContain('theme-hai');
    });

    it('in thời điểm phân tích theo giờ của máy, dạng năm-tháng-ngày giờ:phút', async () => {
      // Dựng thời điểm từ các thành phần giờ địa phương, để test đúng ở mọi múi giờ.
      const analyzedAt = new Date(2026, 0, 5, 9, 7).toISOString();
      await mkdir(path.join(tmp, 'home'), { recursive: true });
      await writeFile(
        path.join(tmp, 'home', 'registry.json'),
        JSON.stringify({ version: 1, themes: [{ path: themeRoot, name: 'mini-theme', analyzedAt, nodes: 1, edges: 2 }] }),
      );

      expect((await runCli(['list'])).stdout).toContain('  mini-theme  1 node  2 cạnh  2026-01-05 09:07  ');
    });

    it('chạy được từ thư mục không phải theme', async () => {
      await runCli(['analyze', themeRoot]);
      const originalCwd = process.cwd();
      try {
        process.chdir(os.tmpdir());
        expect((await runCli(['list'])).stdout).toContain('mini-theme');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('đánh dấu theme không còn graph.db và chỉ cách gỡ', async () => {
      await runCli(['analyze', themeRoot]);
      await runCli(['analyze', other]);
      await rm(other, { recursive: true });

      const result = await runCli(['list']);
      const lines = result.stdout.split('\n');

      expect(lines[1]).not.toContain('không còn graph.db');
      expect(lines[2]?.endsWith('(không còn graph.db)')).toBe(true);
      expect(lines.at(-1)).toContain('themegraph clean --theme');
    });

    it('không in lời chỉ cách gỡ khi mọi theme đều còn', async () => {
      await runCli(['analyze', themeRoot]);

      expect((await runCli(['list'])).stdout).not.toContain('themegraph clean');
    });

    it('in JSON với --json', async () => {
      await runCli(['analyze', themeRoot]);

      const json = JSON.parse((await runCli(['list', '--json'])).stdout) as { path: string; present: boolean }[];

      expect(json.map((t) => [t.path, t.present])).toEqual([[themeRoot, true]]);
    });

    it('trả mã 2 khi có tham số thừa', async () => {
      const result = await runCli(['list', 'thua']);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('list không nhận tham số');
    });
  });

  describe('status', () => {
    it('báo đồ thị còn mới khi đứng trong thư mục con của theme', async () => {
      await runCli(['analyze', themeRoot]);
      const originalCwd = process.cwd();
      let result;
      try {
        process.chdir(path.join(themeRoot, 'snippets'));
        result = await runCli(['status']);
      } finally {
        process.chdir(originalCwd);
      }

      const lines = result.stdout.split('\n');

      expect(result.code).toBe(0);
      expect(lines[0]).toBe(`Theme      ${themeRoot}`);
      expect(lines[1]).toBe('Đồ thị     22 node, 22 cạnh');
      expect(lines[2]).toMatch(/^Phân tích {2}\d{4}-\d\d-\d\d \d\d:\d\d bằng ThemeGraph \d+\.\d+\.\d+$/);
      expect(lines.slice(3)).toEqual(['', 'Trạng thái: MỚI. Không file nào đổi từ lần phân tích.']);
    });

    it('chạy đúng trên từng theme khi có hai theme', async () => {
      await runCli(['analyze', themeRoot]);
      await runCli(['analyze', other]);
      await writeFile(path.join(other, 'snippets', 'moi.liquid'), '<p></p>');

      expect((await runCli(['status', '-t', themeRoot])).stdout).toContain('Trạng thái: MỚI');
      expect((await runCli(['status', '-t', other])).stdout).toContain('Trạng thái: CŨ');
    });

    it('liệt kê file sửa, thêm và xoá khi đồ thị đã cũ', async () => {
      await runCli(['analyze', themeRoot]);
      await appendFile(path.join(themeRoot, 'sections', 'hero.liquid'), '<!-- sua -->');
      // Lưu lại mà không đổi nội dung thì không tính là sửa.
      const later = new Date(Date.now() + 3_600_000);
      await utimes(path.join(themeRoot, 'layout', 'theme.liquid'), later, later);
      await writeFile(path.join(themeRoot, 'snippets', 'moi.liquid'), '<p></p>');
      await rm(path.join(themeRoot, 'snippets', 'card.liquid'));

      const result = await runCli(['status', '-t', themeRoot]);

      expect(result.code).toBe(0);
      expect(result.stdout.split('\n').slice(4)).toEqual([
        'Trạng thái: CŨ. 3 file đã đổi từ lần phân tích; chạy "themegraph analyze" để cập nhật.',
        '  sửa   sections/hero.liquid',
        '  thêm  snippets/moi.liquid',
        '  xoá   snippets/card.liquid',
      ]);
    });

    it('trở lại MỚI sau khi phân tích lại', async () => {
      await runCli(['analyze', themeRoot]);
      await writeFile(path.join(themeRoot, 'snippets', 'moi.liquid'), '<p></p>');
      await runCli(['analyze', themeRoot]);

      expect((await runCli(['status', '-t', themeRoot])).stdout).toContain('Trạng thái: MỚI');
    });

    it('in JSON với --json', async () => {
      await runCli(['analyze', themeRoot]);

      const json = JSON.parse((await runCli(['status', '-t', themeRoot, '--json'])).stdout) as {
        themeRoot: string;
        stale: boolean;
      };

      expect(json).toMatchObject({ themeRoot, stale: false });
    });

    it('báo cần analyze và trả mã 1 khi theme chưa được phân tích', async () => {
      const fresh = path.join(tmp, 'chua-phan-tich');
      await mkdir(fresh);

      const result = await runCli(['status', '-t', fresh]);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('themegraph analyze');
    });

    it('trả mã 2 khi có tham số thừa', async () => {
      expect((await runCli(['status', 'thua'])).code).toBe(2);
    });
  });

  describe('clean', () => {
    it('xoá dữ liệu của theme đang đứng và in ra những gì đã xoá', async () => {
      await runCli(['analyze', themeRoot]);
      await runCli(['analyze', other]);
      const originalCwd = process.cwd();
      let result;
      try {
        process.chdir(path.join(themeRoot, 'sections'));
        result = await runCli(['clean']);
      } finally {
        process.chdir(originalCwd);
      }

      expect(result.code).toBe(0);
      expect(result.stdout.split('\n')).toEqual([
        `Đã xoá dữ liệu ThemeGraph của ${themeRoot}:`,
        `  ${path.join(dataDir(themeRoot), 'graph.db')}`,
        `  ${path.join(dataDir(themeRoot), '.gitignore')}`,
        '  mục của theme trong sổ đăng ký',
      ]);
      expect(existsSync(dataDir(themeRoot))).toBe(false);
      // Theme kia không bị đụng tới.
      expect(existsSync(path.join(dataDir(other), 'graph.db'))).toBe(true);
      expect((await runCli(['list'])).stdout).not.toContain(themeRoot);
    });

    it('nhận --theme', async () => {
      await runCli(['analyze', themeRoot]);

      const result = await runCli(['clean', '--theme', themeRoot]);

      expect(result.stdout).toContain(`Đã xoá dữ liệu ThemeGraph của ${themeRoot}:`);
      expect(existsSync(dataDir(themeRoot))).toBe(false);
    });

    it('nói rõ khi không có gì để xoá, và vẫn trả mã 0', async () => {
      const fresh = path.join(tmp, 'chua-phan-tich');
      await mkdir(fresh);

      const result = await runCli(['clean', '-t', fresh]);

      expect(result.code).toBe(0);
      expect(result.stdout).toBe(`Không có dữ liệu ThemeGraph nào của ${fresh}.`);
    });

    it('gỡ mục trong sổ đăng ký khi đứng trong thư mục con của theme đã mất graph.db', async () => {
      await runCli(['analyze', themeRoot]);
      await rm(dataDir(themeRoot), { recursive: true });
      const originalCwd = process.cwd();
      let result;
      try {
        process.chdir(path.join(themeRoot, 'sections'));
        result = await runCli(['clean']);
      } finally {
        process.chdir(originalCwd);
      }

      expect(result.stdout.split('\n')).toEqual([
        `Đã xoá dữ liệu ThemeGraph của ${themeRoot}:`,
        '  mục của theme trong sổ đăng ký',
      ]);
      expect((await runCli(['list'])).stdout).toContain('Chưa có theme nào');
    });

    it('tìm ra theme từ thư mục con dù theme không có trong sổ đăng ký', async () => {
      await runCli(['analyze', themeRoot]);
      await rm(path.join(tmp, 'home'), { recursive: true });
      const originalCwd = process.cwd();
      try {
        process.chdir(path.join(themeRoot, 'sections'));
        await runCli(['clean']);
      } finally {
        process.chdir(originalCwd);
      }

      expect(existsSync(dataDir(themeRoot))).toBe(false);
    });

    it('không in dòng sổ đăng ký khi theme vốn không có trong sổ', async () => {
      await runCli(['analyze', themeRoot]);
      await runCli(['clean', '-t', themeRoot]);
      // Dựng lại thư mục dữ liệu bằng tay, không qua analyze: không có mục trong sổ.
      await mkdir(dataDir(themeRoot));
      await writeFile(path.join(dataDir(themeRoot), 'graph.db'), 'x');

      const result = await runCli(['clean', '-t', themeRoot]);

      expect(result.stdout.split('\n')).toEqual([
        `Đã xoá dữ liệu ThemeGraph của ${themeRoot}:`,
        `  ${path.join(dataDir(themeRoot), 'graph.db')}`,
      ]);
    });

    it('--all xoá dữ liệu của mọi theme trong sổ, kể cả theme đã bị xoá khỏi đĩa', async () => {
      await runCli(['analyze', themeRoot]);
      await runCli(['analyze', other]);
      await rm(other, { recursive: true });

      const result = await runCli(['clean', '--all']);

      expect(result.code).toBe(0);
      expect(result.stdout.split('\n')).toEqual([
        `Đã xoá dữ liệu ThemeGraph của ${themeRoot}:`,
        `  ${path.join(dataDir(themeRoot), 'graph.db')}`,
        `  ${path.join(dataDir(themeRoot), '.gitignore')}`,
        '  mục của theme trong sổ đăng ký',
        `Đã xoá dữ liệu ThemeGraph của ${other}:`,
        '  mục của theme trong sổ đăng ký',
      ]);
      expect((await runCli(['list'])).stdout).toContain('Chưa có theme nào');
    });

    it('--all nói rõ khi sổ đăng ký trống', async () => {
      const result = await runCli(['clean', '--all']);

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('Sổ đăng ký trống, không có gì để xoá.');
    });

    it('--all không xoá theme đang đứng nếu nó không có trong sổ', async () => {
      await runCli(['analyze', themeRoot]);
      await runCli(['clean', '-t', themeRoot]);
      await mkdir(dataDir(themeRoot));
      await writeFile(path.join(dataDir(themeRoot), 'graph.db'), 'x');

      await runCli(['clean', '--all']);

      expect(existsSync(path.join(dataDir(themeRoot), 'graph.db'))).toBe(true);
    });

    it('từ chối --all đi cùng --theme, và không xoá gì', async () => {
      await runCli(['analyze', themeRoot]);

      const result = await runCli(['clean', '--all', '-t', themeRoot]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--all hoặc --theme');
      expect(existsSync(path.join(dataDir(themeRoot), 'graph.db'))).toBe(true);
    });

    it('in JSON với --json', async () => {
      await runCli(['analyze', themeRoot]);

      const json = JSON.parse((await runCli(['clean', '-t', themeRoot, '--json'])).stdout) as {
        themeRoot: string;
        unregistered: boolean;
      }[];

      expect(json).toHaveLength(1);
      expect(json[0]).toMatchObject({ themeRoot, unregistered: true });
    });

    it('trả mã 2 khi có tham số thừa, và không xoá gì', async () => {
      await runCli(['analyze', themeRoot]);

      const result = await runCli(['clean', themeRoot]);

      expect(result.code).toBe(2);
      expect(existsSync(path.join(dataDir(themeRoot), 'graph.db'))).toBe(true);
    });
  });

  describe('analyze và sổ đăng ký', () => {
    it('cảnh báo ra stderr nhưng vẫn thành công khi không ghi được sổ đăng ký', async () => {
      // Đường dẫn đi xuyên qua một FILE: không tạo được thư mục ở đó.
      process.env.THEMEGRAPH_HOME = path.join(themeRoot, 'layout', 'theme.liquid', 'home');

      const result = await runCli(['analyze', themeRoot]);

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/Node\s+22\b/);
      expect(result.stderr).toContain('Cảnh báo: không ghi được theme vào sổ đăng ký');
      expect(result.stderr).toContain('registry.json');
    });

    it('không cảnh báo gì khi ghi được', async () => {
      expect((await runCli(['analyze', themeRoot])).stderr).toBe('');
    });
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
    for (const command of ['list', 'status', 'clean', 'impact', 'render-flow', 'context', 'dead-code', 'verify']) {
      expect(help.stdout).toContain(`themegraph ${command}`);
    }
    expect(help.stdout).toContain('--theme');
    expect(help.stdout).toContain('--json');
    expect(help.stdout).toContain('--all');
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

    expect(stdout).toMatch(/Node\s+22\b/);
    expect(existsSync(path.join(themeRoot, '.themegraph', 'graph.db'))).toBe(true);
  });

  it('chạy được lệnh truy vấn từ thư mục con của theme, không in gì ra stderr', async () => {
    execFileSync(process.execPath, [BUILT_BIN, 'analyze', themeRoot], { cwd: os.tmpdir(), stdio: 'pipe' });
    await mkdir(path.join(themeRoot, 'snippets'), { recursive: true });

    const result = spawnSync(process.execPath, [BUILT_BIN, 'impact', 'card.liquid'], {
      cwd: path.join(themeRoot, 'snippets'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Sửa snippets/card.liquid');
    // Node 22 in cảnh báo "SQLite is an experimental feature" ra stderr mỗi
    // khi nạp node:sqlite; cli.ts phải chặn nó.
    expect(result.stderr).toBe('');
  });

  it('qua tiến trình thật: hai theme ở hai nơi, list thấy cả hai, status đúng trong từng theme', async () => {
    const home = path.join(tmp, 'home-that');
    const other = path.join(tmp, 'noi-khac', 'theme-hai');
    await cp(FIXTURE, other, { recursive: true });

    const cli = (args: string[], cwd: string) =>
      spawnSync(process.execPath, [BUILT_BIN, ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, THEMEGRAPH_HOME: home },
      });

    expect(cli(['analyze'], themeRoot).status).toBe(0);
    expect(cli(['analyze'], other).status).toBe(0);
    await writeFile(path.join(other, 'snippets', 'moi.liquid'), '<p></p>');

    const list = cli(['list'], os.tmpdir());
    expect(list.stdout).toContain(themeRoot);
    expect(list.stdout).toContain(other);
    expect(list.stderr).toBe('');

    expect(cli(['status'], path.join(themeRoot, 'sections')).stdout).toContain('Trạng thái: MỚI');
    expect(cli(['status'], path.join(other, 'sections')).stdout).toContain('Trạng thái: CŨ');

    expect(cli(['clean', '--all'], os.tmpdir()).status).toBe(0);
    expect(cli(['list'], os.tmpdir()).stdout).toContain('Chưa có theme nào');
    expect(existsSync(path.join(themeRoot, '.themegraph'))).toBe(false);
  });

  it('trả mã 1 qua tiến trình thật khi verify không đạt', () => {
    execFileSync(process.execPath, [BUILT_BIN, 'analyze', themeRoot], { cwd: os.tmpdir(), stdio: 'pipe' });
    const db = new DatabaseSync(path.join(themeRoot, '.themegraph', 'graph.db'));
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec("INSERT INTO edges VALUES ('assets/base.css', 'snippets/ma.liquid', 'RENDERS', 0, 'liquid', 1)");
    db.close();

    const result = spawnSync(process.execPath, [BUILT_BIN, 'verify'], { cwd: themeRoot, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('KHÔNG ĐẠT');
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

describe('themegraph setup', () => {
  let home: string;

  beforeEach(async () => {
    // Thư mục home GIẢ, và một lệnh claude "không có trên máy": lệnh setup
    // trong các test này không bao giờ chạm cấu hình thật của người chạy test.
    home = path.join(tmp, 'home');
    await mkdir(path.join(home, '.cursor'), { recursive: true });
    await mkdir(path.join(home, '.claude'), { recursive: true });
  });

  async function runSetup(args: string[], overrides: Parameters<typeof run>[2] = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(
      ['setup', ...args],
      { stdout: (line) => out.push(line), stderr: (line) => err.push(line) },
      { setup: { homeDir: home, runClaude: () => null, ...overrides?.setup } },
    );
    return { code, stdout: out.join('\n'), stderr: err.join('\n') };
  }

  const cursorConfig = () => path.join(home, '.cursor', 'mcp.json');
  const skillFile = () => path.join(home, '.claude', 'skills', 'themegraph', 'SKILL.md');

  it('cấu hình các client tìm thấy và in mỗi bước một dòng', async () => {
    const result = await runSetup([]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Nối ThemeGraph vào các AI agent:');
    expect(result.stdout).toMatch(/Claude Code\s+bỏ qua/);
    expect(result.stdout).toMatch(/Skill cho Claude Code\s+xong/);
    expect(result.stdout).toMatch(/Cursor\s+xong/);
    expect(result.stdout).toContain('Khởi động lại');
    expect(existsSync(skillFile())).toBe(true);
  });

  it('ghi cấu hình trỏ tới node đang chạy và file cli.js nằm cạnh run.js', async () => {
    await runSetup([]);
    const config = JSON.parse(await readFile(cursorConfig(), 'utf8')) as {
      mcpServers: { themegraph: { command: string; args: string[] } };
    };

    expect(config.mcpServers.themegraph.command).toBe(process.execPath);
    // Test chạy trên mã nguồn nên "cạnh run.js" là src/; bản đã build là dist/.
    expect(config.mcpServers.themegraph.args).toEqual([path.join(import.meta.dirname, '../src/cli.js'), 'mcp']);
    expect(path.isAbsolute(config.mcpServers.themegraph.args[0] ?? '')).toBe(true);
  });

  it('skill được cài là file đi kèm gói', async () => {
    await runSetup([]);

    expect(await readFile(skillFile(), 'utf8')).toBe(
      await readFile(path.join(import.meta.dirname, '../skills/themegraph/SKILL.md'), 'utf8'),
    );
  });

  it('--dry-run chỉ báo việc sẽ làm', async () => {
    const result = await runSetup(['--dry-run']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('(chạy thử, không ghi gì)');
    expect(result.stdout).toMatch(/Cursor\s+sẽ làm/);
    expect(existsSync(cursorConfig())).toBe(false);
    expect(existsSync(skillFile())).toBe(false);
  });

  it('--remove gỡ những gì đã cài', async () => {
    await runSetup([]);
    const result = await runSetup(['--remove']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Gỡ ThemeGraph khỏi các AI agent:');
    expect(existsSync(skillFile())).toBe(false);
    expect(JSON.parse(await readFile(cursorConfig(), 'utf8'))).toEqual({ mcpServers: {} });
  });

  it('in JSON với --json', async () => {
    const result = await runSetup(['--json']);
    const steps = JSON.parse(result.stdout) as { target: string; outcome: string }[];

    expect(steps.map((step) => [step.target, step.outcome])).toEqual([
      ['Claude Code', 'skipped'],
      ['Skill cho Claude Code', 'done'],
      ['Cursor', 'done'],
    ]);
  });

  it('trả mã 1 khi có bước không ghi được, nhưng vẫn in kết quả của mọi bước', async () => {
    await writeFile(cursorConfig(), 'không phải json');

    const result = await runSetup([]);

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/Cursor\s+LỖI/);
    expect(result.stdout).toMatch(/Skill cho Claude Code\s+xong/);
  });

  it('trả mã 2 khi có tham số thừa', async () => {
    const result = await runSetup(['thua']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('themegraph setup không nhận tham số nào');
  });
});

describe('themegraph mcp', () => {
  it('trả mã 2 khi có tham số thừa, và không in gì ra stdout', async () => {
    const result = await runCli(['mcp', 'thua']);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('themegraph mcp không nhận tham số nào');
  });

  it('có mặt trong hướng dẫn cùng lệnh setup', async () => {
    const result = await runCli(['--help']);

    expect(result.stdout).toContain('themegraph setup');
    expect(result.stdout).toContain('themegraph mcp');
    expect(result.stdout).toContain('themegraph search');
  });
});

describe('themegraph overview', () => {
  beforeEach(async () => {
    await runCli(['analyze', themeRoot]);
  });

  it('in số liệu của theme và các file được gọi nhiều nhất', async () => {
    const result = await runCli(['overview', '-t', themeRoot]);
    const lines = result.stdout.split('\n');

    expect(result.code).toBe(0);
    expect(lines[0]).toBe(`Theme            ${themeRoot}`);
    expect(lines[1]).toMatch(/^Phân tích {8}\d{4}-\d{2}-\d{2} \d{2}:\d{2} bằng ThemeGraph /);
    expect(lines[2]).toMatch(/^Node {13}22 {2}\(asset 1, block 1, /);
    expect(lines[3]).toMatch(/^Cạnh {13}22 {2}\(/);
    expect(lines[4]).toBe('Trang            4  (customers/login, gift_card, index, product)');
    expect(lines[5]).toBe('Tham chiếu hỏng  2');
    expect(lines[6]).toBe('File không dùng  0 chắc chắn, 0 cần xem lại');
    expect(lines[7]).toBe('Không thấy dùng  0 khoá dịch, 0 setting');
    expect(lines[8]).toBe('');
    expect(lines[9]).toBe('File được nhiều nơi gọi nhất:');
    // layout, hero và card đều có ba nơi gọi; card được block text, section hero và
    // template gift_card gọi. Bằng nhau nên xếp theo id.
    expect(lines[10]).toBe('  3  layout/theme.liquid         layout');
    expect(lines[11]).toBe('  3  sections/hero.liquid        section');
    expect(lines[12]).toBe('  3  snippets/card.liquid        snippet');
  });

  it('in JSON với --json', async () => {
    const result = await runCli(['overview', '-t', themeRoot, '--json']);
    const json = JSON.parse(result.stdout) as { nodes: number; pages: string[]; brokenRefs: number };

    expect(json.nodes).toBe(22);
    expect(json.pages).toHaveLength(4);
    expect(json.brokenRefs).toBe(2);
  });

  it('trả mã 2 khi có tham số thừa', async () => {
    const result = await runCli(['overview', 'thua', '-t', themeRoot]);

    expect(result.code).toBe(2);
  });
});

describe('themegraph serve', () => {
  type Serving = { port: number; url: string; close(): Promise<void> };
  let serving: Serving | undefined;

  afterEach(async () => {
    await serving?.close();
    serving = undefined;
  });

  /** Chạy lệnh serve trên một cổng do hệ điều hành chọn và giữ lại server để tắt. */
  async function serve(args: string[] = ['--port', '0']) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(
      ['serve', ...args],
      { stdout: (line) => out.push(line), stderr: (line) => err.push(line) },
      { onServing: (server) => (serving = server) },
    );
    return { code, stdout: out.join('\n'), stderr: err.join('\n') };
  }

  it('chạy server, in địa chỉ, và phục vụ API', async () => {
    await runCli(['analyze', themeRoot]);

    const result = await serve();

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.split('\n')).toEqual([
      `ThemeGraph đang chạy ở http://localhost:${serving?.port}`,
      'Bấm Ctrl+C để dừng.',
    ]);

    const themes = (await (await fetch(`${serving?.url}/api/themes`)).json()) as { name: string }[];
    expect(themes.map((theme) => theme.name)).toContain('mini-theme');
  });

  it('phục vụ giao diện web đã build ở trang gốc', async () => {
    await serve();

    const page = await fetch(`${serving?.url}/`);
    const html = await page.text();

    // pnpm test build mọi gói trước khi chạy test, nên bản build luôn có.
    expect(page.status).toBe(200);
    expect(html).toContain('<div id="root"></div>');

    // File JavaScript mà trang nêu ra phải tải được.
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(script).toBeDefined();
    const asset = await fetch(`${serving?.url}${script}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });

  it('báo lỗi và trả mã 1 khi cổng đang bận, kèm cách chữa', async () => {
    await serve();
    const busy = serving?.port ?? 0;
    const first = serving;

    const second = await serve(['--port', String(busy)]);
    serving = first;

    expect(second.code).toBe(1);
    expect(second.stdout).toBe('');
    expect(second.stderr).toContain(`cổng ${busy} đang được dùng`);
    expect(second.stderr).toContain(`themegraph serve --port ${busy + 1}`);
  });

  it('trả mã 2 khi --port không hợp lệ hoặc có tham số thừa', async () => {
    for (const bad of ['abc', '-1', '70000', '1.5']) {
      const result = await runCli(['serve', `--port=${bad}`]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--port cần một số nguyên từ 0 tới 65535');
    }
    expect((await runCli(['serve', 'thua'])).code).toBe(2);
  });
});
