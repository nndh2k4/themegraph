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

  it('Liquid lệch mà Shopify chấp nhận thì đọc bằng parser dễ dãi, kèm cảnh báo', () => {
    const content = "{% for x in list %}{% if x %}a{%- endif- %}{% endfor %}{% render 'b' %}";
    const result = extractLiquid(file('snippets/x.liquid', 'snippet'), content);

    expect(result.refs.map((ref) => ref.to)).toContain('b');
    expect(result.warnings).toEqual([expect.stringContaining('dễ dãi')]);
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
