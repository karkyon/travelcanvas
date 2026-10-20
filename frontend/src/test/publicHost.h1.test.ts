/**
 * [Gate H1] 画面を別の PC から omega-dev2・LAN の IP で開けるようにする規則。
 * 以前は vite preview が omega-dev2 という名前を拒否し(Blocked request)、API も localhost:8001(開いた PC 自身)を呼んでいた。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allowedHosts, apiUrlForHost, contentSecurityPolicy, hostnameOf } from '@/config/securityHeaders';

describe('画面を開いた名前に合わせる (Gate H1)', () => {
  it('設定が localhost の時だけ、API を画面と同じ名前(ポートはそのまま)へ向ける', () => {
    expect(apiUrlForHost('http://localhost:8001', 'omega-dev2:4173')).toBe('http://omega-dev2:8001');
    expect(apiUrlForHost('http://localhost:8001', '192.168.1.20:4173')).toBe('http://192.168.1.20:8001');
    expect(apiUrlForHost(undefined, 'omega-dev2:4173')).toBe('http://omega-dev2:8001');
    expect(apiUrlForHost('http://127.0.0.1:8001/api/v1', 'omega-dev2')).toBe('http://omega-dev2:8001/api/v1');
    // 開発・CI(localhost で開く)は変えない
    expect(apiUrlForHost('http://localhost:8001', 'localhost:4173')).toBe('http://localhost:8001');
    expect(apiUrlForHost('http://localhost:8001', '127.0.0.1:4173')).toBe('http://localhost:8001');
    expect(apiUrlForHost('http://localhost:8001', undefined)).toBe('http://localhost:8001');
    // 本番のドメインは変えない(画面の名前で API の宛先を書き換えさせない)
    expect(apiUrlForHost('https://api.travelcanvas.jp', 'evil.example:4173')).toBe('https://api.travelcanvas.jp');
    // 読めない Host は無視
    expect(apiUrlForHost('http://localhost:8001', 'bad host/x')).toBe('http://localhost:8001');
    expect(hostnameOf('[::1]:4173')).toBe('[::1]');
  });

  it('CSP の通信先も同じ名前になる', () => {
    const csp = contentSecurityPolicy(apiUrlForHost('http://localhost:8001', 'omega-dev2:4173'));
    expect(csp).toContain("connect-src 'self' http://omega-dev2:8001");
    expect(csp).toContain('report-uri http://omega-dev2:8001/api/v1/security/csp-report');
  });

  it('受け付ける名前は localhost と TC_PUBLIC_HOSTS(名前の文字だけ)', () => {
    expect(allowedHosts(undefined)).toEqual(['localhost', '127.0.0.1']);
    expect(allowedHosts('omega-dev2, travel.lan,bad host,')).toEqual(['localhost', '127.0.0.1', 'omega-dev2', 'travel.lan']);
  });

  it('docker の frontend に TC_PUBLIC_HOSTS を渡し、vite の設定が要求ごとにヘッダーを付ける', () => {
    const compose = readFileSync(resolve(__dirname, '../../../docker-compose.yml'), 'utf8');
    const frontend = compose.slice(compose.indexOf('\n  frontend:'), compose.indexOf('\n  clamav:'));
    expect(frontend).toContain('TC_PUBLIC_HOSTS: ${TC_PUBLIC_HOSTS:-}');
    const vite = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
    expect(vite).toContain('allowedHosts: hosts');
    expect(vite).toContain('configurePreviewServer');
    expect(vite).not.toMatch(/preview:\s*{\s*headers:/);
  });
});
