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
    expect(ids('snippets/card.liquid')).toEqual(['snippets/card.liquid', 'snippets/price.liquid', 't:product.price']);
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
