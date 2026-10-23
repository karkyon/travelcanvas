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
  // [Gate G3] DEP-02 符号化した区切り(%2F%2F・%5C・%09 等)で「外部へ」と解釈され得る物も拒否する
  let decoded = value;
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(decoded); i += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return null; // 壊れた符号化
    }
  }
  if (decoded !== value) {
    if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('\\')) return null;
    if ([...decoded].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null;
  }
  try {
    const url = new URL(value, 'https://travelcanvas.invalid');
    if (url.origin !== 'https://travelcanvas.invalid') return null;
  } catch {
    return null;
  }
  return value;
}

/**
 * [Gate G3] DEP-02 画面の外へ開く URL(公式サイト・予約・出典・動画・地図)。利用者やサーバーの値をそのまま
 * href・window.open に入れると、`javascript:` 等でスクリプトが動く(React 18 は警告するだけで止めない)。
 * http・https だけを通し、資格情報つき(user:pass@)・制御文字・空白を含む物は拒否する。
 */
export function safeExternalUrl(target: unknown): string | null {
  if (typeof target !== 'string') return null;
  const value = target.trim();
  if (!value || value.length > 2048) return null;
  if ([...value].some((ch) => ch.charCodeAt(0) <= 0x20 || ch.charCodeAt(0) === 0x7f)) return null;
  if (value.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  return url.toString();
}

/** [Gate G3] 電話の発信リンク(`tel:`)。数字と + だけを残す。番号が無ければ null */
export function safeTelHref(phone: unknown): string | null {
  if (typeof phone !== 'string') return null;
  const digits = phone.replace(/[^\d+]/g, '');
  return /\d/.test(digits) ? `tel:${digits}` : null;
}
