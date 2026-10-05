import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildGraph } from '../src/graph.js';
import { saveGraph } from '../src/store.js';
import type { FileKind, FileSchema, RawRef, RefKind, RefSource, ThemeFile, ThemeGraph } from '../src/types.js';

/** Tạo một ThemeFile từ đường dẫn và loại. */
export const file = (p: string, kind: FileKind): ThemeFile => ({
  path: p,
  kind,
  ext: p.slice(p.lastIndexOf('.') + 1),
});

/** Tạo một tham chiếu thô; mặc định là lời gọi Liquid không điều kiện ở dòng 1. */
export const ref = (
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
 * Dữ kiện schema mặc định của đồ thị mẫu: featured có preset (merchant thêm
 * được), main-product nhận mọi theme block công khai qua "@theme".
 */
export const QUERY_SCHEMAS: FileSchema[] = [
  { file: 'sections/featured.liquid', presets: 1, acceptsThemeBlocks: false },
  { file: 'sections/main-product.liquid', presets: 0, acceptsThemeBlocks: true },
  { file: 'sections/api-only.liquid', presets: 0, acceptsThemeBlocks: false },
];

/**
 * Khoá dịch của đồ thị mẫu: card dùng product.price (hai lần), main-product
 * dùng product.title trong một điều kiện, còn general.unused không ai dùng.
 */
export const QUERY_KEYS = ['product.price', 'product.title', 'general.unused'];

/**
 * Đồ thị mẫu cho các test truy vấn. Mỗi phần của nó phục vụ một tình huống:
 *
 *   page:product    -> templates/product.json     -> sections/main-product.liquid -> snippets/card.liquid -> snippets/price.liquid
 *   page:product    -> templates/product.alt.json -> sections/promo.liquid        (template thay thế: có điều kiện)
 *   page:collection -> templates/collection.json  -> sections/grid.liquid -(if)-> snippets/card.liquid
 *   page:cart       -> templates/cart.json        -> sections/cart.liquid -> snippets/a.liquid <-> snippets/b.liquid   (VÒNG)
 *
 *   mọi template    -> layout/theme.liquid -> assets/base.css
 *                                          -> sections/header-group.json -> sections/header.liquid -> snippets/menu.liquid (tự gọi mình)
 *
 * Không trang nào đi tới:
 *   snippets/orphan.liquid -> snippets/orphan-child.liquid, assets/icon.svg
 *   sections/featured.liquid  (có presets)    -> snippets/featured-item.liquid
 *   sections/api-only.liquid  (không presets) -> snippets/api-row.liquid
 *   blocks/_unused.liquid, blocks/text.liquid, assets/unused.png
 */
export function queryGraph(schemas: FileSchema[] = QUERY_SCHEMAS): ThemeGraph {
  const files = [
    file('layout/theme.liquid', 'layout'),
    file('templates/product.json', 'template'),
    file('templates/product.alt.json', 'template'),
    file('templates/collection.json', 'template'),
    file('templates/cart.json', 'template'),
    file('sections/header-group.json', 'section_group'),
    file('sections/header.liquid', 'section'),
    file('sections/main-product.liquid', 'section'),
    file('sections/promo.liquid', 'section'),
    file('sections/grid.liquid', 'section'),
    file('sections/cart.liquid', 'section'),
    file('sections/featured.liquid', 'section'),
    file('sections/api-only.liquid', 'section'),
    file('snippets/menu.liquid', 'snippet'),
    file('snippets/card.liquid', 'snippet'),
    file('snippets/price.liquid', 'snippet'),
    file('snippets/a.liquid', 'snippet'),
    file('snippets/b.liquid', 'snippet'),
    file('snippets/orphan.liquid', 'snippet'),
    file('snippets/orphan-child.liquid', 'snippet'),
    file('snippets/featured-item.liquid', 'snippet'),
    file('snippets/api-row.liquid', 'snippet'),
    file('blocks/_used.liquid', 'block'),
    file('blocks/_unused.liquid', 'block'),
    file('blocks/text.liquid', 'block'),
    file('assets/base.css', 'asset'),
    file('assets/icon.svg', 'asset'),
    file('assets/unused.png', 'asset'),
  ];

  const refs = [
    ref('layout/theme.liquid', 'asset', 'base.css', { line: 4 }),
    ref('layout/theme.liquid', 'section_group', 'header-group', { line: 8 }),
    ref('sections/header-group.json', 'section', 'header', { source: 'json', line: 0 }),
    ref('sections/header.liquid', 'render', 'menu', { line: 3 }),
    ref('snippets/menu.liquid', 'render', 'menu', { line: 6, conditional: true }),

    ref('templates/product.json', 'section', 'main-product', { source: 'json', line: 0 }),
    ref('templates/product.alt.json', 'section', 'promo', { source: 'json', line: 0 }),
    ref('templates/collection.json', 'section', 'grid', { source: 'json', line: 0 }),
    ref('templates/cart.json', 'section', 'cart', { source: 'json', line: 0 }),

    ref('sections/main-product.liquid', 'render', 'card', { line: 5 }),
    ref('sections/main-product.liquid', 'block', '_used', { source: 'schema', line: 20, conditional: true }),
    ref('sections/main-product.liquid', 'render', 'da-xoa', { line: 9 }),
    ref('sections/grid.liquid', 'render', 'card', { line: 7, conditional: true }),
    ref('snippets/card.liquid', 'render', 'price', { line: 12 }),
    ref('snippets/card.liquid', 'render', 'price', { line: 30 }),

    ref('sections/cart.liquid', 'render', 'a', { line: 2 }),
    ref('snippets/a.liquid', 'render', 'b', { line: 1 }),
    ref('snippets/b.liquid', 'render', 'a', { line: 1, conditional: true }),

    ref('snippets/orphan.liquid', 'render', 'orphan-child', { line: 1 }),
    ref('snippets/orphan.liquid', 'asset', 'icon.svg', { line: 2 }),
    ref('sections/featured.liquid', 'render', 'featured-item', { line: 1 }),
    ref('sections/api-only.liquid', 'render', 'api-row', { line: 1 }),

    ref('snippets/card.liquid', 'translation', 'product.price', { line: 14 }),
    ref('snippets/card.liquid', 'translation', 'product.price', { line: 31 }),
    ref('sections/main-product.liquid', 'translation', 'product.title', { line: 3, conditional: true }),
  ];

  return buildGraph(files, refs, { schemas, translationKeys: QUERY_KEYS });
}

/**
 * Ghi một đồ thị vào một thư mục "theme" tạm NGOÀI repo và trả về đường dẫn
 * của thư mục đó. Người gọi tự xoá bằng removeTempTheme() trong afterEach.
 */
export async function saveToTempTheme(graph: ThemeGraph): Promise<string> {
  const themeRoot = await mkdtemp(path.join(os.tmpdir(), 'themegraph-query-'));
  saveGraph(themeRoot, graph);
  return themeRoot;
}

export async function removeTempTheme(themeRoot: string): Promise<void> {
  await rm(themeRoot, { recursive: true, force: true });
}
