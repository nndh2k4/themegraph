import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Giao diện là các file tĩnh; lệnh `themegraph serve` phục vụ thư mục dist/
// cùng cổng với API. Khi phát triển (pnpm --filter @themegraph/web dev), Vite
// chạy ở cổng riêng và chuyển mọi lời gọi /api sang `themegraph serve`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:7777",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
