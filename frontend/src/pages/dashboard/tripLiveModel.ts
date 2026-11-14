/**
 * [Gate HomeLive] 旅行中のホームの決まり(純粋関数。tripLiveModel.test.ts で確かめる)。
 * 予定の今・次・済みは今日の画面と同じ関数(computeTodayView / computeTodayFlow)で決める。
 */
import type { TodayEvent } from '@/services/api';
import { safeExternalUrl } from '@/utils/safeNavigation';

export type LiveState = 'done' | 'now' | 'next' | 'later';

/** 現地の時刻(HH:MM)。タイムゾーンが不正なら端末の時刻 */
export function clockIn(nowMs: number, timeZone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
  try {
    return new Date(nowMs).toLocaleTimeString('ja-JP', timeZone ? { ...opts, timeZone } : opts);
  } catch {
    return new Date(nowMs).toLocaleTimeString('ja-JP', opts);
  }
}

/** 予定の状態(今・次・済み・この後) */
export function liveState(id: string, nowId: string | null, nextId: string | null, doneIds: readonly string[]): LiveState {
  if (id === nowId) return 'now';
  if (id === nextId) return 'next';
  return doneIds.includes(id) ? 'done' : 'later';
}

export const LIVE_STATE_LABEL: Record<LiveState, string> = { done: '済み', now: 'いま', next: '次', later: 'この後' };

type Place = Pick<TodayEvent, 'latitude' | 'longitude' | 'address'>;

/**
 * 次の場所への案内(Google マップ。キー不要)。座標があれば道順(公共交通)、無ければ住所で探す。どちらも無ければ null。
 * 出発地は今の予定の座標(無ければ地図アプリが今いる場所を使う)。
 */
export function guideUrl(from: Place | null, to: Place): string | null {
  if (to.latitude != null && to.longitude != null) {
    const q = new URLSearchParams({ api: '1', destination: `${Number(to.latitude)},${Number(to.longitude)}`, travelmode: 'transit' });
    if (from && from.latitude != null && from.longitude != null) q.set('origin', `${Number(from.latitude)},${Number(from.longitude)}`);
    return safeExternalUrl(`https://www.google.com/maps/dir/?${q.toString()}`);
  }
  if (to.address) return safeExternalUrl(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(to.address)}`);
  return null;
}

/** 「あと 1 時間 5 分」(過ぎていれば「まもなく」) */
export function untilLabel(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes <= 0) return 'まもなく';
  if (minutes < 60) return `あと ${minutes} 分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `あと ${h} 時間 ${m} 分` : `あと ${h} 時間`;
}
