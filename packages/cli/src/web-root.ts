import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Chọn thư mục chứa bản build của giao diện web cho lệnh serve.
 *
 * Giao diện có thể nằm ở hai nơi, tuỳ lệnh `themegraph` được cài bằng cách nào:
 *
 *   1. `<gói>/web/`           cài từ gói phát hành (file .tgz): giao diện được
 *                             chép sẵn vào trong gói, cạnh thư mục dist/
 *   2. `packages/web/dist/`   chạy trong repo mã nguồn, sau `pnpm build`
 *
 * `candidates` là các thư mục cần thử, theo thứ tự ưu tiên. Hàm trả về thư mục
 * đầu tiên có index.html. Không thư mục nào có thì trả thư mục CUỐI CÙNG: đó
 * là nơi của repo mã nguồn, và server sẽ hiện trang hướng dẫn chạy `pnpm build`
 * thay vì một lỗi khó hiểu.
 */
export function resolveWebRoot(
  candidates: readonly string[],
  hasIndex: (dir: string) => boolean = (dir) => existsSync(path.join(dir, "index.html")),
): string {
  const last = candidates.at(-1);
  if (last === undefined) throw new Error("resolveWebRoot cần ít nhất một thư mục để thử.");

  return candidates.find((dir) => hasIndex(dir)) ?? last;
}
