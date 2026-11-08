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

/** [Gate PlaceLookupAccuracy] 自動取得で「近く」とする位置: 予定の位置 → 同じ日の予定の位置の真ん中 → 旅行全体の真ん中 */
export function nearPoint(own: { latitude?: number | null; longitude?: number | null } | null | undefined,
  dayEvents: ReadonlyArray<{ latitude?: number | null; longitude?: number | null }> = [],
  allEvents: ReadonlyArray<{ latitude?: number | null; longitude?: number | null }> = []): { latitude: number; longitude: number } | null {
  if (typeof own?.latitude === 'number' && typeof own?.longitude === 'number') return { latitude: own.latitude, longitude: own.longitude };
  for (const list of [dayEvents, allEvents]) {
    const pts = list.filter((e): e is { latitude: number; longitude: number } => typeof e.latitude === 'number' && typeof e.longitude === 'number');
    if (pts.length) {
      const lat = [...pts.map((p) => p.latitude)].sort((a, b) => a - b)[Math.floor(pts.length / 2)]!;
      const lng = [...pts.map((p) => p.longitude)].sort((a, b) => a - b)[Math.floor(pts.length / 2)]!;
      return { latitude: lat, longitude: lng };
    }
  }
  return null;
}
