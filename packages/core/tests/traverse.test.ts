import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildGraph } from '../src/graph.js';
import { openGraph } from '../src/open.js';
import type { GraphHandle } from '../src/open.js';
import { traverse } from '../src/traverse.js';
import { FILE_EDGE_TYPES } from '../src/types.js';
import { file, queryGraph, ref, removeTempTheme, saveToTempTheme } from './helpers.js';

let themeRoot: string;
let graph: GraphHandle;

beforeEach(async () => {
  themeRoot = await saveToTempTheme(queryGraph());
  graph = openGraph(themeRoot);
});

afterEach(async () => {
  graph.close();
  await removeTempTheme(themeRoot);
});

const ids = (start: string, edgeTypes?: Parameters<typeof traverse>[3]) =>
  traverse(graph, start, 'forward', edgeTypes).map((n) => n.id);

describe('traverse — lọc theo loại cạnh', () => {
  it('đi qua mọi loại cạnh khi không có tuỳ chọn', () => {
    expect(ids('snippets/card.liquid')).toEqual([
      'snippets/card.liquid',
      'setting:sections/main-product.liquid#section.title',
      'snippets/price.liquid',
      't:product.price',
    ]);
  });

  it('chỉ đi qua các loại cạnh được liệt kê', () => {
    expect(ids('snippets/card.liquid', { edgeTypes: FILE_EDGE_TYPES })).toEqual([
      'snippets/card.liquid',
      'snippets/price.liquid',
    ]);
    expect(ids('snippets/card.liquid', { edgeTypes: ['USES_TRANSLATION'] })).toEqual([
      'snippets/card.liquid',
      't:product.price',
    ]);
  });

  it('áp bộ lọc ở mọi tầng, không chỉ tầng đầu', () => {
    // Chỉ theo RENDERS: từ template xuống section, snippet; không sang layout
    // (USES_LAYOUT) nên cũng không tới được những gì layout gọi.
    const reached = ids('templates/product.json', { edgeTypes: ['RENDERS'] });

    expect(reached).toEqual([
      'templates/product.json',
      'sections/main-product.liquid',
      'blocks/_used.liquid',
      'snippets/card.liquid',
      'snippets/price.liquid',
    ]);
  });

  it('tính mức chắc chắn chỉ trên các cạnh được phép đi', () => {
    // card -> price là RENDERS không điều kiện; nếu chỉ cho đi USES_ASSET thì
    // price không tới được, kể cả trong phép tính "chắc chắn".
    const reached = traverse(graph, 'layout/theme.liquid', 'forward', { edgeTypes: ['USES_ASSET'] });

    expect(reached.map((n) => [n.id, n.depth, n.certain])).toEqual([
      ['layout/theme.liquid', 0, true],
      ['assets/base.css', 1, true],
    ]);
  });

  it('không coi là chắc chắn nhờ một đường đi qua loại cạnh bị loại', async () => {
    // Template gọi snippet s trong một điều kiện (RENDERS, có điều kiện), và
    // còn tới được s bằng đường không điều kiện qua layout (USES_LAYOUT rồi
    // RENDERS). Khi chỉ cho đi RENDERS thì đường qua layout không được tính.
    const other = await saveToTempTheme(
      buildGraph(
        [file('layout/theme.liquid', 'layout'), file('templates/x.liquid', 'template'), file('snippets/s.liquid', 'snippet')],
        [ref('templates/x.liquid', 'render', 's', { conditional: true }), ref('layout/theme.liquid', 'render', 's')],
      ),
    );
    const otherGraph = openGraph(other);

    try {
      const brief = (edgeTypes?: Parameters<typeof traverse>[3]) =>
        traverse(otherGraph, 'templates/x.liquid', 'forward', edgeTypes)
          .filter((n) => n.id === 'snippets/s.liquid')
          .map((n) => [n.depth, n.certain]);

      expect(brief()).toEqual([[1, true]]);
      expect(brief({ edgeTypes: ['RENDERS'] })).toEqual([[1, false]]);
    } finally {
      otherGraph.close();
      await removeTempTheme(other);
    }
  });

  it('trả về chỉ node xuất phát khi danh sách loại cạnh rỗng', () => {
    expect(ids('snippets/card.liquid', { edgeTypes: [] })).toEqual(['snippets/card.liquid']);
  });
});

describe('traverse — đường đi dài và vòng', () => {
  /** Dựng một chuỗi snippet s00 -> s01 -> ... dài `length` node, rồi chạy `run` trên nó. */
  async function withChain<T>(length: number, loopBack: boolean, run: (chain: GraphHandle) => T): Promise<T> {
    const name = (i: number) => `s${String(i).padStart(2, '0')}`;
    const files = [file('layout/theme.liquid', 'layout')];
    const refs = [];

    for (let i = 0; i < length; i++) {
      files.push(file(`snippets/${name(i)}.liquid`, 'snippet'));
      if (i > 0) refs.push(ref(`snippets/${name(i - 1)}.liquid`, 'render', name(i)));
    }
    // Vòng: node cuối gọi lại node đầu.
    if (loopBack) refs.push(ref(`snippets/${name(length - 1)}.liquid`, 'render', name(0)));

    const root = await saveToTempTheme(buildGraph(files, refs));
    const chain = openGraph(root);
    try {
      return run(chain);
    } finally {
      chain.close();
      await removeTempTheme(root);
    }
  }

  it('tính đúng độ sâu của node nằm xa hơn mức chặn ban đầu', async () => {
    // Mức chặn ban đầu là 16; chuỗi 40 node buộc truy vấn phải nới mức chặn.
    const reached = await withChain(40, false, (chain) => traverse(chain, 'snippets/s00.liquid', 'forward'));

    expect(reached).toHaveLength(40);
    expect(reached.map((n) => n.depth)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(reached.at(-1)).toMatchObject({ id: 'snippets/s39.liquid', depth: 39 });
  });

  it('cũng đúng theo chiều ngược', async () => {
    const reached = await withChain(40, false, (chain) => traverse(chain, 'snippets/s39.liquid', 'backward'));

    expect(reached.at(-1)).toMatchObject({ id: 'snippets/s00.liquid', depth: 39 });
  });

  it('dừng được và tính đúng trên một vòng dài hơn mức chặn ban đầu', async () => {
    const reached = await withChain(40, true, (chain) => traverse(chain, 'snippets/s10.liquid', 'forward'));

    expect(reached).toHaveLength(40);
    // Đi xuôi từ s10: s11 cách 1, s39 cách 29, rồi quay về s00 cách 30, s09 cách 39.
    expect(reached.find((n) => n.id === 'snippets/s39.liquid')?.depth).toBe(29);
    expect(reached.find((n) => n.id === 'snippets/s09.liquid')?.depth).toBe(39);
  });

  it('trả mảng rỗng cho node không có trong đồ thị', async () => {
    const reached = await withChain(3, false, (chain) => traverse(chain, 'snippets/khong-co.liquid', 'forward'));

    expect(reached).toEqual([]);
  });
});
