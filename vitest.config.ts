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
    // Cho mỗi file test một thư mục THEMEGRAPH_HOME tạm (xem file đó).
    setupFiles: ['./vitest.setup.ts'],
    // Hầu hết test tạo thư mục tạm và file SQLite thật. Khi máy đang bận, một
    // test như vậy có lúc vượt mức 5 giây mặc định dù không có gì sai.
    testTimeout: 20_000,
  },
});
