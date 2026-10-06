import { createServer, request as httpRequest } from 'node:http';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { analyze, readRegistry, unregisterTheme } from '@themegraph/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HOST, isLocalHost, serveStatic, startServer, themeId } from '../src/index.js';
import type { RunningServer } from '../src/index.js';

const FIXTURE = path.join(import.meta.dirname, '../../core/tests/fixtures/mini-theme');

let tmp: string;
let webRoot: string;
let themeRoot: string;
let server: RunningServer | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-http-'));

  // Một "bản build" giả của giao diện web.
  webRoot = path.join(tmp, 'web');
  await mkdir(path.join(webRoot, 'assets'), { recursive: true });
  await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>web</title>');
  await writeFile(path.join(webRoot, 'assets', 'app-abc123.js'), 'console.log(1)');
  await writeFile(path.join(webRoot, 'assets', 'app-abc123.css'), 'body{}');
  await writeFile(path.join(webRoot, 'favicon.svg'), '<svg/>');
  // Một file nằm NGOÀI thư mục build, để thử đường dẫn có "..".
  await writeFile(path.join(tmp, 'secret.txt'), 'bi mat');

  themeRoot = path.join(tmp, 'mini-theme');
  await cp(FIXTURE, themeRoot, { recursive: true });
  for (const entry of readRegistry()) unregisterTheme(entry.path);
  await analyze(themeRoot);
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(tmp, { recursive: true, force: true });
});

describe('serveStatic', () => {
  it('trả index.html cho gốc và cho đường dẫn không có đuôi file', () => {
    for (const urlPath of ['/', '/theme/abc', '/bat/ky/dau']) {
      const response = serveStatic(webRoot, urlPath);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.body.toString()).toContain('<title>web</title>');
    }
  });

  it('trả file tĩnh với đúng kiểu nội dung', () => {
    expect(serveStatic(webRoot, '/assets/app-abc123.js').headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(serveStatic(webRoot, '/assets/app-abc123.css').headers['content-type']).toBe('text/css; charset=utf-8');
    expect(serveStatic(webRoot, '/favicon.svg').headers['content-type']).toBe('image/svg+xml');
    expect(serveStatic(webRoot, '/assets/app-abc123.js').body.toString()).toBe('console.log(1)');
  });

  it('file trong assets/ được giữ lâu, file khác thì không', () => {
    expect(serveStatic(webRoot, '/assets/app-abc123.js').headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(serveStatic(webRoot, '/favicon.svg').headers['cache-control']).toBe('no-cache');
  });

  it('404 khi đường dẫn có đuôi mà không có file, thay vì trả index.html', () => {
    expect(serveStatic(webRoot, '/assets/khong-co.js').status).toBe(404);
    expect(serveStatic(webRoot, '/khong-co.png').status).toBe(404);
  });

  it('không đọc file nằm ngoài thư mục build', () => {
    for (const urlPath of ['/../secret.txt', '/assets/../../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
      const response = serveStatic(webRoot, urlPath);

      expect(response.status).toBe(404);
      expect(response.body.toString()).not.toContain('bi mat');
    }
  });

  it('404 khi đường dẫn mã hoá hỏng', () => {
    expect(serveStatic(webRoot, '/%E0%A4%A').status).toBe(404);
  });

  it('kiểu nội dung mặc định cho đuôi lạ', async () => {
    await writeFile(path.join(webRoot, 'data.bin'), 'x');

    expect(serveStatic(webRoot, '/data.bin').headers['content-type']).toBe('application/octet-stream');
  });

  it('chưa có bản build thì trả trang hướng dẫn với mã 503', () => {
    const response = serveStatic(path.join(tmp, 'chua-build'), '/');

    expect(response.status).toBe(503);
    expect(response.body.toString()).toContain('pnpm build');
    expect(response.body.toString()).toContain('/api/themes');
  });
});

describe('isLocalHost', () => {
  it('nhận localhost, 127.0.0.1 và [::1], có hay không có cổng', () => {
    for (const host of ['localhost', 'localhost:7777', '127.0.0.1', '127.0.0.1:7777', '[::1]', '[::1]:7777']) {
      expect(isLocalHost(host)).toBe(true);
    }
  });

  it('từ chối mọi tên khác, kể cả tên bắt đầu bằng localhost', () => {
    for (const host of ['evil.example', 'evil.example:7777', 'localhost.evil.example', '127.0.0.1.evil.example', '192.168.1.5', '', undefined]) {
      expect(isLocalHost(host)).toBe(false);
    }
  });
});

/** Gửi một request thật, cho phép đặt header Host tuỳ ý (fetch không cho). */
function raw(port: number, urlPath: string, options: { host?: string; method?: string } = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>(
    (resolve, reject) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: urlPath,
          method: options.method ?? 'GET',
          headers: { host: options.host ?? `localhost:${port}` },
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (body += chunk));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
        },
      );
      request.on('error', reject);
      request.end();
    },
  );
}

describe('startServer', () => {
  beforeEach(async () => {
    server = await startServer({ port: 0, webRoot });
  });

  it('nghe trên một cổng trống của 127.0.0.1 và báo địa chỉ', () => {
    expect(server?.port).toBeGreaterThan(0);
    expect(server?.url).toBe(`http://localhost:${server?.port}`);
    // Không bao giờ là 0.0.0.0: server không được mở ra mạng.
    expect(HOST).toBe('127.0.0.1');
  });

  it('phục vụ API và giao diện web trên cùng một cổng', async () => {
    const api = await fetch(`${server?.url}/api/themes`);
    const page = await fetch(`${server?.url}/`);
    const asset = await fetch(`${server?.url}/assets/app-abc123.js`);

    expect(api.status).toBe(200);
    expect(api.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(api.headers.get('cache-control')).toBe('no-store');
    expect(((await api.json()) as { id: string }[])[0]?.id).toBe(themeId(themeRoot));

    expect(await page.text()).toContain('<title>web</title>');
    expect(await asset.text()).toBe('console.log(1)');
  });

  it('truyền mã lỗi và thân lỗi của API ra ngoài', async () => {
    const response = await fetch(`${server?.url}/api/themes/000000000000/overview`);

    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('theme_not_found');
  });

  it('đọc đúng tham số có ký tự đặc biệt', async () => {
    const id = themeId(themeRoot);
    const response = await fetch(`${server?.url}/api/themes/${id}/file?path=${encodeURIComponent('page:index')}`);

    expect(response.status).toBe(200);
    expect(((await response.json()) as { context: { node: { id: string } } }).context.node.id).toBe('page:index');
  });

  it('từ chối request có header Host không phải máy này', async () => {
    const port = server?.port ?? 0;
    const api = await raw(port, '/api/themes', { host: 'evil.example' });
    const page = await raw(port, '/', { host: `evil.example:${port}` });

    expect(api.status).toBe(403);
    expect(JSON.parse(api.body)).toMatchObject({ error: { code: 'forbidden_host' } });
    expect(page.status).toBe(403);
    expect(page.body).not.toContain('<title>web</title>');
    // Host đúng thì qua.
    expect((await raw(port, '/api/themes', { host: `127.0.0.1:${port}` })).status).toBe(200);
  });

  it('không gắn header CORS nào, và luôn gắn nosniff', async () => {
    const response = await raw(server?.port ?? 0, '/api/themes');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect((await raw(server?.port ?? 0, '/')).headers['x-content-type-options']).toBe('nosniff');
  });

  it('405 với POST, cả ở API lẫn ở file tĩnh', async () => {
    const port = server?.port ?? 0;

    expect((await raw(port, '/api/themes', { method: 'POST' })).status).toBe(405);
    expect((await raw(port, '/', { method: 'POST' })).status).toBe(405);
  });

  it('HEAD trả header mà không có thân', async () => {
    const response = await raw(server?.port ?? 0, '/api/themes', { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.body).toBe('');
    expect(Number(response.headers['content-length'])).toBeGreaterThan(2);
  });

  it('close() dừng server: cổng không còn nhận kết nối', async () => {
    const url = server?.url;
    await server?.close();
    server = undefined;

    await expect(fetch(`${url}/api/themes`)).rejects.toThrow();
  });

  it('báo lỗi EADDRINUSE khi cổng đang bận', async () => {
    await expect(startServer({ port: server?.port ?? 0, webRoot })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

/** Máy này có nghe được trên ::1 không; hỏi độc lập với startServer. */
function hasIpv6Loopback(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(0, '::1', () => probe.close(() => resolve(true)));
  });
}

describe('startServer — IPv6 nội bộ', () => {
  it('cũng trả lời trên [::1] cùng cổng khi máy có IPv6, và close() dừng cả hai', async () => {
    // Máy không có IPv6 thì server chỉ nghe ở 127.0.0.1; khi đó không có gì để kiểm.
    if (!(await hasIpv6Loopback())) return;

    server = await startServer({ port: 0, webRoot });
    const port = server.port;

    const viaV6 = await fetch(`http://[::1]:${port}/api/themes`).then(
      (response) => response.status,
      () => null,
    );
    // Cổng do hệ điều hành chọn ở 127.0.0.1 hiếm khi đang bận ở ::1.
    expect(viaV6).toBe(200);

    await server.close();
    server = undefined;
    await expect(fetch(`http://[::1]:${port}/api/themes`)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${port}/api/themes`)).rejects.toThrow();
  });
});
