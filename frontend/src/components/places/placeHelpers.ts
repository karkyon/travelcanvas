/** [Gate PlaceLookupJP] 自動取得の候補を入力へ入れる時の小さな関数(画面の試験で API の mock と分けるため別のファイル) */
import type { PlaceInfoCandidate } from '@/services/api/planEdit';

/** 候補のメモ(チェックイン/アウト・駐車場など)を、まだ書いていない行だけメモへ足す */
export function appendNotes(current: string, notes?: string[]): string {
  const add = (notes ?? []).filter((n) => n && !current.includes(n));
  if (!add.length) return current;
  return [current.trimEnd(), ...add].filter(Boolean).join('\n');
}

/** 公式サイトと予約・紹介のページを URL の行へ足す(同じ URL は足さない。5 件まで) */
export function mergeUrlRows(rows: string[], c: Pick<PlaceInfoCandidate, 'website' | 'links'>): string[] {
  const out = rows.filter((r) => r.trim());
  for (const u of [c.website, ...(c.links ?? []).map((l) => l.url)]) {
    if (u && !out.includes(u) && out.length < 5) out.push(u);
  }
  return out.length ? out : [''];
}
