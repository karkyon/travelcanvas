/** [Gate Remaining-5] FR-042 埋め込みのコード(共有リンクの URL の最後の部分 = 共有の鍵) */
export function shareTokenOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /\/s\/([A-Za-z0-9_-]{8,200})(?:[?#].*)?$/.exec(url);
  return m ? m[1] ?? null : null;
}

export function embedSnippet(token: string, apiBase: string): string {
  const base = apiBase.replace(/\/+$/, '');
  return `<div data-travelcanvas-embed="${token}" data-height="480"></div>\n`
    + `<script src="${base}/public/embed.js" async></script>`;
}

export function embedIframe(token: string, apiBase: string): string {
  const base = apiBase.replace(/\/+$/, '');
  return `<iframe src="${base}/public/embed/${token}" title="旅程" width="100%" height="480" `
    + 'style="border:1px solid #e2e6ee;border-radius:8px" loading="lazy" referrerpolicy="no-referrer" sandbox></iframe>';
}

/** 埋め込みできる共有リンクか(選んだ・閲覧のみ・合言葉なし・回数の制限なし) */
export function canEmbed(link: { fields: string[]; permission: string; has_passcode: boolean; max_uses: number | null }): boolean {
  return link.fields.includes('embed') && link.permission === 'view' && !link.has_passcode && link.max_uses == null;
}
