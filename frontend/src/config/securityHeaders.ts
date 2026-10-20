/**
 * [Gate S2] SEC-03 画面(SPA)の応答ヘッダー。`vite preview`(docker compose の frontend コンテナ)が全応答に付ける。
 *
 * 目的: XSS(不正なスクリプト)が入り込んでも、外部のスクリプトの読み込み・外部への送信・画面の埋め込みを
 * ブラウザに止めさせる(多層防御)。許可するのは、この画面が実際に使う読み込み先だけ。
 * - API(VITE_API_URL のオリジン): 通信・写真や音声の取得
 * - OpenStreetMap のタイル(地図)、Google Fonts(文字)、Google Maps(キーがある時の地図)
 * - blob:/data:(端末内で作る画像・QR・書き出し)
 * 'unsafe-inline' は style だけ(通知の部品が <style> を差し込むため)。script には付けない。
 * Referrer-Policy は strict-origin-when-cross-origin(共有リンク /s/<token> のパスを外部へ送らない)。
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** 要求の Host ヘッダー(例 `omega-dev2:4173`・`[::1]:4173`)から名前だけを取り出す。読めなければ undefined */
export function hostnameOf(host: string | undefined | null): string | undefined {
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * [Gate H1] 設定の API の URL が localhost(開発・CI の既定)で、画面を別の名前(omega-dev2・LAN の IP)で開いた時は、
 * API も同じ名前に向ける(ポートと方式はそのまま)。以前は画面を他の PC から開くと、ブラウザがその PC 自身の
 * localhost:8001 を呼んで何も動かなかった。設定が localhost 以外(本番のドメイン)なら変えない。
 */
export function apiUrlForHost(apiUrl: string | undefined, pageHost: string | undefined | null): string {
  const raw = apiUrl || 'http://localhost:8001';
  const name = hostnameOf(pageHost);
  if (!name || LOOPBACK.has(name)) return raw;
  try {
    const u = new URL(raw);
    if (!LOOPBACK.has(u.hostname)) return raw;
    u.hostname = name;
    return u.toString().replace(/\/+$/, '');
  } catch {
    return raw;
  }
}

/** [Gate H1] vite preview が受け付ける名前(localhost に加えて .env の TC_PUBLIC_HOSTS。IP は vite が常に受け付ける) */
export function allowedHosts(publicHosts: string | undefined): string[] {
  const extra = (publicHosts || '').split(',').map((h) => h.trim()).filter((h) => /^[A-Za-z0-9.-]+$/.test(h));
  return Array.from(new Set(['localhost', '127.0.0.1', ...extra]));
}

export function apiOrigin(apiUrl: string | undefined): string {
  try {
    return new URL(apiUrl || 'http://localhost:8001').origin;
  } catch {
    return 'http://localhost:8001';
  }
}

/** [Gate S10] API の基底 URL(services/api/core.ts の resolveApiBaseUrl と同じ規則。末尾に /api/v1) */
export function apiBaseUrl(apiUrl: string | undefined): string {
  const trimmed = (apiUrl || 'http://localhost:8001').replace(/\/+$/, '');
  const base = trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
  try {
    return new URL(base).toString().replace(/\/+$/, '');
  } catch {
    return 'http://localhost:8001/api/v1';
  }
}

/**
 * [Gate S10] CSP の違反をブラウザに報告させる先(backend app/api/v1/security_reports.py)。
 * report-to(Reporting API)はまとめて遅れて送られ、report-uri より優先されるため、report-uri だけを使う。
 */
export function cspReportUrl(apiUrl: string | undefined): string {
  return `${apiBaseUrl(apiUrl)}/security/csp-report`;
}

export function contentSecurityPolicy(apiUrl: string | undefined): string {
  const api = apiOrigin(apiUrl);
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://maps.googleapis.com'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', api, 'https://*.tile.openstreetmap.org',
      'https://maps.gstatic.com', 'https://maps.googleapis.com'],
    'media-src': ["'self'", 'blob:', api],
    'connect-src': ["'self'", api, 'https://maps.googleapis.com'],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'report-uri': [cspReportUrl(apiUrl)],
  };
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

export function securityHeaders(apiUrl: string | undefined, production = false): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy(apiUrl),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // 位置の記録・訪問の検出(geolocation)と音声検索(microphone)はこの画面だけで使う
    'Permissions-Policy': 'geolocation=(self), microphone=(self), camera=(), payment=(), usb=()',
  };
  if (production) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}
