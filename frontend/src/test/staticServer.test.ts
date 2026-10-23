/**
 * [Gate G3] DEP-03 本番用の配信(server/static-server.mjs)。実際に待ち受けて HTTP で確かめる。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createStaticServer, hostAllowed, resolveInside } from '../../server/static-server.mjs';
import { allowedHosts, apiUrlForHost, hostnameOf, securityHeaders } from '@/config/securityHeaders';

let server: Server;
let port = 0;
let root = '';
let outside = '';

interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }

function get(path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: `localhost:${port}`, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tc-static-'));
  outside = mkdtempSync(join(tmpdir(), 'tc-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'SECRET');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>TravelCanvas</title>' + ' '.repeat(600));
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log("app");' + '/* pad */'.repeat(200));
  writeFileSync(join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(root, '.env'), 'HIDDEN=1');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
  server = createStaticServer({
    root,
    headersFor: (host) => securityHeaders(apiUrlForHost('http://localhost:8001', host), false),
    allowedHosts: allowedHosts('omega-dev2'),
    hostnameOf,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('本番用の配信 (Gate G3 DEP-03)', () => {
  it('画面の経路は index.html(no-cache)・CSP 等のヘッダーつき', async () => {
    for (const p of ['/', '/planner/abc/today', '/s/tok_en-1.2', '/settings?tab=security']) {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(String(r.headers['content-type'])).toContain('text/html');
      expect(r.headers['cache-control']).toBe('no-cache');
      expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.headers['strict-transport-security']).toBeUndefined();
    }
  });

  it('開いた名前の :8001 を CSP の通信先にする(vite preview と同じ)', async () => {
    const r = await get('/', { Host: 'omega-dev2:4173' });
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toContain('connect-src \'self\' http://omega-dev2:8001');
    const ip = await get('/', { Host: '192.168.1.11:4173' });
    expect(ip.headers['content-security-policy']).toContain('http://192.168.1.11:8001');
  });

  it('許していない名前は 403(DNS の付け替えでの攻撃を防ぐ)', async () => {
    const r = await get('/', { Host: 'evil.example' });
    expect(r.status).toBe(403);
    expect(r.body.toString()).toContain('not allowed');
    expect(hostAllowed('omega-dev2', ['omega-dev2'])).toBe(true);
    expect(hostAllowed('sub.localhost', [])).toBe(true);
    expect(hostAllowed(undefined, [])).toBe(false);
  });

  it('/assets/ は1年 immutable・gzip・ETag で 304', async () => {
    const r = await get('/assets/index-abc123.js', { 'Accept-Encoding': 'gzip' });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(r.body).toString()).toContain('console.log("app")');
    const etag = String(r.headers.etag);
    const again = await get('/assets/index-abc123.js', { 'If-None-Match': etag });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it('無いファイル(/assets/・拡張子あり)は 404。index.html を返さない', async () => {
    expect((await get('/assets/missing.js')).status).toBe(404);
    expect((await get('/missing.css')).status).toBe(404);
    expect((await get('/favicon.svg')).status).toBe(200);
  });

  it('パスの外・隠しファイル・壊れた符号化・シンボリックリンクで外へは出ない', async () => {
    for (const p of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/.env', '/%00', '/%E0%A4%A', '/a\\..\\b']) {
      const r = await get(p);
      expect([400, 404]).toContain(r.status);
      expect(r.body.toString()).not.toContain('root:');
      expect(r.body.toString()).not.toContain('HIDDEN');
    }
    const link = await get('/link.txt');
    expect(link.status).toBe(404);
    expect(link.body.toString()).not.toContain('SECRET');
    expect(resolveInside('/srv', '/a/../../b')).toBeNull();
  });

  it('GET・HEAD 以外は 405。HEAD は本文なし', async () => {
    expect((await get('/', {}, 'POST')).status).toBe(405);
    const head = await get('/', {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
  });
});
