import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Trong test, gói cli dùng thẳng MÃ NGUỒN của core thay vì bản đã build
      // trong dist/. Nhờ vậy test không bao giờ chạy nhầm trên một bản build cũ.
      // (Lệnh themegraph thật thì dùng dist/; test "chạy lệnh đã build" kiểm phần đó.)
      '@themegraph/core': path.join(import.meta.dirname, 'packages/core/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    environment: 'node',
  },
});
