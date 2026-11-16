/**
 * [Gate BookletShare] しおりの共有の文と URL(純粋な関数。React・API に依存しない)。
 */

export type ShareTarget = 'public' | 'app';

/** 画面のオリジンとパスから URL を作る(パスは / で始まる物だけ) */
export function absoluteUrl(origin: string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('path must be absolute');
  return `${origin.replace(/\/+$/, '')}${path}`;
}

export function shareSubject(title: string): string {
  return `旅のしおり「${title}」`;
}

/** 本文。target=app の時は、編集できる同行者がログインして開くことを書く */
export function shareBody(title: string, url: string, target: ShareTarget, note = ''): string {
  const how = target === 'public'
    ? 'このリンクから、ログインなしで見られます。'
    : 'TravelCanvas にログインして開いてください(旅行の編集ができるメンバーが開けます)。';
  return [`旅のしおり「${title}」を送ります。`, note.trim(), '', url, how].filter((l, i) => i !== 1 || l).join('\n');
}

/**
 * メールアプリを開く mailto: の URL(RFC 6068)。宛先は「,」で区切り、件名・本文は % で符号化する。
 * アドレスの @ はそのまま(多くのメールアプリが %40 を読めないため)。
 */
export function mailtoUrl(to: string[], subject: string, body: string): string {
  const addr = to.filter((a) => /^[^\s@,;?&]+@[^\s@,;?&]+$/.test(a))
    .map((a) => encodeURIComponent(a).replace(/%40/g, '@')).join(',');
  return `mailto:${addr}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** PDF のファイル名(使えない文字を除く) */
export function pdfFileName(title: string, version: number): string {
  const safe = title.replace(/[\\/:*?"<>|\r\n]/g, '').slice(0, 60) || 'しおり';
  return `${safe}_第${version}版.pdf`;
}

/** 確認用の受信箱(mailpit)の画面の URL。同じ機械の 8025 番 */
export function sandboxInboxUrl(loc: { protocol: string; hostname: string }): string {
  return `${loc.protocol === 'https:' ? 'https:' : 'http:'}//${loc.hostname}:8025`;
}
