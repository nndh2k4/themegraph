import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Quy tắc phụ thuộc giữa các tầng (xem KIEN-TRUC-MOI.md):
 *
 *   models, common          không phụ thuộc module nào
 *   analyze, graph, theme   chỉ biết interface của repository, không làm I/O
 *   infrastructure          bản hiện thực thật; chỉ core.module.ts được nối nó vào
 *   cli, mcp, server, views chỉ dùng @themegraph/core qua API công khai
 *
 * Lưu ý: với flat config, khối sau GHI ĐÈ (không gộp) cấu hình của cùng một
 * luật trên cùng file, nên mỗi khối phải liệt kê đủ mẫu cấm của nó.
 */
const NO_IO = {
  group: ['node:fs', 'node:fs/*', 'node:sqlite', 'node:os'],
  message: 'Service không làm I/O trực tiếp: hỏi qua interface repository.',
};
const NO_INFRA = {
  group: ['**/infrastructure/**'],
  message: 'Chỉ core.module.ts được biết tầng hạ tầng; service nhận repository qua constructor.',
};
const NO_MODULES = {
  group: ['**/analyze/**', '**/graph/**', '**/theme/**'],
  message: 'models và common là tầng dưới cùng, không phụ thuộc module nào.',
};
const NO_CORE_INTERNALS = {
  group: ['@themegraph/core/*', '**/core/src/**'],
  message: 'Lớp vỏ chỉ dùng API công khai của @themegraph/core.',
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/tests/fixtures/**', 'tools/**', 'release/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/core/src/{analyze,graph,theme}/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_IO, NO_INFRA] }] },
  },
  {
    files: ['packages/core/src/{models,common}/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_IO, NO_INFRA, NO_MODULES] }] },
  },
  {
    files: ['packages/{cli,mcp,server,views}/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_CORE_INTERNALS] }] },
  },
);
