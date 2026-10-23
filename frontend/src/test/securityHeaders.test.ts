import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiBaseUrl, apiOrigin, contentSecurityPolicy, cspReportUrl, securityHeaders } from '@/config/securityHeaders';

describe('画面の応答ヘッダー (Gate S2)', () => {
  it('API のオリジンだけを通信・画像・音声に許し、スクリプトに unsafe-inline を付けない', () => {
    const csp = contentSecurityPolicy('https://api.travelcanvas.jp/api/v1');
    expect(csp).toContain("connect-src 'self' https://api.travelcanvas.jp");
    expect(csp).toContain("img-src 'self' data: blob: https://api.travelcanvas.jp");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    const script = csp.split('; ').find((d: string) => d.startsWith('script-src')) ?? '';
    expect(script).not.toContain('unsafe-inline');
    expect(script).not.toContain('unsafe-eval');
    expect(csp).not.toContain('*.travelcanvas');
  });

  it('CSP の違反を API の報告口へ送らせる(report-uri。/api/v1 の付け方は API クライアントと同じ) (Gate S10)', () => {
    expect(cspReportUrl('https://api.travelcanvas.jp')).toBe('https://api.travelcanvas.jp/api/v1/security/csp-report');
    expect(cspReportUrl('https://api.travelcanvas.jp/api/v1/')).toBe('https://api.travelcanvas.jp/api/v1/security/csp-report');
    expect(cspReportUrl(undefined)).toBe('http://localhost:8001/api/v1/security/csp-report');
    expect(apiBaseUrl('not a url')).toBe('http://localhost:8001/api/v1');
    expect(contentSecurityPolicy('http://localhost:8001')).toContain(
      'report-uri http://localhost:8001/api/v1/security/csp-report');
    expect(contentSecurityPolicy('http://localhost:8001')).not.toContain('report-to');
  });

  it('API の URL が無い・壊れている時は開発の既定にする', () => {
    expect(apiOrigin(undefined)).toBe('http://localhost:8001');
    expect(apiOrigin('not a url')).toBe('http://localhost:8001');
  });

  it('共有リンクのパスを外部へ送らない Referrer-Policy、埋め込み禁止、HSTS は本番だけ', () => {
    const dev = securityHeaders('http://localhost:8001');
    expect(dev['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(dev['X-Frame-Options']).toBe('DENY');
    expect(dev['X-Content-Type-Options']).toBe('nosniff');
    expect(dev['Strict-Transport-Security']).toBeUndefined();
    expect(securityHeaders('https://api.x.jp', true)['Strict-Transport-Security']).toMatch(/^max-age=31536000/);
  });
});

describe('docker の frontend コンテナ (Gate S2)', () => {
  // vite preview は vite.config.ts の preview.headers でヘッダーを付ける。実行用の段に設定が無いとヘッダーが付かない
  // (omega-dev2 の E2E で発見。サンドボックスは docker を使わないため、ここで Dockerfile を確かめる)
  const dockerfile = readFileSync(resolve(__dirname, '../../Dockerfile'), 'utf8');
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('FROM '));

  it('build の段は文脈を丸ごと写さない(手元の node_modules で依存が混ざらない。Gate G2 v2)', () => {
    // omega-dev2 では .dockerignore が無く(.gitignore の対象)、`COPY . .` が手元の古い node_modules で
    // コンテナの npm ci の結果を上書きして build が失敗した
    const build = dockerfile.slice(0, dockerfile.lastIndexOf('FROM '));
    const copies = [...build.matchAll(/^COPY (.+)$/gm)].map((m) => m[1]!.trim());
    const sources = copies.flatMap((c) => c.split(/\s+/).slice(0, -1));
    expect(sources.filter((src) => src === '.' || src === './' || src.includes('node_modules'))).toEqual([]);
    for (const need of ['package*.json', 'index.html', 'vite.config.ts', 'postcss.config.js', 'tsconfig.json',
      'tsconfig.node.json', 'public', 'src']) {
      expect(sources).toContain(need);
    }
    expect(build.indexOf('RUN npm ci')).toBeLessThan(build.indexOf('COPY src ./src'));
  });

  it('実行用の段は本番用の配信(vite preview ではない)と build の結果だけ(Gate G3 DEP-03)', () => {
    expect(runtime).toContain('CMD ["node", "server/static-server.mjs"]');
    const code = runtime.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(code).not.toMatch(/preview/);
    expect(code).not.toMatch(/node_modules/);
    expect(runtime).toMatch(/COPY --from=build --chown=node:node \/app\/dist \.\/dist/);
    expect(runtime).toMatch(/COPY --from=build --chown=node:node \/app\/server \.\/server/);
    // ヘッダーの定義は画面と同じ関数から作る
    expect(dockerfile).toMatch(/esbuild src\/config\/securityHeaders\.ts [^\n]*--outfile=server\/securityHeaders\.mjs/);
  });

  it('起動時の API の URL(CSP の通信先)をビルド時と同じ値にする(docker-compose.yml)', () => {
    const compose = readFileSync(resolve(__dirname, '../../../docker-compose.yml'), 'utf8');
    const frontend = compose.slice(compose.indexOf('\n  frontend:'), compose.indexOf('\n  clamav:') > 0
      ? compose.indexOf('\n  clamav:') : undefined);
    const values = [...frontend.matchAll(/^\s+VITE_API_URL: (.+)$/gm)].map((m) => m[1]?.trim());
    expect(values).toHaveLength(2);
    expect(values[0]).toBe('${VITE_API_URL:-http://localhost:8001}');
    expect(values[1]).toBe(values[0]);
  });

  it('node(root でない利用者)で動かす', () => {
    expect(runtime).toMatch(/^USER node$/m);
  });
});
