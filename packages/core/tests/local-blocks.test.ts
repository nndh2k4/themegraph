import { describe, expect, it } from 'vitest';

import { extractJsonRefs } from '../src/analyze/parsers/json-template.parser.js';
import { buildGraph, file } from './helpers.js';

describe('block trong JSON template', () => {
  const template = file('templates/index.json', 'template');
  const json = JSON.stringify({ sections: { s: { type: 'banner', blocks: { b1: { type: 'heading' }, b2: { type: 'card', blocks: { c: { type: 'heading' } } } } } } });

  it('ghi section hoặc block cha của từng block', () => {
    expect(extractJsonRefs(template, json).filter((r) => r.kind === 'block').map((r) => [r.to, r.parent])).toEqual([
      ['heading', 'sections/banner.liquid'],
      ['card', 'sections/banner.liquid'],
      ['heading', 'blocks/card.liquid'],
    ]);
  });

  it('block cục bộ của section không bị nối tới file cùng tên trong blocks/', () => {
    const files = [template, file('sections/banner.liquid', 'section'), file('blocks/heading.liquid', 'block'), file('blocks/card.liquid', 'block')];
    const graph = buildGraph(files, extractJsonRefs(template, json), {
      schemas: [
        { file: 'sections/banner.liquid', presets: 0, acceptsThemeBlocks: false, localBlockTypes: ['heading'] },
        { file: 'blocks/card.liquid', presets: 0, acceptsThemeBlocks: true, localBlockTypes: [] },
      ],
    });

    const blockRefs = graph.refs.filter((r) => r.kind === 'block').map((r) => [r.to, r.parent, r.status]);
    expect(blockRefs).toEqual(expect.arrayContaining([
      ['heading', 'sections/banner.liquid', 'local_block'],
      ['heading', 'blocks/card.liquid', 'resolved'],
    ]));

    // Chỉ còn đúng một lời gọi tới blocks/heading.liquid: lời gọi nằm dưới card.
    const toHeading = graph.edges.filter((e) => e.from === 'templates/index.json' && e.to === 'blocks/heading.liquid');
    expect(toHeading.map((e) => e.count)).toEqual([1]);
  });
});
