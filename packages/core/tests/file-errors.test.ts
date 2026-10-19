import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractLiquid } from '../src/analyze/parsers/liquid.parser.js';
import type { GraphRepository } from '../src/graph/graph.repository.js';
import { core, file, openGraph, scopeOf } from './helpers.js';

describe('file lỗi một phần', () => {
  it('schema hỏng vẫn giữ quan hệ của phần Liquid, kèm cảnh báo', () => {
    const content = "{% render 'card' %}{{ 'a.css' | asset_url }}{% schema %}{ \"name\": }{% endschema %}";
    const result = extractLiquid(file('sections/x.liquid', 'section'), content);

    expect(result.refs.map((ref) => ref.to)).toEqual(['card', 'a.css']);
    expect(result.schema).toBeNull();
    expect(result.warnings).toEqual([expect.stringContaining('{% schema %}')]);
  });

  it('đóng tag sai thứ tự thì đọc bằng parser dễ dãi, kèm cảnh báo có thể thiếu quan hệ', () => {
    const content = "{% for x in list %}{% if x %}a{% endfor %}{% render 'b' %}";
    const result = extractLiquid(file('snippets/x.liquid', 'snippet'), content);

    expect(result.refs.map((ref) => ref.to)).toEqual(['b']);
    expect(result.warnings).toEqual([expect.stringMatching(/dễ dãi.*có thể bị thiếu/)]);
  });

  it('{%- endif- %} mà Shopify chấp nhận thì đọc bằng parser chuẩn, không cảnh báo', () => {
    const content = "{% for x in list %}{% if x %}{% render 'a' %}{%- endif- %}{% endfor %}{% render 'b' %}";
    const result = extractLiquid(file('snippets/x.liquid', 'snippet'), content);

    expect(result.refs.map((ref) => ref.to)).toEqual(['a', 'b']);
    expect(result.warnings).toEqual([]);
  });
});

describe('lỗi được ghi vào đồ thị', () => {
  const FIXTURE = path.join(import.meta.dirname, 'fixtures/mini-theme');
  let tmp: string;
  let themeRoot: string;
  let graph: GraphRepository | null = null;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-errors-'));
    themeRoot = path.join(tmp, 'mini-theme');
    await cp(FIXTURE, themeRoot, { recursive: true });
  });

  afterEach(async () => {
    graph?.close();
    graph = null;
    await rm(tmp, { recursive: true, force: true });
  });

  it('dead-code và context nhìn thấy file lỗi', async () => {
    await writeFile(path.join(themeRoot, 'sections', 'broken.liquid'), "{% render 'card' %}{% schema %}{ oops }{% endschema %}");
    await core().analyzer.analyze(themeRoot);
    graph = openGraph(themeRoot);

    expect(graph.fileErrors()).toEqual([{ file: 'sections/broken.liquid', message: expect.stringContaining('{% schema %}') }]);
    expect(scopeOf(graph).deadCode.findUnused().fileErrors).toHaveLength(1);
    expect(scopeOf(graph).context.describe('sections/broken.liquid').errors).toHaveLength(1);
    // Phần Liquid vẫn còn: broken gọi card.
    expect(graph.edgesFrom('sections/broken.liquid').map((edge) => edge.to)).toContain('snippets/card.liquid');
  });
});

describe('file lỗi và mức tin cậy của dead-code', () => {
  const FIXTURE = path.join(import.meta.dirname, 'fixtures/mini-theme');
  let tmp: string;
  let themeRoot: string;
  let graph: GraphRepository | null = null;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-errors-'));
    themeRoot = path.join(tmp, 'mini-theme');
    await cp(FIXTURE, themeRoot, { recursive: true });
    // Snippet không ai gọi: không có file lỗi nào thì chắc chắn là mã chết.
    await writeFile(path.join(themeRoot, 'snippets', 'orphan.liquid'), '<p>orphan</p>');
  });

  afterEach(async () => {
    graph?.close();
    graph = null;
    await rm(tmp, { recursive: true, force: true });
  });

  /** Phân tích theme rồi trả kết quả dead-code. */
  const deadCode = async () => {
    await core().analyzer.analyze(themeRoot);
    graph = openGraph(themeRoot);
    return scopeOf(graph).deadCode.findUnused();
  };

  const confidenceOf = (result: Awaited<ReturnType<typeof deadCode>>, id: string) =>
    result.files.find((entry) => entry.id === id)?.confidence;

  it('không có file lỗi: snippet không ai gọi là certain', async () => {
    const result = await deadCode();

    expect(result.fileErrors).toEqual([]);
    expect(confidenceOf(result, 'snippets/orphan.liquid')).toBe('certain');
  });

  it('có file .liquid lỗi: không còn mục certain nào, mọi mục là review', async () => {
    // File lỗi có thể là nơi gọi duy nhất của orphan mà đồ thị không thấy.
    await writeFile(path.join(themeRoot, 'sections', 'broken.liquid'), "{% render 'card' %}{% schema %}{ oops }{% endschema %}");
    const result = await deadCode();

    expect(result.fileErrors.map((error) => error.file)).toEqual(['sections/broken.liquid']);
    expect(result.certain).toBe(0);
    expect(result.files.map((entry) => entry.confidence)).not.toContain('certain');
    expect(confidenceOf(result, 'snippets/orphan.liquid')).toBe('review');
  });

  it('có JSON template lỗi: cũng hạ mọi mục xuống review', async () => {
    await writeFile(path.join(themeRoot, 'templates', 'page.json'), '{ "sections": ');
    const result = await deadCode();

    expect(result.fileErrors.map((error) => error.file)).toEqual(['templates/page.json']);
    expect(result.certain).toBe(0);
    expect(confidenceOf(result, 'snippets/orphan.liquid')).toBe('review');
  });

  it('lỗi chỉ ở locale và config: vẫn liệt kê lỗi nhưng không hạ mức', async () => {
    // Locale và settings_schema không gọi file nào, nên lỗi ở đó không che
    // được lời gọi nào tới orphan.
    await writeFile(path.join(themeRoot, 'locales', 'en.default.json'), '{ "general": ');
    await writeFile(path.join(themeRoot, 'config', 'settings_schema.json'), '[ { "name": ');
    const result = await deadCode();

    expect(result.fileErrors.map((error) => error.file)).toEqual(['config/settings_schema.json', 'locales/en.default.json']);
    expect(confidenceOf(result, 'snippets/orphan.liquid')).toBe('certain');
  });
});
