/**
 * [Gate ShelfCards] ホームの「旅行の一覧」のカードの表示の計算(純粋関数。shelfModel.test.ts で確かめる)。
 */
import type { DashboardTrip, TripShelf } from '@/services/api/types/g9';
import { daySpan, statusLabel } from './dashboardModel';

const WEEK = '日月火水木金土';

export function parts(iso: string | null | undefined): { y: number; m: number; d: number; w: string } | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { y, m: mo, d, w: WEEK[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]! };
}

/** 日帰り / 2泊3日(5 日まで)/ 7日間(6 日から) */
export function shelfStay(days: number | null | undefined): string | null {
  if (!days || days < 1) return null;
  if (days === 1) return '日帰り';
  return days <= 5 ? `${days - 1}泊${days}日` : `${days}日間`;
}

/**
 * カードの日付の行。行った旅は「2025年10月 · 1泊2日」、これからの旅は「11/21(土)–23(月) · 2泊3日」
 * (今年でなければ年を付ける。月をまたぐ時は終わりにも月を付ける)。日付が無ければ「日付は未定」
 */
export function shelfDateLine(t: Pick<DashboardTrip, 'start_date' | 'end_date' | 'total_days' | 'phase' | 'local_today'>): string {
  const s = parts(t.start_date);
  const stay = shelfStay(t.total_days);
  if (!s) return stay ? `日付は未定 · ${stay}` : '日付は未定';
  if (t.phase === 'past') return [`${s.y}年${s.m}月`, stay].filter(Boolean).join(' · ');
  const e = parts(t.end_date);
  const thisYear = parts(t.local_today)?.y ?? s.y;
  const head = `${s.y !== thisYear ? `${s.y}/` : ''}${s.m}/${s.d}(${s.w})`;
  const tail = e && (e.y !== s.y || e.m !== s.m || e.d !== s.d)
    ? `–${e.y !== s.y ? `${e.y}/` : ''}${e.y !== s.y || e.m !== s.m ? `${e.m}/` : ''}${e.d}(${e.w})` : '';
  return [`${head}${tail}`, stay].filter(Boolean).join(' · ');
}

/** 表紙の左上の札 */
export function shelfChip(t: DashboardTrip): string {
  if (t.shelf === 'cancelled') return '見送り・中止';
  switch (t.phase) {
    case 'upcoming': {
      const n = t.days_until_start;
      if (n === 0) return '今日から';
      if (n === 1) return '明日から';
      return n == null ? '出発日は確認中' : `出発まで ${daySpan(n)}`;
    }
    case 'ongoing':
      return `旅行中 · ${statusLabel(t)}`;
    case 'past': {
      const s = parts(t.start_date);
      return s ? `行った旅 · ${s.y}` : '行った旅';
    }
    default:
      return t.total_days ? `${t.total_days}日間 · 旅行案` : '日付は未定 · 旅行案';
  }
}

export const SHELF_TEXT: Record<TripShelf, string> = {
  planning: '計画中', considering: '検討中', visited: '行った旅', cancelled: '見送り・中止',
};

/** 下の段の状態の札(行った旅で写真かメモがあれば「記録あり」) */
export function shelfBadge(t: DashboardTrip): string {
  if (t.shelf === 'visited' && ((t.photo_count ?? 0) + (t.note_count ?? 0)) > 0) return '記録あり';
  return t.shelf ? SHELF_TEXT[t.shelf] : '旅行';
}

/** 数の小さな札(行った旅は写真・メモ、それ以外は予定・写真・共有) */
export function shelfStats(t: DashboardTrip): string[] {
  if (t.shelf === 'visited') return [`写真 ${t.photo_count ?? 0}`, `メモ ${t.note_count ?? 0}`];
  const out = [`予定 ${t.event_count ?? 0}`, `写真 ${t.photo_count ?? 0}`];
  if (t.member_count > 1) out.push(`共有 ${t.member_count}名`);
  return out;
}
