/**
 * [Gate SpotLinks] 予定の場所の URL の入力の確かめと表示の名前(画面の部品から分けた計算)。
 * サーバー(app/services/event_urls.py)と同じ規則: http/https だけ、1 つの予定に 5 件まで、同じ URL は 1 件。
 */
import type { EventUrl } from '@/types';

export const MAX_URLS = 5;
export const MAX_URL_LENGTH = 2000;

export function isHttpUrl(raw: string): boolean {
  const v = raw.trim();
  if (!v || /\s/.test(v) || v.length > MAX_URL_LENGTH) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** 入力の行から保存する URL を作る。形の違う行があれば error を返す(空の行は捨てる) */
export function cleanUrls(rows: string[]): { urls: EventUrl[]; error: string | null } {
  const seen = new Set<string>();
  const urls: EventUrl[] = [];
  for (const row of rows) {
    const v = row.trim();
    if (!v) continue;
    if (!isHttpUrl(v)) return { urls: [], error: `「${v.length > 40 ? `${v.slice(0, 40)}…` : v}」は URL の形ではありません(http:// か https:// で始めてください)` };
    if (seen.has(v)) continue;
    seen.add(v);
    urls.push({ url: v, label: null });
  }
  return { urls: urls.slice(0, MAX_URLS), error: null };
}

export function sameUrls(a: EventUrl[] | undefined, b: EventUrl[] | undefined): boolean {
  const x = (a ?? []).map((u) => u.url);
  const y = (b ?? []).map((u) => u.url);
  return x.length === y.length && x.every((u, i) => u === y[i]);
}

/** 表示の名前(名前があれば名前、無ければドメイン) */
export function linkText(u: EventUrl): string {
  if (u.label) return u.label;
  try {
    return new URL(u.url).hostname.replace(/^www\./, '');
  } catch {
    return u.url;
  }
}
