import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openGraph } from '../src/open.js';
import type { GraphHandle } from '../src/open.js';
import { graphDbPath } from '../src/store.js';
import { bfsTraverse, diffTraversals, verify } from '../src/verify.js';
import type { PlainEdge } from '../src/verify.js';
import { queryGraph, removeTempTheme, saveToTempTheme } from './helpers.js';

const edge = (src: string, dst: string, conditional = false): PlainEdge => ({ src, dst, conditional });

/** Viết gọn kết quả duyệt thành { node: [độ sâu, chắc chắn] }. */
const brief = (reached: Map<string, { depth: number; certain: boolean }>) =>
  Object.fromEntries([...reached].map(([id, r]) => [id, [r.depth, r.certain]]));

describe('bfsTraverse', () => {
  it('tính độ sâu là số cạnh ít nhất, dù còn đường dài hơn', () => {
    // a -> b -> c -> d, và một lối tắt a -> c.
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'c')];

    expect(brief(bfsTraverse(edges, 'a', 'forward'))).toEqual({
      a: [0, true],
      b: [1, true],
      c: [1, true],
      d: [2, true],
    });
  });

  it('ghé node gần trước node xa, không đi sâu theo một nhánh trước', () => {
    // Tới c bằng hai đường: a -> b -> c (2 cạnh) và a -> x -> y -> c (3 cạnh).
    // Nếu đi hết nhánh x trước thì c sẽ bị ghi nhầm độ sâu 3.
    const edges = [edge('a', 'b'), edge('a', 'x'), edge('x', 'y'), edge('y', 'c'), edge('b', 'c')];

    expect(bfsTraverse(edges, 'a', 'forward').get('c')?.depth).toBe(2);
  });

  it('đi ngược chiều mũi tên khi được bảo', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('x', 'c')];

    expect(brief(bfsTraverse(edges, 'c', 'backward'))).toEqual({
      c: [0, true],
      b: [1, true],
      x: [1, true],
      a: [2, true],
    });
  });

  it('chỉ chắc chắn khi có đường đi toàn cạnh không điều kiện', () => {
    // Tới c bằng hai đường: a -> c có điều kiện, a -> b -> c thì không.
    const edges = [edge('a', 'c', true), edge('a', 'b'), edge('b', 'c'), edge('c', 'd', true)];

    expect(brief(bfsTraverse(edges, 'a', 'forward'))).toEqual({
      a: [0, true],
      b: [1, true],
      c: [1, true], // ngắn nhất là qua cạnh có điều kiện, nhưng vẫn có đường chắc chắn
      d: [2, false],
    });
  });

  it('dừng được khi đồ thị có vòng và có cạnh tự trỏ', () => {
    const edges = [edge('a', 'b'), edge('b', 'a'), edge('b', 'b'), edge('b', 'c')];

    expect(brief(bfsTraverse(edges, 'a', 'forward'))).toEqual({ a: [0, true], b: [1, true], c: [2, true] });
  });

  it('chỉ trả về node xuất phát khi nó không nối với ai', () => {
    expect(brief(bfsTraverse([edge('a', 'b')], 'z', 'forward'))).toEqual({ z: [0, true] });
  });
});

describe('diffTraversals', () => {
  const sqlRow = (id: string, depth: number, certain = true) => ({ id, kind: 'snippet' as const, depth, certain });

  it('không báo gì khi hai bên giống hệt nhau', () => {
    const bfs = new Map([
      ['a', { depth: 0, certain: true }],
      ['b', { depth: 1, certain: false }],
    ]);

    expect(diffTraversals('a', 'forward', [sqlRow('a', 0), sqlRow('b', 1, false)], bfs)).toEqual([]);
  });

  it('báo node khác độ sâu', () => {
    const bfs = new Map([['a', { depth: 2, certain: true }]]);

    expect(diffTraversals('s', 'backward', [sqlRow('a', 1)], bfs)).toEqual([
      {
        start: 's',
        direction: 'backward',
        node: 'a',
        sql: { depth: 1, certain: true },
        bfs: { depth: 2, certain: true },
      },
    ]);
  });

  it('báo node khác mức chắc chắn', () => {
    const bfs = new Map([['a', { depth: 1, certain: false }]]);

    expect(diffTraversals('s', 'forward', [sqlRow('a', 1, true)], bfs)).toHaveLength(1);
  });

  it('báo node chỉ một bên tới được, xếp theo tên', () => {
    const bfs = new Map([
      ['a', { depth: 0, certain: true }],
      ['chi-bfs', { depth: 1, certain: true }],
    ]);

    const result = diffTraversals('a', 'forward', [sqlRow('chi-sql', 1), sqlRow('a', 0)], bfs);

    expect(result.map((m) => [m.node, m.sql === null, m.bfs === null])).toEqual([
      ['chi-bfs', true, false],
      ['chi-sql', false, true],
    ]);
  });
});

describe('verify', () => {
  let themeRoot: string;
  let graph: GraphHandle | undefined;

  beforeEach(async () => {
    themeRoot = await saveToTempTheme(queryGraph());
  });

  afterEach(async () => {
    graph?.close();
    graph = undefined;
    await removeTempTheme(themeRoot);
  });

  it('xác nhận SQL và BFS khớp nhau trên mọi node của đồ thị mẫu', () => {
    graph = openGraph(themeRoot);
    const result = verify(graph);

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.integrity).toEqual([]);
  });

  it('báo số liệu của lần kiểm chứng', () => {
    graph = openGraph(themeRoot);
    const result = verify(graph);

    const count = (table: string) => Number(graph?.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);

    expect(result.nodes).toBe(count('nodes'));
    expect(result.edges).toBe(count('edges'));
    expect(result.traversals).toBe(result.nodes * 2);
    // Mỗi phép duyệt so ít nhất chính node xuất phát.
    expect(result.comparisons).toBeGreaterThan(result.traversals);
    // Đường dài nhất: page:product -> template -> layout -> header-group -> header -> menu.
    expect(result.maxDepth).toBe(5);
    // menu tự gọi mình; a và b gọi lẫn nhau.
    expect(result.nodesOnCycles).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('phát hiện cạnh trỏ tới node không tồn tại', () => {
    // Chèn thẳng vào database một cạnh hỏng, điều mà saveGraph không cho phép.
    const db = new DatabaseSync(graphDbPath(themeRoot));
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare("INSERT INTO edges (src, dst, type, conditional, sources, count) VALUES (?, ?, 'RENDERS', 0, 'liquid', 1)").run(
      'snippets/price.liquid',
      'snippets/ma.liquid',
    );
    db.close();

    graph = openGraph(themeRoot);
    const result = verify(graph);

    expect(result.ok).toBe(false);
    expect(result.integrity).toHaveLength(1);
    expect(result.integrity[0]).toContain('edges');
    expect(result.integrity[0]).toContain('nodes');

    // Truy vấn SQL nối với bảng nodes nên không thấy node ma; BFS thì thấy.
    const ghost = result.mismatches.find((m) => m.start === 'snippets/price.liquid' && m.direction === 'forward');

    expect(ghost).toEqual({
      start: 'snippets/price.liquid',
      direction: 'forward',
      node: 'snippets/ma.liquid',
      sql: null,
      bfs: { depth: 1, certain: true },
    });
  });

  it('đối chiếu cả chiều ngược: phát hiện cạnh đi ra từ node không tồn tại', () => {
    const db = new DatabaseSync(graphDbPath(themeRoot));
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare("INSERT INTO edges (src, dst, type, conditional, sources, count) VALUES (?, ?, 'RENDERS', 1, 'liquid', 1)").run(
      'snippets/ma.liquid',
      'assets/unused.png',
    );
    db.close();

    graph = openGraph(themeRoot);
    const result = verify(graph);

    // unused.png vốn không ai trỏ tới, nên sai khác duy nhất nằm ở chiều ngược.
    expect(result.mismatches).toEqual([
      {
        start: 'assets/unused.png',
        direction: 'backward',
        node: 'snippets/ma.liquid',
        sql: null,
        bfs: { depth: 1, certain: false },
      },
    ]);
  });

  it('ok là false khi chỉ có lỗi toàn vẹn mà không có sai khác', () => {
    // Một dòng schemas mồ côi không ảnh hưởng tới phép duyệt nào.
    const db = new DatabaseSync(graphDbPath(themeRoot));
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('INSERT INTO schemas (file, presets, accepts_theme_blocks) VALUES (?, 0, 0)').run('sections/ma.liquid');
    db.close();

    graph = openGraph(themeRoot);
    const result = verify(graph);

    expect(result.mismatches).toEqual([]);
    expect(result.integrity).toHaveLength(1);
    expect(result.integrity[0]).toContain('schemas');
    expect(result.ok).toBe(false);
  });
});
