export const VERSION = '0.1.0';

export * from './types.js';

// Tầng quét: thư mục theme -> danh sách file đã phân loại.
export { scanThemeDir } from './scanner.js';

// Tầng parse: một file + nội dung -> danh sách quan hệ thô.
export { extractRefs } from './extract.js';
export { extractJsonRefs } from './extract-json.js';
export { extractLiquidRefs } from './extract-liquid.js';
