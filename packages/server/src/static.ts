import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Một file tĩnh sẵn sàng gửi đi. */
export interface StaticResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** Kiểu nội dung theo đuôi file. Chỉ gồm những loại bản build của web sinh ra. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/** Trang hiện ra khi giao diện web chưa được build. API vẫn dùng được. */
const NOT_BUILT = `<!doctype html>
<html lang="vi">
<meta charset="utf-8">
<title>ThemeGraph</title>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem">
<h1>ThemeGraph</h1>
<p>Server đang chạy, nhưng giao diện web chưa được build.</p>
<p>Trong thư mục mã nguồn của ThemeGraph, chạy <code>pnpm build</code> rồi tải lại trang này.</p>
<p>API vẫn dùng được: <a href="/api/themes">/api/themes</a></p>
</body>
</html>
`;

function html(status: number, body: string): StaticResponse {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
    body: Buffer.from(body, "utf8"),
  };
}

/**
 * Trả file của giao diện web ứng với một đường dẫn URL.
 *
 * - "/" và mọi đường dẫn không có đuôi file trả index.html: giao diện là ứng
 *   dụng một trang, tự hiểu phần còn lại của địa chỉ.
 * - Đường dẫn có đuôi mà không có file thì 404.
 * - Đường dẫn trỏ ra ngoài `webRoot` (qua "..") thì 404, không bao giờ đọc
 *   file nào bên ngoài thư mục build.
 * - Chưa có bản build thì trả một trang hướng dẫn với mã 503.
 */
export function serveStatic(webRoot: string, urlPath: string): StaticResponse {
  const root = path.resolve(webRoot);
  const indexFile = path.join(root, "index.html");

  if (!existsSync(indexFile)) return html(503, NOT_BUILT);

  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return html(404, "Không có trang này.");
  }

  // path.join gỡ các đoạn ".."; sau đó kiểm lại kết quả vẫn nằm trong root.
  const requested = path.join(root, decoded);
  const inside = requested === root || requested.startsWith(root + path.sep);
  if (!inside) return html(404, "Không có trang này.");

  const isFile = existsSync(requested) && statSync(requested).isFile();

  if (!isFile) {
    // Có đuôi file tức là xin một tài nguyên cụ thể; không có thì là thiếu thật.
    if (path.extname(decoded) !== "") return html(404, "Không có file này.");

    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
      body: readFileSync(indexFile),
    };
  }

  const type = CONTENT_TYPES[path.extname(requested).toLowerCase()] ?? "application/octet-stream";

  // Vite đặt tên file trong assets/ kèm hash nội dung, nên giữ lâu được;
  // index.html thì phải hỏi lại mỗi lần để thấy bản build mới.
  const immutable = decoded.startsWith("/assets/");

  return {
    status: 200,
    headers: {
      "content-type": type,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
    body: readFileSync(requested),
  };
}
