/**
 * [Gate TimelineRedesign] 地図の上の「この日の旅程チェック」の中身(画面にある値だけから作る。値を作らない)。
 * - ゆとり: 予定と予定の間の空き(次の予定の始まり − 前の予定の終わり − その間の移動の分)の合計。エリアの中の予定は数えない
 * - 間に合わない区間: 空きが負の区間
 * - 営業時間: 照合の結果(良い・注意・合わない)
 * - 予約: まだつないでいない予約(合いそうな予約がある)・食い違い・未予約
 * - 移動: 移動手段を決めていない区間・前の予定と合っていない区間
 */
import type { HoursBadge } from './plannerModel';
import type { EventBooking } from '@/services/api/bookingStatus';
import type { TravelSegment } from '@/services/api/types/segments';

interface Ev {
  id: string;
  title: string;
  start_time?: string | null;
  end_time?: string | null;
  duration?: number | null;
  parent_event_id?: string | null;
}

export interface DayCheck {
  freeMinutes: number | null;
  late: string[];
  hoursGood: number;
  hoursProblems: string[];
  unlinked: string[];
  issues: string[];
  unbooked: number;
  moveUnset: number;
  moveMismatch: number;
}

const toMin = (v?: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(v ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export function dayCheck(
  events: ReadonlyArray<Ev>,
  hours: Record<string, HoursBadge | null | undefined>,
  bookings: Record<string, EventBooking>,
  segments: ReadonlyArray<TravelSegment>,
): DayCheck {
  const top = events.filter((e) => !e.parent_event_id);
  const segTo = new Map(segments.map((s) => [s.to_event_id, s]));
  let free: number | null = null;
  const late: string[] = [];
  let moveUnset = 0;
  let moveMismatch = 0;
  for (let i = 1; i < top.length; i += 1) {
    const prev = top[i - 1]!;
    const cur = top[i]!;
    const seg = segTo.get(cur.id);
    if (!seg) moveUnset += 1;
    else if (seg.from_event_id && seg.from_event_id !== prev.id) moveMismatch += 1;
    const s = toMin(cur.start_time);
    const ps = toMin(prev.start_time);
    const pe = toMin(prev.end_time) ?? (ps !== null && prev.duration ? ps + prev.duration : null);
    if (s === null || pe === null) continue;
    const gap = s - pe - (seg?.duration_minutes ?? 0);
    if (gap < 0) late.push(cur.title);
    else free = (free ?? 0) + gap;
  }
  let hoursGood = 0;
  const hoursProblems: string[] = [];
  for (const e of events) {
    const h = hours[e.id];
    if (!h) continue;
    if (h.tone === 'good') hoursGood += 1;
    else if (h.tone === 'warn' || h.tone === 'bad') hoursProblems.push(e.title);
  }
  const unlinked: string[] = [];
  const issues: string[] = [];
  let unbooked = 0;
  for (const e of events) {
    const b = bookings[e.id];
    if (!b) continue;
    if (b.state === 'suggest') unlinked.push(e.title);
    else if (b.state === 'issue') issues.push(e.title);
    else if (b.state === 'none') unbooked += 1;
  }
  return { freeMinutes: free, late, hoursGood, hoursProblems, unlinked, issues, unbooked, moveUnset, moveMismatch };
}

export const minutesText = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`);
