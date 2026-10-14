import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { ApiRequest, ApiResponse } from "./api.types.js";
import { ServerModule } from "./server.module.js";
import { serveStatic } from "./static.js";

/** Cổng mặc định của `themegraph serve`. */
export const DEFAULT_PORT = 7777;

/** Server chỉ nghe trên máy này; không có cờ nào mở nó ra mạng. */
export const HOST = "127.0.0.1";

export interface ServeOptions {
  /** Cổng nghe. 0 để hệ điều hành chọn một cổng trống (test dùng). */
  port?: number;
  /** Thư mục chứa bản build của giao diện web (có index.html). */
  webRoot: string;
}

/** Một server đang chạy. */
export interface RunningServer {
  port: number; // cổng thật đang nghe
  url: string; // địa chỉ để mở trong trình duyệt
  close(): Promise<void>;
}

/** Header gắn vào mọi câu trả lời. */
const COMMON_HEADERS = { "x-content-type-options": "nosniff" };

function send(
  response: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: Buffer,
  headOnly: boolean,
): void {
  response.writeHead(status, { ...COMMON_HEADERS, ...headers, "content-length": String(body.length) });
  response.end(headOnly ? undefined : body);
}

function sendJson(response: ServerResponse, status: number, body: unknown, headOnly: boolean): void {
  send(
    response,
    status,
    // Dữ liệu đổi sau mỗi lần analyze, nên trình duyệt không được giữ lại.
    { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    Buffer.from(JSON.stringify(body), "utf8"),
    headOnly,
  );
}

/**
 * Xử lý một request tới /api/... bằng một ServerModule mới. Dùng cho test và
 * cho ai cần gọi API mà không mở cổng.
 */
export function handleApi(request: ApiRequest): Promise<ApiResponse> {
  return new ServerModule().router.handle(request);
}

/**
 * Tạo hàm xử lý request của server: /api/... đi tới router của API, mọi thứ
 * khác là file của giao diện web. Tách khỏi việc nghe cổng để test được riêng.
 *
 * Một listener dùng một ServerModule cho mọi request của nó.
 */
export function createListener(options: ServeOptions): (request: IncomingMessage, response: ServerResponse) => void {
  const module = new ServerModule();

  return (request, response) => {
    const method = request.method ?? "GET";
    const headOnly = method === "HEAD";

    if (!module.guard.canActivate(request.headers.host)) {
      sendJson(response, 403, { error: { code: "forbidden_host", message: "ThemeGraph chỉ phục vụ localhost." } }, headOnly);
      return;
    }

    // Phần host của URL không quan trọng; chỉ cần đường dẫn và tham số.
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      module.router.handle({ method, path: url.pathname, query: url.searchParams }).then(
        (result) => sendJson(response, result.status, result.body, headOnly),
        (error: unknown) => {
          // Lỗi không lường trước: báo 500 kèm thông báo, không để request treo.
          const message = error instanceof Error ? error.message : String(error);
          sendJson(response, 500, { error: { code: "internal", message } }, headOnly);
        },
      );
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendJson(response, 405, { error: { code: "method_not_allowed", message: "Chỉ nhận GET." } }, headOnly);
      return;
    }

    const file = serveStatic(options.webRoot, url.pathname);
    send(response, file.status, file.headers, file.body, headOnly);
  };
}

/** Nghe trên một địa chỉ; Promise bị từ chối nếu không nghe được. */
function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });
}

/** Dừng một server, cắt cả các kết nối trình duyệt còn giữ mở. */
function stop(server: Server): Promise<void> {
  return new Promise((done, failed) => {
    if (!server.listening) return done();
    server.close((error) => (error ? failed(error) : done()));
    // Trình duyệt giữ kết nối mở; không cắt thì close() chờ mãi.
    server.closeAllConnections();
  });
}

/**
 * Chạy server trên máy này. Promise hoàn thành khi server đã nghe; bị từ chối
 * nếu không nghe được (ví dụ cổng đang bận, lỗi mang code EADDRINUSE).
 *
 * Server nghe trên 127.0.0.1, và nếu được thì cả trên ::1 (địa chỉ nội bộ
 * của IPv6) với cùng cổng. Trên Windows tên "localhost" được thử ở ::1 trước;
 * không nghe ở đó thì mỗi request tới http://localhost mất thêm khoảng 0,2
 * giây chờ trước khi quay sang 127.0.0.1. Máy không có IPv6, hoặc cổng đó ở
 * ::1 đang bận, thì bỏ qua: 127.0.0.1 vẫn đủ để dùng.
 */
export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const listener = createListener(options);
  const v4: Server = createServer(listener);
  const v6: Server = createServer(listener);

  const port = await listen(v4, options.port ?? DEFAULT_PORT, HOST);
  await listen(v6, port, "::1").catch(() => undefined);

  return {
    port,
    url: `http://localhost:${port}`,
    close: async () => {
      await Promise.all([stop(v4), stop(v6)]);
    },
  };
}
