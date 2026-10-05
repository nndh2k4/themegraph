import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { analyze } from '@themegraph/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Các test ở đây mở lệnh ĐÃ BUILD (`node packages/cli/dist/cli.js mcp`) thành
 * một tiến trình con và nói chuyện với nó qua stdin/stdout, đúng như Claude
 * Code và Cursor làm. Chúng kiểm phần mà test trong bộ nhớ không thấy được:
 * lệnh có khởi động không, và stdout có sạch không.
 *
 * `pnpm test` build trước khi chạy test, nên dist/ luôn là bản mới.
 */
const BUILT_BIN = path.join(import.meta.dirname, '../../cli/dist/cli.js');
const FIXTURE = path.join(import.meta.dirname, '../../core/tests/fixtures/mini-theme');

let tmp: string;
let themeRoot: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'themegraph-stdio-'));
  themeRoot = path.join(tmp, 'mini-theme');
  await cp(FIXTURE, themeRoot, { recursive: true });
  await analyze(themeRoot);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Biến môi trường cho tiến trình con: như của test, gồm cả THEMEGRAPH_HOME tạm. */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

describe('themegraph mcp — qua stdio, trên lệnh đã build', () => {
  it('bắt tay, khai sáu tool và trả lời impact cho theme ở thư mục đang đứng', async () => {
    const stderr: string[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BUILT_BIN, 'mcp'],
      cwd: themeRoot,
      env: childEnv(),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));

    const client = new Client({ name: 'test', version: '0.0.0' });
    try {
      await client.connect(transport);

      expect(client.getServerVersion()?.name).toBe('themegraph');
      expect(client.getInstructions()).toContain('Shopify theme');

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(6);

      const result = await client.callTool({ name: 'impact', arguments: { target: 'card' } });
      const content = result.content as { text: string }[];

      expect(result.isError).not.toBe(true);
      expect(content[0]?.text).toContain(`Theme: mini-theme (${themeRoot})`);
      expect(content[0]?.text).toContain('Sửa snippets/card.liquid (snippet) ảnh hưởng 8 file và 4 trên 4 trang.');
    } finally {
      await client.close();
    }

    // Không có cảnh báo SQLite hay log nào lọt ra, kể cả ở stderr.
    expect(stderr.join('')).toBe('');
  });

  it('--theme đặt theme mặc định khi server được mở ở thư mục khác', async () => {
    // Thêm theme thứ hai để "theme duy nhất trong sổ" không tự cứu lời gọi.
    const second = path.join(tmp, 'second-theme');
    await cp(FIXTURE, second, { recursive: true });
    await analyze(second);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BUILT_BIN, 'mcp', '--theme', second],
      cwd: os.tmpdir(),
      env: childEnv(),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'impact', arguments: { target: 'card' } });

      expect(result.isError).not.toBe(true);
      expect((result.content as { text: string }[])[0]?.text).toContain(`Theme: second-theme (${second})`);
    } finally {
      await client.close();
    }
  });

  it('stdout chỉ chứa thông điệp JSON-RPC, mỗi dòng một thông điệp', async () => {
    const child = spawn(process.execPath, [BUILT_BIN, 'mcp'], { cwd: themeRoot, env: childEnv() });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'dead_code', arguments: {} } });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'impact', arguments: { target: 'khong-co' } } });

    // Chờ tới khi có đủ ba câu trả lời rồi đóng stdin; server phải tự thoát.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`quá giờ; stdout: ${stdout}; stderr: ${stderr}`)), 15_000);
      child.stdout.on('data', () => {
        if (stdout.split('\n').filter((line) => line.trim() !== '').length >= 3) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    child.stdin.end();
    expect(await exited).toBe(0);

    const lines = stdout.split('\n').filter((line) => line.trim() !== '');
    const messages = lines.map((line) => JSON.parse(line) as { jsonrpc: string; id: number; result?: { isError?: boolean } });

    expect(messages.map((message) => message.id).sort()).toEqual([1, 2, 3]);
    expect(messages.every((message) => message.jsonrpc === '2.0')).toBe(true);
    // Lỗi của tool (tên file không có) là một KẾT QUẢ có isError, không làm server in gì ra ngoài giao thức.
    expect(messages.find((message) => message.id === 3)?.result?.isError).toBe(true);
    expect(stderr).toBe('');
  });
});
