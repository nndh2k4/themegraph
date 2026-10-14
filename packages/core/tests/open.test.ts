import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildGraph, core, file, openGraph, queryGraph, removeTempTheme, saveToTempTheme, scopeOf } from './helpers.js';
import { GraphNotReadyError, NodeNotFoundError } from '../src/common/errors.js';
import type { GraphRepository } from '../src/graph/graph.repository.js';
import { SCHEMA_VERSION, graphDbPath } from '../src/infrastructure/sqlite/schema.js';
import { SqliteGraphStore } from '../src/infrastructure/sqlite/sqlite-graph.store.js';

let themeRoot: string;
let opened: GraphRepository[];

beforeEach(async () => {
  themeRoot = await saveToTempTheme(queryGraph());
  opened = [];
});

afterEach(async () => {
  // Windows không cho xoá file đang mở: phải đóng mọi database trước.
  for (const graph of opened) graph.close();
  await removeTempTheme(themeRoot);
});

/** Mở đồ thị và ghi nhớ để afterEach đóng lại. */
function open(root: string = themeRoot): GraphRepository {
  const graph = openGraph(root);
  opened.push(graph);
  return graph;
}

/** Gọi một hàm và trả về lỗi nó ném ra (hoặc undefined nếu không ném). */
function errorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('SqliteGraphStore.open', () => {
  it('mở graph.db của theme và đọc được thông tin trong bảng meta', () => {
    const graph = open();

    expect(graph.themeRoot).toBe(themeRoot);
    expect(new SqliteGraphStore().dbPath(themeRoot)).toBe(graphDbPath(themeRoot));
    expect(graph.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(graph.meta.toolVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number.isNaN(Date.parse(graph.meta.analyzedAt))).toBe(false);
  });

  it('đổi đường dẫn tương đối thành tuyệt đối', () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(themeRoot);
      const graph = open('.');

      expect(path.isAbsolute(graph.themeRoot)).toBe(true);
      expect(graph.countNodes()).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('mở ở chế độ chỉ đọc: truy vấn không thể làm hỏng đồ thị', () => {
    const graph = open();

    // GraphRepository không có hàm ghi nào; ở đây kiểm thêm chính kết nối bên
    // dưới, qua trường riêng của bản SQLite.
    const { db } = graph as unknown as { db: DatabaseSync };
    expect(() => db.exec('DELETE FROM nodes')).toThrow(/readonly/i);
  });

  it('báo not_analyzed khi theme chưa được phân tích', async () => {
    const empty = path.join(themeRoot, 'chua-phan-tich');
    await mkdir(empty);

    const error = errorOf(() => openGraph(empty));

    expect(error).toBeInstanceOf(GraphNotReadyError);
    expect((error as GraphNotReadyError).reason).toBe('not_analyzed');
    expect((error as Error).message).toContain('themegraph analyze');
    expect((error as Error).message).toContain(empty);
  });

  it('không tạo ra file nào khi theme chưa được phân tích', async () => {
    const empty = path.join(themeRoot, 'chua-phan-tich');
    await mkdir(empty);

    errorOf(() => openGraph(empty));

    // Mở một database không tồn tại ở chế độ ghi sẽ tạo ra file rỗng.
    expect(existsSync(path.join(empty, '.themegraph'))).toBe(false);
  });

  it('báo unreadable khi graph.db không phải database SQLite', async () => {
    await writeFile(graphDbPath(themeRoot), 'day khong phai sqlite');

    const error = errorOf(() => openGraph(themeRoot));

    expect(error).toBeInstanceOf(GraphNotReadyError);
    expect((error as GraphNotReadyError).reason).toBe('unreadable');
    expect((error as Error).message).toContain('themegraph analyze');
  });

  it('báo outdated khi graph.db do một phiên bản lược đồ khác ghi ra', () => {
    const db = new DatabaseSync(graphDbPath(themeRoot));
    db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION + 1));
    db.close();

    const error = errorOf(() => openGraph(themeRoot));

    expect(error).toBeInstanceOf(GraphNotReadyError);
    expect((error as GraphNotReadyError).reason).toBe('outdated');
    expect((error as Error).message).toContain(String(SCHEMA_VERSION + 1));
    expect((error as Error).message).toContain('themegraph analyze');
  });

  it('không giữ file database khi mở thất bại', async () => {
    await writeFile(graphDbPath(themeRoot), 'day khong phai sqlite');
    errorOf(() => openGraph(themeRoot));

    // Nếu database còn mở, Windows sẽ từ chối đổi tên file này.
    await expect(rename(graphDbPath(themeRoot), `${graphDbPath(themeRoot)}.bak`)).resolves.toBeUndefined();
  });
});

describe('findThemeRoot', () => {
  it('trả về chính thư mục đó khi nó có .themegraph/graph.db', () => {
    expect(core().themes.locate(themeRoot)).toBe(themeRoot);
  });

  it('đi ngược lên thư mục cha để tìm theme', async () => {
    const deep = path.join(themeRoot, 'sections', 'nested');
    await mkdir(deep, { recursive: true });

    expect(core().themes.locate(deep)).toBe(themeRoot);
  });

  it('trả null khi không thư mục cha nào là theme đã phân tích', () => {
    // Thư mục cha của thư mục theme tạm là thư mục tạm của hệ điều hành.
    expect(core().themes.locate(path.dirname(themeRoot))).toBeNull();
  });
});

describe('findNode', () => {
  it('tìm node theo đúng id', () => {
    expect(scopeOf(open()).nodes.find('snippets/card.liquid')).toEqual({ id: 'snippets/card.liquid', kind: 'snippet' });
    expect(scopeOf(open()).nodes.find('page:product')).toEqual({ id: 'page:product', kind: 'page_type' });
  });

  it('chấp nhận dấu gạch chéo ngược và tiền tố ./', () => {
    expect(scopeOf(open()).nodes.find('snippets\\card.liquid').id).toBe('snippets/card.liquid');
    expect(scopeOf(open()).nodes.find('./snippets/card.liquid').id).toBe('snippets/card.liquid');
  });

  it('chấp nhận đường dẫn tuyệt đối nằm trong theme', () => {
    const absolute = path.join(themeRoot, 'snippets', 'card.liquid');

    expect(scopeOf(open()).nodes.find(absolute).id).toBe('snippets/card.liquid');
  });

  it('hiểu đường dẫn tương đối theo baseDir khi được cho', () => {
    const graph = open();
    const baseDir = path.join(themeRoot, 'snippets');

    expect(scopeOf(graph).nodes.find('card.liquid', { baseDir }).id).toBe('snippets/card.liquid');
    expect(scopeOf(graph).nodes.find('../sections/grid.liquid', { baseDir }).id).toBe('sections/grid.liquid');
  });

  it('ưu tiên id khớp nguyên văn hơn cách hiểu theo baseDir', () => {
    // Đứng trong snippets/ mà gõ đủ "snippets/card.liquid" thì vẫn phải đúng.
    const baseDir = path.join(themeRoot, 'snippets');

    expect(scopeOf(open()).nodes.find('snippets/card.liquid', { baseDir }).id).toBe('snippets/card.liquid');
  });

  it('hiểu tên trang viết không có tiền tố page:', () => {
    expect(scopeOf(open()).nodes.find('product')).toEqual({ id: 'page:product', kind: 'page_type' });
  });

  it('hiểu tên file không kèm thư mục khi cả theme chỉ có một file tên đó', () => {
    // Có đuôi hay không, hoa hay thường, đều được.
    expect(scopeOf(open()).nodes.find('price')).toEqual({ id: 'snippets/price.liquid', kind: 'snippet' });
    expect(scopeOf(open()).nodes.find('price.liquid')).toEqual({ id: 'snippets/price.liquid', kind: 'snippet' });
    expect(scopeOf(open()).nodes.find('PRICE')).toEqual({ id: 'snippets/price.liquid', kind: 'snippet' });
    expect(scopeOf(open()).nodes.find('base.css')).toEqual({ id: 'assets/base.css', kind: 'asset' });
    // Tên có dấu chấm ở giữa: chỉ bỏ đuôi cuối cùng.
    expect(scopeOf(open()).nodes.find('product.alt')).toEqual({ id: 'templates/product.alt.json', kind: 'template' });
  });

  it('tên trang thắng tên file: "cart" là page:cart, không phải sections/cart.liquid', () => {
    expect(scopeOf(open()).nodes.find('cart')).toEqual({ id: 'page:cart', kind: 'page_type' });
  });

  it('không đoán khi nhiều file trùng tên: báo lỗi và liệt kê đúng các file đó', async () => {
    const root = await saveToTempTheme(
      buildGraph(
        [file('sections/header.liquid', 'section'), file('snippets/header.liquid', 'snippet'), file('snippets/header-menu.liquid', 'snippet')],
        [],
        {},
      ),
    );
    const handle = openGraph(root);
    try {
      const error = (() => {
        try {
          scopeOf(handle).nodes.find('header');
        } catch (thrown) {
          return thrown;
        }
        return null;
      })();

      expect(error).toBeInstanceOf(NodeNotFoundError);
      // Chỉ hai file tên đúng là "header"; header-menu không nằm trong số đó.
      expect((error as NodeNotFoundError).suggestions).toEqual(['sections/header.liquid', 'snippets/header.liquid']);
    } finally {
      handle.close();
      await removeTempTheme(root);
    }
  });

  it('tên không kèm thư mục chỉ khớp cả tên, không khớp một phần', () => {
    // "car" là một phần của "card" và "cart": không được tự chọn.
    expect(() => scopeOf(open()).nodes.find('car')).toThrow(NodeNotFoundError);
    expect(() => scopeOf(open()).nodes.find('liquid')).toThrow(NodeNotFoundError);
  });

  it('tên đã kèm thư mục mà sai thì không được hiểu tắt', () => {
    expect(() => scopeOf(open()).nodes.find('snippets/price')).toThrow(NodeNotFoundError);
    expect(() => scopeOf(open()).nodes.find('sections/price.liquid')).toThrow(NodeNotFoundError);
  });

  it('cách hiểu tắt không áp dụng cho khoá dịch và setting', () => {
    // t:product.price có "tên" là price nếu coi nó như file; không được lẫn.
    expect(scopeOf(open()).nodes.find('price').kind).toBe('snippet');
    expect(() => scopeOf(open()).nodes.find('accent')).toThrow(NodeNotFoundError);
    expect(() => scopeOf(open()).nodes.find('title')).toThrow(NodeNotFoundError);
  });

  it('cách hiểu tắt không tính node loại trang: "login" là file template, không bị coi là trùng tên với trang', async () => {
    // templates/customers/login.json sinh ra node page:customers/login. Phần
    // sau dấu "/" của id đó cũng là "login"; nếu tính cả nó thì có hai kết
    // quả và lời gọi bị từ chối vì mơ hồ.
    const root = await saveToTempTheme(buildGraph([file('templates/customers/login.json', 'template')], [], {}));
    const handle = openGraph(root);
    try {
      expect(scopeOf(handle).nodes.find('login')).toEqual({ id: 'templates/customers/login.json', kind: 'template' });
    } finally {
      handle.close();
      await removeTempTheme(root);
    }
  });

  it('ném NodeNotFoundError kèm gợi ý khi không tìm thấy', () => {
    const error = errorOf(() => scopeOf(open()).nodes.find('snippets/card'));

    expect(error).toBeInstanceOf(NodeNotFoundError);
    expect((error as NodeNotFoundError).input).toBe('snippets/card');
    expect((error as NodeNotFoundError).suggestions).toEqual(['snippets/card.liquid']);
    expect((error as Error).message).toContain('snippets/card.liquid');
  });

  it('gợi ý theo tên file, bỏ qua thư mục và đuôi gõ sai', () => {
    const error = errorOf(() => scopeOf(open()).nodes.find('sections/price.css'));

    // Gợi ý tìm trong mọi node, nên khoá dịch có chữ "price" cũng được đưa ra.
    expect((error as NodeNotFoundError).suggestions).toEqual(['snippets/price.liquid', 't:product.price']);
  });

  it('không gợi ý gì khi không có node nào giống', () => {
    const error = errorOf(() => scopeOf(open()).nodes.find('khong-co-gi-giong'));

    expect((error as NodeNotFoundError).suggestions).toEqual([]);
    expect((error as Error).message).not.toContain('Có phải');
  });

  it('không coi ký tự % và _ là ký tự đại diện khi tìm gợi ý', () => {
    const error = errorOf(() => scopeOf(open()).nodes.find('%'));

    expect((error as NodeNotFoundError).suggestions).toEqual([]);
  });

  it('không tìm ra node nằm ngoài theme dù đường dẫn có ..', () => {
    const error = errorOf(() => scopeOf(open()).nodes.find('../snippets/card.liquid'));

    expect(error).toBeInstanceOf(NodeNotFoundError);
  });
});
