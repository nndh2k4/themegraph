import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildGraph } from '../src/graph.js';
import { graphDbPath, saveGraph, SCHEMA_VERSION } from '../src/store.js';
import type { FileKind, RawRef, RefKind, RefSource, ThemeFile, ThemeGraph } from '../src/types.js';

const file = (p: string, kind: FileKind): ThemeFile => ({
  path: p,
  kind,
  ext: p.slice(p.lastIndexOf('.') + 1),
});

const ref = (
  from: string,
  kind: RefKind,
  to: string,
  extra: { source?: RefSource; conditional?: boolean; line?: number } = {},
): RawRef => ({
  from,
  to,
  kind,
  source: extra.source ?? 'liquid',
  conditional: extra.conditional ?? false,
  line: extra.line ?? 1,
});

/**
 * Đồ thị mẫu: hai trang cùng đi tới snippets/price.liquid qua nhiều tầng.
 *
 *   page:product    -> templates/product.json    -> sections/main-product.liquid -> snippets/card.liquid -> snippets/price.liquid
 *   page:collection -> templates/collection.json -> sections/grid.liquid         -> snippets/card.liquid
 *   page:cart       -> templates/cart.json       -> sections/cart.liquid   (không dùng card hay price)
 */
function sampleGraph(): ThemeGraph {
  const files = [
    file('layout/theme.liquid', 'layout'),
    file('templates/product.json', 'template'),
    file('templates/collection.json', 'template'),
    file('templates/cart.json', 'template'),
    file('sections/main-product.liquid', 'section'),
    file('sections/grid.liquid', 'section'),
    file('sections/cart.liquid', 'section'),
    file('snippets/card.liquid', 'snippet'),
    file('snippets/price.liquid', 'snippet'),
    file('snippets/orphan.liquid', 'snippet'),
    file('assets/base.css', 'asset'),
  ];
  const refs = [
    ref('templates/product.json', 'section', 'main-product', { source: 'json', line: 0 }),
    ref('templates/collection.json', 'section', 'grid', { source: 'json', line: 0 }),
    ref('templates/cart.json', 'section', 'cart', { source: 'json', line: 0 }),
    ref('sections/main-product.liquid', 'render', 'card', { line: 4 }),
    ref('sections/grid.liquid', 'render', 'card', { line: 9, conditional: true }),
    ref('snippets/card.liquid', 'render', 'price', { line: 12 }),
    ref('snippets/card.liquid', 'render', 'price', { line: 30 }),
    ref('snippets/card.liquid', 'render', 'da-xoa', { line: 40 }),
    ref('layout/theme.liquid', 'asset', 'base.css', { line: 2 }),
  ];
  const schemas = [
    { file: 'sections/main-product.liquid', presets: 2, acceptsThemeBlocks: true },
    { file: 'sections/grid.liquid', presets: 0, acceptsThemeBlocks: false },
  ];
  return buildGraph(files, refs, { schemas });
}

let themeRoot: string;

beforeEach(async () => {
  // Mỗi test một thư mục "theme" riêng trong thư mục tạm của hệ điều hành,
  // nằm hẳn ngoài repo: đúng điều kiện mà công cụ sẽ gặp khi dùng thật.
  themeRoot = await mkdtemp(path.join(os.tmpdir(), 'themegraph-store-'));
});

afterEach(async () => {
  await rm(themeRoot, { recursive: true, force: true });
});

/** Mở database vừa ghi, chạy một việc, rồi luôn đóng lại. */
function withDb<T>(run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(graphDbPath(themeRoot), { readOnly: true });
  try {
    return run(db);
  } finally {
    db.close();
  }
}

describe('saveGraph — file trên đĩa', () => {
  it('ghi database vào <theme>/.themegraph/graph.db', () => {
    saveGraph(themeRoot, sampleGraph());

    expect(graphDbPath(themeRoot)).toBe(path.join(themeRoot, '.themegraph', 'graph.db'));
    expect(existsSync(graphDbPath(themeRoot))).toBe(true);
  });

  it('tạo .gitignore chứa * để thư mục .themegraph tự loại khỏi git', async () => {
    saveGraph(themeRoot, sampleGraph());

    const content = await readFile(path.join(themeRoot, '.themegraph', '.gitignore'), 'utf8');

    expect(content.trim()).toBe('*');
  });

  it('chỉ để lại đúng hai file, không sót file tạm', async () => {
    saveGraph(themeRoot, sampleGraph());

    expect((await readdir(path.join(themeRoot, '.themegraph'))).sort()).toEqual(['.gitignore', 'graph.db']);
  });

  it('ghi được dù còn file tạm sót lại từ một lần chạy bị ngắt', async () => {
    // Lần chạy trước chết giữa chừng để lại graph.db.tmp đã có sẵn bảng.
    saveGraph(themeRoot, sampleGraph());
    const dir = path.join(themeRoot, '.themegraph');
    await writeFile(path.join(dir, 'graph.db.tmp'), await readFile(path.join(dir, 'graph.db')));

    expect(() => saveGraph(themeRoot, sampleGraph())).not.toThrow();
    expect((await readdir(dir)).sort()).toEqual(['.gitignore', 'graph.db']);
  });

  it('dọn file -wal và -shm của database cũ khi ghi đè', async () => {
    // Một database cũ ở chế độ WAL để lại hai file phụ. Nếu chúng còn đó sau
    // khi graph.db được thay, SQLite sẽ áp nhật ký cũ vào database mới.
    saveGraph(themeRoot, sampleGraph());
    const dir = path.join(themeRoot, '.themegraph');
    await writeFile(path.join(dir, 'graph.db-wal'), 'rac');
    await writeFile(path.join(dir, 'graph.db-shm'), 'rac');

    saveGraph(themeRoot, sampleGraph());

    expect((await readdir(dir)).sort()).toEqual(['.gitignore', 'graph.db']);
  });
});

describe('saveGraph — nội dung', () => {
  it('ghi đủ node, cạnh và ref', () => {
    const graph = sampleGraph();
    saveGraph(themeRoot, graph);

    const counts = withDb((db) => ({
      nodes: db.prepare('SELECT count(*) AS n FROM nodes').get()?.n,
      edges: db.prepare('SELECT count(*) AS n FROM edges').get()?.n,
      refs: db.prepare('SELECT count(*) AS n FROM refs').get()?.n,
    }));

    expect(counts).toEqual({
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      refs: graph.refs.length,
    });
  });

  it('giữ nguyên thuộc tính của cạnh', () => {
    saveGraph(themeRoot, sampleGraph());

    const edge = withDb((db) =>
      db
        .prepare('SELECT type, conditional, sources, count FROM edges WHERE src = ? AND dst = ?')
        .get('snippets/card.liquid', 'snippets/price.liquid'),
    );

    // Hai lời gọi ở dòng 12 và 30 gộp thành một cạnh.
    expect({ ...edge }).toEqual({ type: 'RENDERS', conditional: 0, sources: 'liquid', count: 2 });
  });

  it('ghi conditional thành 1 cho cạnh có điều kiện và 0 cho cạnh không', () => {
    saveGraph(themeRoot, sampleGraph());

    const flags = withDb((db) =>
      db
        .prepare('SELECT src, conditional FROM edges WHERE dst = ? ORDER BY src')
        .all('snippets/card.liquid')
        .map((r) => [r.src, r.conditional]),
    );

    // sections/grid.liquid gọi card bên trong một điều kiện.
    expect(flags).toEqual([
      ['sections/grid.liquid', 1],
      ['sections/main-product.liquid', 0],
    ]);
  });

  it('giữ từng lời gọi riêng lẻ trong bảng refs, kể cả tham chiếu hỏng', () => {
    saveGraph(themeRoot, sampleGraph());

    const rows = withDb((db) =>
      db
        .prepare('SELECT name, line, status, target FROM refs WHERE src = ? ORDER BY line')
        .all('snippets/card.liquid'),
    );

    expect(rows.map((r) => ({ ...r }))).toEqual([
      { name: 'price', line: 12, status: 'resolved', target: 'snippets/price.liquid' },
      { name: 'price', line: 30, status: 'resolved', target: 'snippets/price.liquid' },
      { name: 'da-xoa', line: 40, status: 'missing', target: 'snippets/da-xoa.liquid' },
    ]);
  });

  it('ghi dữ kiện schema của từng file vào bảng schemas', () => {
    saveGraph(themeRoot, sampleGraph());

    const rows = withDb((db) =>
      db
        .prepare('SELECT file, presets, accepts_theme_blocks FROM schemas ORDER BY file')
        .all()
        .map((r) => ({ ...r })),
    );

    expect(rows).toEqual([
      { file: 'sections/grid.liquid', presets: 0, accepts_theme_blocks: 0 },
      { file: 'sections/main-product.liquid', presets: 2, accepts_theme_blocks: 1 },
    ]);
  });

  it('database từ chối schema của file không phải node', () => {
    const graph = sampleGraph();
    graph.schemas.push({ file: 'sections/khong-co.liquid', presets: 1, acceptsThemeBlocks: false });

    expect(() => saveGraph(themeRoot, graph)).toThrow(/FOREIGN KEY/);
    // Ghi thất bại thì không được để lại graph.db dở dang hay file tạm.
    expect(existsSync(graphDbPath(themeRoot))).toBe(false);
  });

  it('ghi phiên bản lược đồ và thời điểm phân tích vào bảng meta', () => {
    saveGraph(themeRoot, sampleGraph(), { analyzedAt: new Date('2026-10-05T08:00:00.000Z') });

    const meta = withDb((db) =>
      Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value])),
    );

    expect(meta.schema_version).toBe(String(SCHEMA_VERSION));
    expect(meta.analyzed_at).toBe('2026-10-05T08:00:00.000Z');
    expect(meta.tool_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('thay hẳn nội dung cũ khi ghi lần hai, không cộng dồn', () => {
    const big = sampleGraph();
    const small = buildGraph([file('layout/theme.liquid', 'layout')], []);

    saveGraph(themeRoot, big);
    saveGraph(themeRoot, small);

    const nodeIds = withDb((db) => db.prepare('SELECT id FROM nodes').all().map((r) => r.id));

    expect(nodeIds).toEqual(['layout/theme.liquid']);
  });

  it('ghi hai lần cùng một đồ thị cho cùng nội dung bảng', () => {
    const dump = () =>
      withDb((db) => ({
        nodes: db.prepare('SELECT * FROM nodes ORDER BY id').all(),
        edges: db.prepare('SELECT * FROM edges ORDER BY src, dst, type').all(),
        refs: db.prepare('SELECT * FROM refs ORDER BY id').all(),
        schemas: db.prepare('SELECT * FROM schemas ORDER BY file').all(),
      }));

    saveGraph(themeRoot, sampleGraph());
    const first = dump();
    saveGraph(themeRoot, sampleGraph());

    expect(dump()).toEqual(first);
  });
});

describe('saveGraph — tính toàn vẹn và truy vấn', () => {
  it('không có cạnh nào trỏ vào node không tồn tại', () => {
    saveGraph(themeRoot, sampleGraph());

    const dangling = withDb(
      (db) =>
        db
          .prepare(
            `SELECT count(*) AS n FROM edges
             WHERE src NOT IN (SELECT id FROM nodes) OR dst NOT IN (SELECT id FROM nodes)`,
          )
          .get()?.n,
    );

    expect(dangling).toBe(0);
  });

  it('database từ chối cạnh trỏ vào node không tồn tại', () => {
    saveGraph(themeRoot, sampleGraph());

    const db = new DatabaseSync(graphDbPath(themeRoot));
    try {
      db.exec('PRAGMA foreign_keys = ON');
      const insert = db.prepare(
        'INSERT INTO edges (src, dst, type, conditional, sources, count) VALUES (?, ?, ?, 0, ?, 1)',
      );

      expect(() => insert.run('snippets/card.liquid', 'snippets/khong-co.liquid', 'RENDERS', 'liquid')).toThrow(
        /FOREIGN KEY/,
      );
    } finally {
      db.close();
    }
  });

  it('truy vấn đệ quy NGƯỢC: sửa snippets/price.liquid thì trang nào bị ảnh hưởng', () => {
    saveGraph(themeRoot, sampleGraph());

    // Bắt đầu từ một node, lặp lại bước "ai trỏ tới node này" cho tới khi
    // không còn node mới. UNION (không phải UNION ALL) loại node đã gặp, nên
    // truy vấn dừng được cả khi đồ thị có vòng.
    const pages = withDb((db) =>
      db
        .prepare(
          `WITH RECURSIVE affected(id) AS (
             SELECT ?
             UNION
             SELECT e.src FROM edges e JOIN affected a ON e.dst = a.id
           )
           SELECT n.id FROM affected a JOIN nodes n ON n.id = a.id
           WHERE n.kind = 'page_type' ORDER BY n.id`,
        )
        .all('snippets/price.liquid')
        .map((r) => r.id),
    );

    // Trang cart không dùng card hay price nên không bị ảnh hưởng.
    expect(pages).toEqual(['page:collection', 'page:product']);
  });

  it('truy vấn đệ quy XUÔI: trang product render những file nào, sâu mấy tầng', () => {
    saveGraph(themeRoot, sampleGraph());

    const rows = withDb((db) =>
      db
        .prepare(
          `WITH RECURSIVE reach(id, depth) AS (
             SELECT ?, 0
             UNION
             SELECT e.dst, r.depth + 1 FROM edges e JOIN reach r ON e.src = r.id
             WHERE e.type IN ('USES_TEMPLATE', 'RENDERS')
           )
           SELECT id, min(depth) AS depth FROM reach GROUP BY id ORDER BY depth, id`,
        )
        .all('page:product')
        .map((r) => [r.id, r.depth]),
    );

    expect(rows).toEqual([
      ['page:product', 0],
      ['templates/product.json', 1],
      ['sections/main-product.liquid', 2],
      ['snippets/card.liquid', 3],
      ['snippets/price.liquid', 4],
    ]);
  });

  it('truy vấn ngược dùng index trên cột dst, không quét cả bảng', () => {
    saveGraph(themeRoot, sampleGraph());

    const plan = withDb((db) =>
      db
        .prepare('EXPLAIN QUERY PLAN SELECT src FROM edges WHERE dst = ?')
        .all('snippets/price.liquid')
        .map((r) => String(r.detail))
        .join(' | '),
    );

    // "SEARCH ... USING INDEX" là tra theo index; "SCAN" là đọc từng dòng.
    expect(plan).toContain('edges_by_dst');
    expect(plan).not.toMatch(/^SCAN/);
  });
});
