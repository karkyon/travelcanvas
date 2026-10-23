/**
 * [Gate G3] DEP-03 画面(SPA)の本番用の配信。以前は `vite preview`(開発用の確認のための道具で、本番の配信には
 * 向かない)で配信していた。このサーバーは Node の標準の部品だけで動き(依存のパッケージなし)、実行用の像に
 * node_modules を入れない。
 *
 * - 応答ヘッダー(CSP・HSTS 等)は src/config/securityHeaders.ts と同じ関数(build の時に securityHeaders.mjs へ変換)
 * - 受け付ける名前は vite preview と同じ規則(localhost・IP・TC_PUBLIC_HOSTS)。他は 403
 * - SPA の経路(/planner/... 等)は index.html を返す。/assets/ の無いファイルは 404(index.html にしない)
 * - キャッシュ: /assets/(名前に内容のハッシュ)は 1年・immutable、index.html は no-cache、他は 1時間
 * - 圧縮: 文字のファイルを gzip(Accept-Encoding)。ETag と If-None-Match(304)。GET・HEAD 以外は 405
 * - パスの検査: 符号化の誤り・NUL・`..`・隠しファイル(.で始まる)は 400/404。シンボリックリンクで外へ出ない
 */
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|javascript)|image\/svg\+xml)/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** vite preview の allowedHosts と同じ判定: 設定の名前・IP の直書き・localhost(とその下)を受け付ける */
export function hostAllowed(hostname, allowed) {
  if (!hostname) return false;
  const name = hostname.toLowerCase().replace(/\.$/, '');
  if (IPV4.test(name) || name.startsWith('[') || name.includes(':')) return true;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  return allowed.some((h) => {
    const a = h.toLowerCase();
    return a.startsWith('.') ? name === a.slice(1) || name.endsWith(a) : name === a;
  });
}

/** 要求のパスを配信の根の中のファイルへ。外へ出る・壊れたパスは null */
export function resolveInside(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.' || p.startsWith('.'))) return null;
  const full = path.resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function cacheControl(rel) {
  if (rel === 'index.html') return 'no-cache';
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

/**
 * @param {{ root: string, headersFor: (host: string | undefined) => Record<string, string>,
 *           allowedHosts: string[], hostnameOf: (h: string | undefined) => string | undefined }} opts
 */
export function createStaticServer(opts) {
  const root = path.resolve(opts.root);
  const gzCache = new Map(); // 圧縮した中身(ファイル・更新時刻ごと)

  async function stat(p) {
    try {
      const real = await fs.realpath(p);
      if (real !== root && !real.startsWith(root + path.sep)) return null; // シンボリックリンクで外へ
      const st = await fs.stat(real);
      return st.isFile() ? { file: real, st } : null;
    } catch {
      return null;
    }
  }

  return createServer(async (req, res) => {
    const host = req.headers.host;
    const name = opts.hostnameOf(host);
    const security = opts.headersFor(host);
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { ...security, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
        ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      if (!hostAllowed(name, opts.allowedHosts)) {
        send(403, `Blocked request. This host (${JSON.stringify(String(host ?? ''))}) is not allowed.`);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
        return;
      }
      const urlPath = (req.url || '/').split('?')[0].split('#')[0] || '/';
      if (!urlPath.startsWith('/') || urlPath.startsWith('//')) {
        send(400, 'Bad Request');
        return;
      }
      const target = resolveInside(root, urlPath);
      if (target === null) {
        send(400, 'Bad Request');
        return;
      }
      let found = urlPath.endsWith('/') ? null : await stat(target);
      if (!found) {
        const lastSeg = urlPath.split('/').pop() || '';
        // /assets/ の下・拡張子のあるファイルの無いものは 404(画面の HTML を返すとスクリプトとして読まれて壊れる)
        if (urlPath.startsWith('/assets/') || Object.hasOwn(TYPES, path.extname(lastSeg).toLowerCase())) {
          send(404, 'Not Found');
          return;
        }
        found = await stat(path.join(root, 'index.html'));
        if (!found) {
          send(503, 'Service Unavailable');
          return;
        }
      }
      const rel = path.relative(root, found.file).split(path.sep).join('/');
      const type = TYPES[path.extname(found.file).toLowerCase()] || 'application/octet-stream';
      const etag = `W/"${found.st.size.toString(16)}-${Math.floor(found.st.mtimeMs).toString(16)}"`;
      const headers = { ...security, 'Content-Type': type, 'Cache-Control': cacheControl(rel), ETag: etag,
        'Last-Modified': found.st.mtime.toUTCString(), Vary: 'Accept-Encoding' };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      const gzip = COMPRESSIBLE.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))
        && found.st.size > 512;
      if (gzip) {
        const key = `${found.file}:${found.st.mtimeMs}`;
        let body = gzCache.get(key);
        if (!body) {
          body = gzipSync(await fs.readFile(found.file), { level: 6 });
          if (gzCache.size > 500) gzCache.clear();
          gzCache.set(key, body);
        }
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': found.st.size });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(found.file).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) send(500, 'Internal Server Error');
      else res.destroy();
    }
  });
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sh = await import(path.join(here, 'securityHeaders.mjs'));
  const env = process.env;
  const apiUrl = env.VITE_API_BASE_URL || env.VITE_API_URL;
  const production = (env.APP_ENV || '').toLowerCase() === 'production';
  const server = createStaticServer({
    root: env.TC_STATIC_ROOT || path.join(here, '..', 'dist'),
    headersFor: (host) => sh.securityHeaders(sh.apiUrlForHost(apiUrl, host), production),
    allowedHosts: sh.allowedHosts(env.TC_PUBLIC_HOSTS),
    hostnameOf: sh.hostnameOf,
  });
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  const port = Number(env.PORT || 4173);
  server.listen(port, env.HOST || '0.0.0.0', () => {
    console.log(`[static-server] listening on :${port}(本番用の配信。vite preview ではない)`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('[static-server] 起動できません:', e && e.message);
    process.exit(1);
  });
}
