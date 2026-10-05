import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  analyze,
  context,
  deadCode,
  formatContext,
  formatDeadCode,
  formatImpact,
  formatList,
  formatRenderFlow,
  formatSearch,
  formatThemeNote,
  impact,
  listThemes,
  openGraph,
  readRegistry,
  renderFlow,
  search,
  themeStatus,
  unregisterTheme,
} from '@themegraph/core';
import type { GraphHandle } from '@themegraph/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createServer,
  DEFAULT_FLOW_DEPTH,
  DEFAULT_FLOW_LINES,
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_RESULTS,
  INSTRUCTIONS,
} from '../src/index.js';

const FIXTURE = path.join(import.meta.dirname, '../../core/tests/fixtures/mini-theme');

let tmp: string;
let themeRoot: string;
const clients: Client[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-mcp-'));
  themeRoot = path.join(tmp, 'mini-theme');
  await cp(FIXTURE, themeRoot, { recursive: true });

  // Sổ đăng ký tạm dùng chung cho cả file test: bắt đầu mỗi test từ sổ trống.
  for (const entry of readRegistry()) unregisterTheme(entry.path);
  await analyze(themeRoot);
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await rm(tmp, { recursive: true, force: true });
});

/**
 * Nối một client với một server mới qua đường truyền trong bộ nhớ: cùng giao
 * thức như khi chạy thật, chỉ không có tiến trình con và stdin/stdout.
 */
async function connect(cwd: string = themeRoot): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ cwd }).connect(serverSide);

  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  clients.push(client);
  return client;
}

/** Gọi một tool và trả về chữ của kết quả cùng cờ lỗi. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];

  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return { isError: result.isError === true, text: content[0]?.text ?? '' };
}

/** Câu trả lời mà một tool PHẢI gửi: ghi chú về theme, một dòng trống, rồi các dòng của lõi. */
async function expected(root: string, query: (graph: GraphHandle) => string[]): Promise<string> {
  const graph = openGraph(root);
  try {
    return [...formatThemeNote(await themeStatus(root)), '', ...query(graph)].join('\n');
  } finally {
    graph.close();
  }
}

describe('MCP server — bắt tay và danh sách tool', () => {
  it('khai đúng sáu tool của đề cương', async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'context',
      'dead_code',
      'impact',
      'list_themes',
      'render_flow',
      'search',
    ]);
  });

  it('mọi tool được đánh dấu chỉ đọc và có mô tả nói rõ là về Shopify theme', async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      // Máy của người dùng có thể có MCP server khác với tool trùng tên
      // (impact, context); mô tả phải đủ để agent phân biệt.
      expect(tool.description, tool.name).toContain('Shopify theme');
      expect(tool.title, tool.name).toBeTruthy();
    }
  });

  it('khai tham số của từng tool, chỉ tên file/trang là bắt buộc', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const schemaOf = (name: string) =>
      tools.find((tool) => tool.name === name)?.inputSchema as { properties?: object; required?: string[] };

    expect(Object.keys(schemaOf('list_themes').properties ?? {})).toEqual([]);
    expect(Object.keys(schemaOf('search').properties ?? {}).sort()).toEqual(['kind', 'limit', 'query', 'theme']);
    expect(schemaOf('search').required ?? []).toEqual([]);
    expect(Object.keys(schemaOf('impact').properties ?? {}).sort()).toEqual(['limit', 'target', 'theme']);
    expect(schemaOf('impact').required).toEqual(['target']);
    expect(schemaOf('context').required).toEqual(['target']);
    expect(Object.keys(schemaOf('render_flow').properties ?? {}).sort()).toEqual(['limit', 'max_depth', 'page', 'theme']);
    expect(schemaOf('render_flow').required).toEqual(['page']);
    expect(Object.keys(schemaOf('dead_code').properties ?? {}).sort()).toEqual(['limit', 'theme']);
  });

  it('gửi lời dặn dùng tool lúc bắt tay', async () => {
    const client = await connect();

    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toContain('impact');
    expect(client.getServerVersion()?.name).toBe('themegraph');
  });
});

describe('MCP server — mỗi tool trả đúng những dòng của lõi', () => {
  it('list_themes', async () => {
    const client = await connect();
    const result = await call(client, 'list_themes');

    expect(result.isError).toBe(false);
    expect(result.text).toBe(formatList(listThemes()).join('\n'));
    expect(result.text).toContain(themeRoot);
  });

  it('impact', async () => {
    const client = await connect();
    const result = await call(client, 'impact', { target: 'snippets/card.liquid' });

    expect(result.isError).toBe(false);
    expect(result.text).toBe(
      await expected(themeRoot, (graph) =>
        formatImpact(impact(graph, 'snippets/card.liquid'), { limit: DEFAULT_LIST_LIMIT }),
      ),
    );
    expect(result.text).toContain('ảnh hưởng 8 file và 4 trên 4 trang');
  });

  it('context', async () => {
    const client = await connect();
    const result = await call(client, 'context', { target: 'sections/hero.liquid' });

    expect(result.text).toBe(
      await expected(themeRoot, (graph) =>
        formatContext(context(graph, 'sections/hero.liquid'), { limit: DEFAULT_LIST_LIMIT }),
      ),
    );
    expect(result.text).toContain('Được gọi bởi (3):');
  });

  it('render_flow', async () => {
    const client = await connect();
    const result = await call(client, 'render_flow', { page: 'index' });

    expect(result.text).toBe(
      await expected(themeRoot, (graph) =>
        formatRenderFlow(renderFlow(graph, 'index', { maxDepth: DEFAULT_FLOW_DEPTH }), { limit: DEFAULT_FLOW_LINES }),
      ),
    );
    expect(result.text).toContain('page:index (page_type) kéo theo 7 file');
  });

  it('search', async () => {
    const client = await connect();
    const result = await call(client, 'search', { query: 'card' });

    expect(result.text).toBe(
      await expected(themeRoot, (graph) => formatSearch(search(graph, 'card', { limit: DEFAULT_SEARCH_RESULTS }))),
    );
    expect(result.text).toContain('snippets/card.liquid');
  });

  it('dead_code', async () => {
    await writeFile(path.join(themeRoot, 'snippets', 'old.liquid'), '<p>cu</p>');
    await analyze(themeRoot);

    const client = await connect();
    const result = await call(client, 'dead_code');

    expect(result.text).toBe(
      await expected(themeRoot, (graph) => formatDeadCode(deadCode(graph), { limit: DEFAULT_LIST_LIMIT })),
    );
    expect(result.text).toContain('snippets/old.liquid');
  });

  it('câu trả lời mở đầu bằng tên và đường dẫn của theme đã hỏi', async () => {
    const client = await connect();
    const result = await call(client, 'impact', { target: 'snippets/card.liquid' });

    expect(result.text.split('\n').slice(0, 2)).toEqual([`Theme: mini-theme (${themeRoot})`, '']);
  });
});

describe('MCP server — tham số', () => {
  it('impact và context nhận tên file không kèm thư mục', async () => {
    const client = await connect();

    const byName = await call(client, 'impact', { target: 'card' });
    const byPath = await call(client, 'impact', { target: 'snippets/card.liquid' });

    expect(byName.isError).toBe(false);
    expect(byName.text).toBe(byPath.text);
  });

  it('search: kind lọc theo loại, query để trống thì liệt kê', async () => {
    const client = await connect();
    const result = await call(client, 'search', { kind: 'section' });

    expect(result.text).toBe(
      await expected(themeRoot, (graph) =>
        formatSearch(search(graph, '', { kinds: ['section'], limit: DEFAULT_SEARCH_RESULTS })),
      ),
    );
    expect(result.text).toContain('sections/hero.liquid');
    expect(result.text).not.toContain('snippets/card.liquid');
  });

  it('search: mặc định 20 kết quả, limit đổi được', async () => {
    const client = await connect();

    expect((await call(client, 'search')).text).toContain('Node (20 trên 22)');
    expect((await call(client, 'search', { limit: 3 })).text).toContain('Node (3 trên 22)');
    expect((await call(client, 'search', { limit: 100 })).text).toContain('Node (22)');
  });

  it('render_flow: mặc định cắt ở tầng 3, max_depth đổi được', async () => {
    const client = await connect();

    // Ở tầng 3 có sections/footer-group.json, và con của nó bị giấu.
    const byDefault = await call(client, 'render_flow', { page: 'index' });
    expect(byDefault.text).toContain('Cây dưới đây dừng ở tầng 3.');
    expect(byDefault.text).toContain('sections/footer-group.json  (1 file con chưa mở)');

    const shallow = await call(client, 'render_flow', { page: 'index', max_depth: 1 });
    expect(shallow.text).toContain('Cây dưới đây dừng ở tầng 1.');
    expect(shallow.text).toContain('templates/index.json  (3 file con chưa mở)');

    const deep = await call(client, 'render_flow', { page: 'index', max_depth: 10 });
    expect(deep.text).not.toContain('dừng ở tầng');
  });

  it('render_flow: limit cắt số dòng của cây', async () => {
    const client = await connect();
    const result = await call(client, 'render_flow', { page: 'index', max_depth: 10, limit: 2 });

    expect(result.text).toContain('  ... và 9 dòng nữa (tăng limit để xem hết)');
  });

  it('render_flow: nhận một file làm gốc', async () => {
    const client = await connect();
    const result = await call(client, 'render_flow', { page: 'sections/hero.liquid' });

    expect(result.isError).toBe(false);
    expect(result.text).toContain('sections/hero.liquid (section) kéo theo 2 file');
  });

  it('danh sách dài bị cắt ở 50 dòng theo mặc định, limit đổi được', async () => {
    // Một snippet gọi 60 snippet khác.
    const names = Array.from({ length: 60 }, (_, index) => `item-${String(index).padStart(2, '0')}`);
    // Mỗi snippet đó lại gọi chung một snippet lá, để lá có hơn 50 file phía trên.
    for (const name of names) {
      await writeFile(path.join(themeRoot, 'snippets', `${name}.liquid`), "{% render 'leaf' %}");
    }
    await writeFile(path.join(themeRoot, 'snippets', 'leaf.liquid'), '<p>x</p>');
    // Ba file không ai gọi, cho dead_code.
    for (const name of ['dead-a', 'dead-b', 'dead-c']) {
      await writeFile(path.join(themeRoot, 'snippets', `${name}.liquid`), '<p>x</p>');
    }
    await appendFile(
      path.join(themeRoot, 'snippets', 'card.liquid'),
      names.map((name) => `{% render '${name}' %}`).join('\n'),
    );
    await analyze(themeRoot);

    const client = await connect();

    const byDefault = await call(client, 'context', { target: 'snippets/card.liquid' });
    expect(byDefault.text).toContain('Gọi tới (60):');
    expect(byDefault.text).toContain('  ... và 10 file nữa (tăng limit để xem hết)');

    const all = await call(client, 'context', { target: 'snippets/card.liquid', limit: 60 });
    expect(all.text).not.toContain('file nữa');
    expect(all.text).toContain('snippets/item-59.liquid');

    // impact trên snippet lá: 60 snippet gọi nó, cộng card và mọi file phía
    // trên card (8 file), tức 69 file. Mặc định chỉ hiện 50.
    const impactDefault = await call(client, 'impact', { target: 'snippets/leaf.liquid' });
    expect(impactDefault.text).toContain('ảnh hưởng 69 file');
    expect(impactDefault.text).toContain('  ... và 19 file nữa (tăng limit để xem hết)');

    const impactOne = await call(client, 'impact', { target: 'snippets/leaf.liquid', limit: 1 });
    expect(impactOne.text).toContain('  ... và 68 file nữa (tăng limit để xem hết)');
    // Danh sách trang không bị cắt dù limit là 1.
    expect(impactOne.text).toContain('Trang (4):');
    expect(impactOne.text).toContain('customers/login');

    const impactAll = await call(client, 'impact', { target: 'snippets/leaf.liquid', limit: 1000 });
    expect(impactAll.text).not.toContain('file nữa');

    // dead_code: ba file chắc chắn không dùng.
    const deadDefault = await call(client, 'dead_code');
    expect(deadDefault.text).toContain('Chắc chắn không dùng (3):');
    expect(deadDefault.text).not.toContain('file nữa');

    const deadOne = await call(client, 'dead_code', { limit: 1 });
    expect(deadOne.text).toContain('Chắc chắn không dùng (3):');
    expect(deadOne.text).toContain('  ... và 2 file nữa (tăng limit để xem hết)');
  });

  it('từ chối tham số sai kiểu hoặc ngoài khoảng mà không làm server chết', async () => {
    const client = await connect();

    const attempts: [string, Record<string, unknown>][] = [
      ['impact', {}],
      ['impact', { target: '' }],
      ['impact', { target: 'snippets/card.liquid', limit: 0 }],
      ['impact', { target: 'snippets/card.liquid', limit: 1.5 }],
      ['render_flow', { page: 'index', max_depth: 0 }],
      ['search', { kind: 'snippets' }],
      ['search', { query: 5 }],
    ];

    for (const [name, args] of attempts) {
      // SDK báo tham số sai theo một trong hai cách tuỳ phiên bản: kết quả có
      // isError, hoặc lỗi giao thức. Cả hai đều là "bị từ chối".
      const outcome = await client.callTool({ name, arguments: args }).then(
        (result) => result.isError === true,
        () => true,
      );
      expect(outcome, `${name} ${JSON.stringify(args)}`).toBe(true);
    }

    // Server vẫn trả lời bình thường sau các lời gọi sai.
    expect((await call(client, 'list_themes')).isError).toBe(false);
  });
});

describe('MCP server — chọn theme', () => {
  /** Thêm theme thứ hai, khác theme đầu ở chỗ có snippets/second-only.liquid. */
  async function addSecondTheme(): Promise<string> {
    const second = path.join(tmp, 'second-theme');
    await cp(FIXTURE, second, { recursive: true });
    await writeFile(path.join(second, 'snippets', 'second-only.liquid'), '<p>x</p>');
    await analyze(second);
    return second;
  }

  it('không nêu theme: dùng theme chứa thư mục đang làm việc', async () => {
    const second = await addSecondTheme();
    const client = await connect(path.join(second, 'sections'));

    const result = await call(client, 'search', { query: 'second-only' });

    expect(result.text).toContain(`Theme: second-theme (${second})`);
    expect(result.text).toContain('snippets/second-only.liquid');
  });

  it('nêu theme bằng tên hoặc đường dẫn, dù đang đứng trong theme khác', async () => {
    const second = await addSecondTheme();
    const client = await connect(themeRoot);

    const byName = await call(client, 'search', { query: 'second-only', theme: 'second-theme' });
    const byPath = await call(client, 'search', { query: 'second-only', theme: second });
    const here = await call(client, 'search', { query: 'second-only' });

    expect(byName.text).toContain('snippets/second-only.liquid');
    expect(byPath.text).toBe(byName.text);
    expect(here.text).toContain(`Theme: mini-theme (${themeRoot})`);
    expect(here.text).toContain('Không có node nào khớp "second-only"');
  });

  it('đứng ngoài mọi theme, chỉ có một theme: dùng theme đó', async () => {
    const client = await connect(os.tmpdir());
    const result = await call(client, 'impact', { target: 'snippets/card.liquid' });

    expect(result.isError).toBe(false);
    expect(result.text).toContain(`Theme: mini-theme (${themeRoot})`);
  });

  it('đứng ngoài mọi theme, có hai theme: báo lỗi kèm danh sách để chọn', async () => {
    const second = await addSecondTheme();
    const client = await connect(os.tmpdir());

    const result = await call(client, 'impact', { target: 'snippets/card.liquid' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('có 2 theme đã phân tích');
    expect(result.text).toContain(themeRoot);
    expect(result.text).toContain(second);
  });

  it('báo lỗi khi tên theme không có', async () => {
    const client = await connect();
    const result = await call(client, 'dead_code', { theme: 'khong-co' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('Không có theme "khong-co"');
    expect(result.text).toContain('mini-theme');
  });
});

describe('MCP server — lỗi và đồ thị cũ', () => {
  it('tên file không có: báo lỗi kèm gợi ý, không ném lỗi giao thức', async () => {
    const client = await connect();
    const result = await call(client, 'impact', { target: 'snippets/car' });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Lỗi: Không có node "snippets\/car"/);
    expect(result.text).toContain('snippets/card.liquid');
  });

  it('chưa có theme nào: chỉ cách analyze', async () => {
    unregisterTheme(themeRoot);
    const empty = path.join(tmp, 'empty');
    await mkdir(empty);

    const client = await connect(empty);

    for (const name of ['impact', 'context']) {
      const result = await call(client, name, { target: 'snippets/card.liquid' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('themegraph analyze');
    }

    // list_themes không cần theme nào nên không phải là lỗi.
    const list = await call(client, 'list_themes');
    expect(list.isError).toBe(false);
    expect(list.text).toContain('Chưa có theme nào');
  });

  it('theme có trong sổ nhưng graph.db đã mất: báo cần analyze', async () => {
    await rm(path.join(themeRoot, '.themegraph'), { recursive: true });

    const client = await connect();
    const result = await call(client, 'render_flow', { page: 'index' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('themegraph analyze');
  });

  it('đồ thị còn mới: không có dòng cảnh báo', async () => {
    const client = await connect();
    const result = await call(client, 'impact', { target: 'snippets/card.liquid' });

    expect(result.text).not.toContain('ĐỒ THỊ ĐÃ CŨ');
  });

  it('đồ thị đã cũ: câu trả lời vẫn có, kèm cảnh báo nêu file đã đổi', async () => {
    const client = await connect();
    await appendFile(path.join(themeRoot, 'snippets', 'card.liquid'), "\n{% render 'moi' %}");
    await writeFile(path.join(themeRoot, 'snippets', 'moi.liquid'), '<p>moi</p>');

    const result = await call(client, 'impact', { target: 'snippets/card.liquid' });
    const lines = result.text.split('\n');

    expect(result.isError).toBe(false);
    expect(lines[0]).toBe(`Theme: mini-theme (${themeRoot})`);
    expect(lines[1]).toContain('ĐỒ THỊ ĐÃ CŨ');
    expect(lines[1]).toContain('2 file');
    expect(lines[1]).toContain('snippets/card.liquid');
    expect(lines[1]).toContain('snippets/moi.liquid');
    expect(lines[1]).toContain('themegraph analyze');
    expect(result.text).toContain('ảnh hưởng 8 file');

    // Sau khi phân tích lại, cùng client đó thấy đồ thị mới.
    await analyze(themeRoot);
    const fresh = await call(client, 'impact', { target: 'snippets/moi.liquid' });
    expect(fresh.text).not.toContain('ĐỒ THỊ ĐÃ CŨ');
    expect(fresh.text).toContain('Sửa snippets/moi.liquid');
  });

  it('không giữ graph.db sau mỗi lời gọi, kể cả khi lời gọi lỗi', async () => {
    const client = await connect();
    await call(client, 'impact', { target: 'snippets/card.liquid' });
    await call(client, 'impact', { target: 'khong-co' });

    // Nếu database còn mở, Windows sẽ từ chối xoá file này.
    await expect(rm(path.join(themeRoot, '.themegraph', 'graph.db'))).resolves.toBeUndefined();
  });
});
