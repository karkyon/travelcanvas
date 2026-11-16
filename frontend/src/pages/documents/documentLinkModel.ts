/**
 * [Gate TripKitFix] 文書の関連付けの候補(純粋な関数。React・API に依存しない)。
 *
 * ファイル名と予約名・予定名の語(2 文字以上の連なり)が重なる数で並べる。重なりが無い候補も出す(本人が選ぶ)。
 * 推測で関連付けはしない。
 */
import type { NormalizedDay, Reservation, TravelDocument } from '@/services/api';

export interface LinkTarget {
  key: string;
  kind: 'reservation' | 'event';
  id: string;
  title: string;
  sub: string;
  score: number;
}

/** 名前を語に分ける(拡張子・記号・数字だけの語を除く。日本語は 2 文字ずつの重なりで比べる) */
export function nameTokens(name: string): Set<string> {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, '').toLowerCase();
  const out = new Set<string>();
  for (const w of base.split(/[\s_\-・.,()（）[\]【】/]+/)) {
    if (!w || /^\d+$/.test(w)) continue;
    if (/^[\x20-\x7e]+$/.test(w)) { if (w.length >= 3) out.add(w); continue; }
    const chars = Array.from(w);
    for (let i = 0; i + 1 < chars.length; i += 1) out.add(chars[i]! + chars[i + 1]!);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

export function linkCandidates(filename: string, reservations: Reservation[], days: NormalizedDay[]): LinkTarget[] {
  const f = nameTokens(filename);
  const out: LinkTarget[] = [];
  for (const r of reservations) {
    if (r.status === 'cancelled') continue;
    const title = r.provider_name || '予約';
    out.push({ key: `r:${r.id}`, kind: 'reservation', id: r.id, title,
      sub: r.start_at ? r.start_at.slice(0, 16).replace('T', ' ') : '日時なし', score: overlap(f, nameTokens(title)) });
  }
  days.forEach((d, i) => {
    for (const e of d.events || []) {
      out.push({ key: `e:${e.id}`, kind: 'event', id: e.id, title: e.title || '予定',
        sub: `${i + 1}日目 ${d.local_date ?? ''}`.trim(), score: overlap(f, nameTokens(e.title || '')) });
    }
  });
  return out.sort((a, b) => b.score - a.score);
}

/** 関連の件数(予約などへの関連 + 領収書にしている支出)。一覧の応答に件数が無い時は null(分からない) */
export function relationCount(d: TravelDocument): number | null {
  if (d.link_count == null && d.receipt_count == null) return null;
  return (d.link_count ?? 0) + (d.receipt_count ?? 0);
}
