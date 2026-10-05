import { describe, expect, it } from 'vitest';

import { extractFile } from '../src/extract.js';
import { collectGlobalSettings, isGlobalSettingsSchema, settingIdsOf, settingNodeId } from '../src/extract-settings.js';
import type { ThemeFile } from '../src/types.js';

const CONFIG: ThemeFile = { path: 'config/settings_schema.json', kind: 'config', ext: 'json' };

describe('settingNodeId', () => {
  it('viết id theo đúng cách Liquid đọc setting, kèm file định nghĩa', () => {
    expect(settingNodeId(null, 'settings', 'cart_type')).toBe('setting:settings.cart_type');
    expect(settingNodeId('sections/header.liquid', 'section', 'logo')).toBe(
      'setting:sections/header.liquid#section.logo',
    );
    expect(settingNodeId('blocks/text.liquid', 'block', 'text')).toBe('setting:blocks/text.liquid#block.text');
  });
});

describe('settingIdsOf', () => {
  it('lấy id của từng setting, giữ thứ tự', () => {
    expect(settingIdsOf([{ type: 'text', id: 'title' }, { type: 'range', id: 'width' }])).toEqual(['title', 'width']);
  });

  it('bỏ qua mục chỉ để trình bày, vốn không có id', () => {
    const settings = [{ type: 'header', content: 'Layout' }, { type: 'text', id: 'title' }, { type: 'paragraph' }];

    expect(settingIdsOf(settings)).toEqual(['title']);
  });

  it('bỏ qua mục không phải object và id không phải chuỗi', () => {
    expect(settingIdsOf(['x', null, { id: 5 }, { id: 'ok' }])).toEqual(['ok']);
  });

  it('trả mảng rỗng khi settings không phải mảng', () => {
    expect(settingIdsOf(undefined)).toEqual([]);
    expect(settingIdsOf({ id: 'x' })).toEqual([]);
  });
});

describe('collectGlobalSettings', () => {
  it('gom setting của mọi nhóm thành id node toàn cục', () => {
    const content = JSON.stringify([
      { name: 'theme_info', theme_name: 'Mini' },
      { name: 'Colors', settings: [{ type: 'header', content: 'x' }, { type: 'color', id: 'accent' }] },
      { name: 'Cart', settings: [{ type: 'select', id: 'cart_type' }] },
    ]);

    expect(collectGlobalSettings(CONFIG, content)).toEqual(['setting:settings.accent', 'setting:settings.cart_type']);
  });

  it('bỏ id trùng giữa các nhóm', () => {
    const content = JSON.stringify([{ settings: [{ id: 'a' }] }, { settings: [{ id: 'a' }, { id: 'b' }] }]);

    expect(collectGlobalSettings(CONFIG, content)).toEqual(['setting:settings.a', 'setting:settings.b']);
  });

  it('trả mảng rỗng khi file không phải một mảng nhóm', () => {
    expect(collectGlobalSettings(CONFIG, '{}')).toEqual([]);
    expect(collectGlobalSettings(CONFIG, '["x", null]')).toEqual([]);
  });

  it('đọc được file có khối chú thích ở đầu', () => {
    expect(collectGlobalSettings(CONFIG, '/* auto */ [{ "settings": [{ "id": "a" }] }]')).toEqual(['setting:settings.a']);
  });

  it('ném lỗi có tên file khi JSON hỏng', () => {
    expect(() => collectGlobalSettings(CONFIG, '[ {')).toThrow('config/settings_schema.json');
  });
});

describe('extractFile với file config', () => {
  it('chỉ coi config/settings_schema.json là nơi khai setting toàn cục', () => {
    expect(isGlobalSettingsSchema(CONFIG)).toBe(true);
    expect(isGlobalSettingsSchema({ path: 'config/settings_data.json', kind: 'config', ext: 'json' })).toBe(false);
  });

  it('trả setting toàn cục của settings_schema.json, không có ref nào', () => {
    const result = extractFile(CONFIG, JSON.stringify([{ settings: [{ type: 'color', id: 'accent' }] }]));

    expect(result).toEqual({ refs: [], schema: null, translationKeys: [], settings: ['setting:settings.accent'] });
  });

  it('không đọc setting từ settings_data.json', () => {
    const data: ThemeFile = { path: 'config/settings_data.json', kind: 'config', ext: 'json' };

    expect(extractFile(data, JSON.stringify([{ settings: [{ id: 'x' }] }])).settings).toEqual([]);
  });
});
