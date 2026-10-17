/**
 * [Gate S1] 画面内の移動先として受け付けるのは、アプリ内のパス("/" で始まる)だけにする。
 *
 * react-router v6 には「バックスラッシュを含むパスで外部へ移動してしまう」問題(GHSA-wrjc-x8rr-h8h6、
 * 修正は v7)がある。このアプリは利用者の入力を移動先にしていないが、サーバーから受け取った値で移動する箇所
 * (準備状況の「開く」など)は、ここを通して外部 URL・プロトコル相対 URL・バックスラッシュを拒否する。
 */
export function safeInternalPath(target: unknown): string | null {
  if (typeof target !== 'string') return null;
  const value = target.trim();
  if (!value.startsWith('/')) return null; // 相対・スキーム付き(https:, javascript:)を拒否
  if (value.startsWith('//')) return null; // プロトコル相対 URL
  if (value.includes('\\')) return null; // バックスラッシュ(/\evil.example → //evil.example と解釈され得る)
  if ([...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null; // 制御文字
  try {
    const url = new URL(value, 'https://travelcanvas.invalid');
    if (url.origin !== 'https://travelcanvas.invalid') return null;
  } catch {
    return null;
  }
  return value;
}
