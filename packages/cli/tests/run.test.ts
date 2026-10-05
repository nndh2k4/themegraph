import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
      '  gift_card        cách 2 tầng',
      '  index            cách 3 tầng',
      '  product          cách 3 tầng  [có điều kiện]',
      '  customers/login  cách 5 tầng  [có điều kiện]',
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
      '  section: không có preset và không template nào dùng, nhưng JavaScript của theme có thể vẫn tải nó qua Section Rendering API.',
      '  asset: có thể được gọi bằng tên ghép lúc chạy, hoặc từ bên trong một file CSS / JavaScript.',
      '  File khác trong mục này: chỉ được gọi bởi một file cần xem lại.',
    ]);
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
    for (const command of ['impact', 'render-flow', 'context', 'dead-code', 'verify']) {
      expect(help.stdout).toContain(`themegraph ${command}`);
    }
    expect(help.stdout).toContain('--theme');
    expect(help.stdout).toContain('--json');
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
