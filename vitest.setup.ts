import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

// analyze() ghi mỗi theme nó phân tích vào sổ đăng ký toàn cục, mặc định là
// ~/.themegraph/registry.json. Test không được đụng vào thư mục home thật của
// người chạy, nên mỗi file test nhận một thư mục "home" tạm của riêng nó.
//
// Riêng cho từng file, không dùng chung: vitest chạy các file test song song,
// và nhiều tiến trình cùng đọc-sửa-ghi một registry.json sẽ giẫm lên nhau.
// Tiến trình con do test mở (lệnh đã build) thừa hưởng biến môi trường này.
const home = mkdtempSync(path.join(os.tmpdir(), 'themegraph-home-'));
process.env.THEMEGRAPH_HOME = home;

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});
