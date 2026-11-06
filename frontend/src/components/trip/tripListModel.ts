/** [Gate TripsWish] 旅行の一覧のカードの表示の計算(画面の部品 TripList から分けた) */
import type { TravelPlan } from '@/types';
import type { DashboardTrip } from '@/services/api/types/g9';

const WEEK = '日月火水木金土';

export function ymd(d: string | null | undefined): string | null {
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/** 2026/5/17(土) */
export function dateWithDay(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const w = new Date(Date.UTC(y!, m! - 1, day!)).getUTCDay();
  return `${y}/${m}/${day}(${WEEK[w]})`;
}

/** 1泊2日 / 日帰り */
export function stayLabel(days: number | null | undefined): string | null {
  if (!days || days < 1) return null;
  return days === 1 ? '日帰り' : `${days - 1}泊${days}日`;
}

export function partySize(plan: TravelPlan | undefined): number | null {
  // 一覧の応答には preferences(基本情報の人数 party_size)が入る。型の TravelPlan には無いので読むだけ
  const prefs = (plan as (TravelPlan & { preferences?: unknown }) | undefined)?.preferences as Record<string, unknown> | undefined;
  if (typeof plan?.group_size === 'number' && plan.group_size > 0 && !prefs?.party_size) return plan.group_size;
  const v = prefs?.party_size ?? prefs?.travelers;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}


/** 旅行の期間。基本情報で入れた出発日・最終日を先に使う(旅程の日がまだ一部しか無くても、旅行の期間を出す) */
export function tripSpan(plan: TravelPlan | undefined, trip: DashboardTrip | undefined):
  { start: string | null; end: string | null; totalDays: number | null } {
  const start = ymd(plan?.start_date) ?? ymd(trip?.start_date);
  const end = ymd(plan?.end_date) ?? ymd(trip?.end_date) ?? start;
  const totalDays = start && end && end >= start
    ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 : (trip?.total_days ?? null);
  return { start, end, totalDays };
}
