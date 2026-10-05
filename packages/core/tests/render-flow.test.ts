import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeNotFoundError } from '../src/find-node.js';
import { openGraph } from '../src/open.js';
import type { GraphHandle } from '../src/open.js';
import { renderFlow } from '../src/render-flow.js';
import type { FlowNode } from '../src/render-flow.js';
import { queryGraph, removeTempTheme, saveToTempTheme } from './helpers.js';

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

/**
 * Vẽ cây thành các dòng thụt lề để so sánh cho dễ đọc. Ký hiệu sau tên:
 *   ?  cạnh dẫn tới node này có điều kiện
 *   ^  node đã được liệt kê đầy đủ ở chỗ khác trong cây
 */
function draw(node: FlowNode, lines: string[] = []): string[] {
  const marks = (node.conditional ? ' ?' : '') + (node.repeated ? ' ^' : '');
  lines.push(`${'  '.repeat(node.depth)}${node.id}${marks}`);
  for (const child of node.children) draw(child, lines);
  return lines;
}

/** Gom mọi node của cây thành một mảng phẳng. */
function flatten(node: FlowNode): FlowNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

describe('renderFlow — danh sách file', () => {
  it('liệt kê mọi file một trang kéo theo, kèm độ sâu và mức chắc chắn', () => {
    const result = renderFlow(graph, 'page:product');

    expect(result.root).toEqual({ id: 'page:product', kind: 'page_type' });
    expect(result.files.map((f) => [f.id, f.depth, f.certain])).toEqual([
      ['templates/product.alt.json', 1, false],
      ['templates/product.json', 1, true],
      ['layout/theme.liquid', 2, true],
      ['sections/main-product.liquid', 2, true],
      ['sections/promo.liquid', 2, false],
      ['assets/base.css', 3, true],
      ['blocks/_used.liquid', 3, false],
      ['sections/header-group.json', 3, true],
      ['snippets/card.liquid', 3, true],
      ['sections/header.liquid', 4, true],
      ['snippets/price.liquid', 4, true],
      ['snippets/menu.liquid', 5, true],
    ]);
  });

  it('không kể khoá dịch: chỉ đi theo cạnh nối file với file', () => {
    // card và main-product đều dùng khoá dịch, nhưng danh sách ở test trên
    // không có node t: nào.
    const result = renderFlow(graph, 'page:product');
    const inTree = flatten(result.tree).map((n) => n.id);

    expect(result.files.some((f) => f.kind === 'translation_key')).toBe(false);
    expect(inTree.some((id) => id.startsWith('t:'))).toBe(false);
  });

  it('không kể node gốc trong danh sách file', () => {
    const result = renderFlow(graph, 'page:cart');

    expect(result.files.map((f) => f.id)).not.toContain('page:cart');
  });

  it('không liệt kê file của trang khác', () => {
    const ids = renderFlow(graph, 'page:cart').files.map((f) => f.id);

    expect(ids).toContain('sections/cart.liquid');
    expect(ids).not.toContain('snippets/card.liquid');
    expect(ids).not.toContain('snippets/orphan.liquid');
  });

  it('hiểu tên trang viết không có tiền tố page:', () => {
    expect(renderFlow(graph, 'cart').root.id).toBe('page:cart');
  });

  it('hiểu đường dẫn tương đối theo baseDir', () => {
    const result = renderFlow(graph, 'cart.liquid', { baseDir: `${themeRoot}/sections` });

    expect(result.root.id).toBe('sections/cart.liquid');
  });

  it('chạy được từ một file bất kỳ, không chỉ từ trang', () => {
    const result = renderFlow(graph, 'sections/main-product.liquid');

    expect(result.files.map((f) => [f.id, f.depth])).toEqual([
      ['blocks/_used.liquid', 1],
      ['snippets/card.liquid', 1],
      ['snippets/price.liquid', 2],
    ]);
  });

  it('ném NodeNotFoundError cho tên không có trong đồ thị', () => {
    expect(() => renderFlow(graph, 'page:khong-co')).toThrow(NodeNotFoundError);
  });
});

describe('renderFlow — cây', () => {
  it('dựng cây theo thứ tự: cạnh không điều kiện trước, rồi theo tên', () => {
    const { tree } = renderFlow(graph, 'page:product');

    expect(draw(tree)).toEqual([
      'page:product',
      '  templates/product.json',
      '    layout/theme.liquid',
      '      assets/base.css',
      '      sections/header-group.json',
      '        sections/header.liquid',
      '          snippets/menu.liquid',
      '            snippets/menu.liquid ? ^',
      '    sections/main-product.liquid',
      '      snippets/card.liquid',
      '        snippets/price.liquid',
      '      blocks/_used.liquid ?',
      '  templates/product.alt.json ?',
      '    layout/theme.liquid ^',
      '    sections/promo.liquid',
    ]);
  });

  it('ghi loại cạnh, số lời gọi và kind trên từng node của cây', () => {
    const nodes = flatten(renderFlow(graph, 'page:product').tree);
    const pick = (id: string) => nodes.find((n) => n.id === id);

    expect(pick('page:product')).toMatchObject({ kind: 'page_type', edge: null, count: 0, depth: 0 });
    expect(pick('templates/product.json')).toMatchObject({ kind: 'template', edge: 'USES_TEMPLATE', count: 1 });
    expect(pick('layout/theme.liquid')).toMatchObject({ kind: 'layout', edge: 'USES_LAYOUT' });
    expect(pick('assets/base.css')).toMatchObject({ kind: 'asset', edge: 'USES_ASSET' });
    // card gọi price ở hai dòng: một cạnh, đếm 2.
    expect(pick('snippets/price.liquid')).toMatchObject({ kind: 'snippet', edge: 'RENDERS', count: 2, depth: 4 });
  });

  it('mở mỗi node đúng một lần, ở đúng độ sâu nhỏ nhất của nó', () => {
    const { tree, files } = renderFlow(graph, 'page:product');
    const expanded = flatten(tree).filter((n) => !n.repeated && n.id !== tree.id);

    // Tập node được mở trong cây trùng khít với danh sách file, cả độ sâu.
    expect(expanded.map((n) => [n.id, n.depth]).sort()).toEqual(files.map((f) => [f.id, f.depth]).sort());
  });

  it('không mở lại node đã liệt kê: nhánh lặp không có con', () => {
    const repeated = flatten(renderFlow(graph, 'page:product').tree).filter((n) => n.repeated);

    expect(repeated.map((n) => n.id)).toEqual(['snippets/menu.liquid', 'layout/theme.liquid']);
    expect(repeated.every((n) => n.children.length === 0)).toBe(true);
  });

  it('dừng được khi đồ thị có vòng', () => {
    const { tree } = renderFlow(graph, 'sections/cart.liquid');

    // a -> b -> a: lần gặp lại a được đánh dấu thay vì đi tiếp.
    expect(draw(tree)).toEqual([
      'sections/cart.liquid',
      '  snippets/a.liquid',
      '    snippets/b.liquid',
      '      snippets/a.liquid ? ^',
    ]);
  });

  it('trả cây chỉ có gốc cho node không gọi gì', () => {
    const result = renderFlow(graph, 'assets/unused.png');

    expect(result.files).toEqual([]);
    expect(result.tree.children).toEqual([]);
    expect(result.tree.repeated).toBe(false);
  });

  it('đánh dấu lặp khi vòng quay về chính node gốc', () => {
    const { tree } = renderFlow(graph, 'snippets/a.liquid');

    expect(draw(tree)).toEqual(['snippets/a.liquid', '  snippets/b.liquid', '    snippets/a.liquid ? ^']);
  });
});
