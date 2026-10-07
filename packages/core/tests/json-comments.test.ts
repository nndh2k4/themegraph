import { describe, expect, it } from 'vitest';

import { stripJsonComments } from '../src/json-comments.js';

/** Gỡ chú thích rồi đọc bằng JSON.parse, như các bộ trích của lõi làm. */
const parse = (content: string): unknown => JSON.parse(stripJsonComments(content));

describe('stripJsonComments', () => {
  it('nội dung không có chú thích thì giữ nguyên từng ký tự', () => {
    const content = '{\r\n  "a": [1, 2, { "b": "c" }],\n  "d": null\n}';

    expect(stripJsonComments(content)).toBe(content);
    expect(stripJsonComments('')).toBe('');
  });

  it('gỡ khối chú thích ở đầu file, như file do theme editor của Shopify sinh ra', () => {
    const content = `/*
 * ------------------------------------------------------------
 * IMPORTANT: The contents of this file are auto-generated.
 * ------------------------------------------------------------
 */
{ "sections": {}, "order": [] }`;

    expect(parse(content)).toEqual({ sections: {}, order: [] });
  });

  it('gỡ chú thích một dòng // nằm giữa JSON: trên dòng riêng và sau một giá trị', () => {
    const content = `{
  "menu": "Menu",
  // Ghi chú cho người dịch: nhãn của menu chính.
  "navigation": "Main navigation", // cuối dòng
  "count": 2
}`;

    expect(parse(content)).toEqual({ menu: 'Menu', navigation: 'Main navigation', count: 2 });
  });

  it('gỡ khối chú thích nằm giữa JSON, một dòng hay nhiều dòng', () => {
    expect(parse('{ "a": /* giữa */ 1, "b": 2 }')).toEqual({ a: 1, b: 2 });
    expect(parse('{\n  "a": 1,\n  /* nhiều\n     dòng */\n  "b": 2\n}')).toEqual({ a: 1, b: 2 });
  });

  it('không đụng tới // và /* nằm TRONG chuỗi', () => {
    const content = '{ "url": "https://shopify.com/a//b", "glob": "src/**/*.js", "note": "a /* b */ c // d" }';

    expect(stripJsonComments(content)).toBe(content);
    expect(parse(content)).toEqual({ url: 'https://shopify.com/a//b', glob: 'src/**/*.js', note: 'a /* b */ c // d' });
  });

  it('dấu nháy được thoát bằng \\ không kết thúc chuỗi', () => {
    // Chuỗi chứa \" rồi mới tới //: phần // vẫn nằm trong chuỗi.
    const inside = '{ "a": "nói \\"xin chào\\" // vẫn trong chuỗi" }';
    expect(stripJsonComments(inside)).toBe(inside);

    // Chỉ MỘT dấu nháy được thoát: nếu nó bị coi là đóng chuỗi thì phần sau thành chú thích.
    const single = '{ "a": "x\\" // y" }';
    expect(stripJsonComments(single)).toBe(single);

    // Chuỗi kết thúc bằng một dấu \\ đã được thoát: dấu nháy sau đó ĐÓNG chuỗi, nên // là chú thích.
    const after = '{ "path": "C:\\\\" } // chú thích';
    expect(parse(after)).toEqual({ path: 'C:\\' });
  });

  it('giữ nguyên độ dài và mọi ký tự xuống dòng, để vị trí lỗi của JSON.parse khớp với file gốc', () => {
    const content = '/* đầu\r\n file */\r\n{\r\n  // ghi chú\r\n  "a": 1,\r\n  "b" 2\r\n}';
    const stripped = stripJsonComments(content);

    expect(stripped).toHaveLength(content.length);
    expect(stripped.split('\n')).toHaveLength(content.split('\n').length);
    expect(stripped.split('\r')).toHaveLength(content.split('\r').length);
    // Lỗi cú pháp nằm ở dòng 6 của file gốc ("b" thiếu dấu hai chấm), và JSON.parse báo đúng dòng đó.
    expect(() => JSON.parse(stripped)).toThrow(/line 6/);
  });

  it('bỏ dấu BOM ở đầu file', () => {
    expect(parse('\uFEFF{ "a": 1 }')).toEqual({ a: 1 });
    expect(parse('\uFEFF/* đầu */ { "a": 1 }')).toEqual({ a: 1 });
  });

  it('chú thích ở cuối file, có hay không có ký tự xuống dòng sau nó', () => {
    expect(parse('{ "a": 1 }\n// hết')).toEqual({ a: 1 });
    expect(parse('{ "a": 1 } /* hết */')).toEqual({ a: 1 });
  });

  it('khối chú thích không đóng thì phần còn lại của file bị coi là chú thích', () => {
    expect(stripJsonComments('{ "a": 1 } /* quên\nđóng')).toBe('{ "a": 1 }        \n    ');
    expect(() => parse('{ "a": 1, /* quên đóng\n "b": 2 }')).toThrow();
  });

  it('nhiều khối chú thích trong một file: mỗi khối đóng ở dấu */ đầu tiên SAU chỗ nó mở', () => {
    expect(parse('/* một */ { "x": /* hai */ 1, /* ba */ "y": 2 }')).toEqual({ x: 1, y: 2 });
    // "/*/" mở một khối; dấu * của nó không được tính là bắt đầu của dấu đóng.
    const tricky = '/*/ vẫn là chú thích */ 1';
    expect(stripJsonComments(tricky)).toBe(' '.repeat(tricky.length - 2) + ' 1');
  });

  it('một dấu / đứng lẻ không phải chú thích: để nguyên cho JSON.parse báo lỗi', () => {
    expect(stripJsonComments('{ "a": 1 / 2 }')).toBe('{ "a": 1 / 2 }');
  });

  it('chuỗi không đóng không làm hàm chạy quá cuối nội dung', () => {
    expect(stripJsonComments('{ "a": "dở dang // không phải chú thích')).toBe('{ "a": "dở dang // không phải chú thích');
    expect(stripJsonComments('{ "a": "kết thúc bằng \\')).toBe('{ "a": "kết thúc bằng \\');
  });
});
