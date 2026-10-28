/**
 * [Gate L1b] 当日モードの端末側再計算(タイムゾーン・日跨ぎ・遅延・オフライン保存)。
 * fixtureは実backendの応答(services/api/__fixtures__/backendContractResponses.json)。
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { TodayEvent, TodayResponse } from '@/services/api';
import {
  computeTodayView, formatCountdown, formatTimeInZone, loadTodayCache, localDateIn, saveTodayCache,
} from './todayModel';
import { clearSnapshots, saveSnapshot } from '@/utils/offlineVault';

const withTransport = fx.today_with_transport as TodayResponse;

vi.mock('@/services/api', async () => ({
  getOfflinePackKey: vi.fn(async () => ({
    user_id: 'user-today', key_version: 1, key: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
    algorithm: 'AES-256-GCM', key_bits: 256, issued_at: '2026-05-01T00:00:00Z',
  })),
}));
const SESSION = { userId: 'user-today', sessionTag: 'login-1' };
const at = (iso: string) => Date.parse(iso);

function ev(id: string, start: string | null, end: string | null = null, extra: Partial<TodayEvent> = {}): TodayEvent {
  return {
    id, title: id, event_type: 'activity', start_at: start, end_at: end, local_start_time: null, address: null,
    latitude: null, longitude: null, has_ticket: false, reservation_id: null, time_source: 'start_at',
    departure_at: null, transport_mode: null, transport_status: null, ...extra,
  };
}

function day(events: TodayEvent[], over: Partial<TodayResponse> = {}): TodayResponse {
  return {
    plan_id: 'p', today_date: '2026-03-11', timezone_id: 'Asia/Tokyo', server_time: '2026-03-10T16:00:00Z',
    now_event: null, next_event: null, minutes_until_next: null, day_end_at: '2026-03-11T15:00:00Z', events, ...over,
  };
}

describe('タイムゾーン (Gate L1b)', () => {
  it('日付と時刻は端末ではなく日程のIANAタイムゾーンで求める', () => {
    const now = at('2026-03-10T20:00:00Z');
    expect(localDateIn(now, 'Asia/Tokyo')).toBe('2026-03-11');
    expect(localDateIn(now, 'America/Los_Angeles')).toBe('2026-03-10');
    expect(localDateIn(now, 'Not/AZone')).toBe('2026-03-10');
    expect(formatTimeInZone('2026-05-01T06:00:00Z', 'Asia/Tokyo')).toBe('15:00');
    expect(formatTimeInZone('2026-05-01T06:00:00Z', 'Europe/Paris')).toBe('08:00');
    expect(formatTimeInZone(null, 'Asia/Tokyo')).toBe('--:--');
  });

  it('カウントダウンの表記', () => {
    expect(formatCountdown(null)).toBe('');
    expect(formatCountdown(0)).toBe('まもなく');
    expect(formatCountdown(45)).toBe('45分後');
    expect(formatCountdown(120)).toBe('2時間後');
    expect(formatCountdown(150)).toBe('2時間30分後');
  });
});

describe('NOW/NEXTの再計算 (Gate L1b)', () => {
  it('backendと同じ結果になる(実応答fixture)', () => {
    const view = computeTodayView(withTransport, at(withTransport.server_time));
    expect(view.nowEvent?.id).toBe(withTransport.now_event?.id);
    expect(view.nextEvent?.id).toBe(withTransport.next_event?.id);
    expect(view.minutesUntilNext).toBe(withTransport.minutes_until_next);
    // 最初の区間の出発(03:10Z)まで70分
    expect(view.minutesUntilDeparture).toBe(70);
  });

  it('再取得しなくても時刻の経過でNOW/NEXTが進む', () => {
    const view = computeTodayView(withTransport, at('2026-05-01T06:30:00Z'));
    expect(view.nowEvent?.title).toBe('京都駅');
    expect(view.nextEvent).toBeNull();
    expect(view.minutesUntilDeparture).toBeNull();
    // 京都駅はend_at(07:00Z)で終わる。その後は進行中なし
    expect(computeTodayView(withTransport, at('2026-05-01T07:30:00Z')).nowEvent).toBeNull();
  });

  it('end_at未設定の予定は次の予定の開始まで、最後の予定は現地の日付が変わるまでNOW', () => {
    const res = day([ev('朝', '2026-03-10T23:00:00Z'), ev('昼', '2026-03-11T03:00:00Z')]);
    expect(computeTodayView(res, at('2026-03-11T02:00:00Z')).nowEvent?.id).toBe('朝');
    expect(computeTodayView(res, at('2026-03-11T05:00:00Z')).nowEvent?.id).toBe('昼');
    expect(computeTodayView(res, at('2026-03-11T14:59:00Z')).nowEvent?.id).toBe('昼');
  });

  it('前日から続く予定はNOWになるがNEXTにはならない', () => {
    const res = day([ev('夜行便', '2026-03-10T13:00:00Z', '2026-03-10T21:00:00Z'), ev('朝食', '2026-03-11T00:00:00Z')]);
    const view = computeTodayView(res, at('2026-03-10T16:00:00Z'));
    expect(view.nowEvent?.id).toBe('夜行便');
    expect(view.nextEvent?.id).toBe('朝食');
    expect(view.minutesUntilNext).toBe(480);
  });

  it('今日の日程が無い場合、継続中の予定だけを出しNEXTは出さない', () => {
    const res = day([ev('フェリー', '2026-03-10T20:00:00Z', '2026-03-11T07:00:00Z')], {
      today_date: null, timezone_id: null, day_end_at: null,
    });
    const view = computeTodayView(res, at('2026-03-11T02:00:00Z'));
    expect(view.nowEvent?.id).toBe('フェリー');
    expect(view.nextEvent).toBeNull();
  });

  it('保存済みデータが日程タイムゾーンで「今日」でなくなったらNOW/NEXTを出さない', () => {
    const res = day([ev('朝', '2026-03-10T23:00:00Z')]);
    const view = computeTodayView(res, at('2026-03-11T15:30:00Z')); // 3/12 00:30 JST
    expect(view).toMatchObject({ isCurrentDay: false, nowEvent: null, nextEvent: null });
  });

  it('出発時刻を過ぎたら出発までのカウントダウンは出さず開始までに切り替える', () => {
    const res = day([ev('駅', '2026-03-11T06:00:00Z', null, { departure_at: '2026-03-11T05:00:00Z' })]);
    expect(computeTodayView(res, at('2026-03-11T04:00:00Z')).minutesUntilDeparture).toBe(60);
    const after = computeTodayView(res, at('2026-03-11T05:10:00Z'));
    expect(after.minutesUntilDeparture).toBeNull();
    expect(after.minutesUntilNext).toBe(50);
  });
});

describe('オフライン表示用の保存 (Gate L1b / K1: 暗号化して保存)', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await clearSnapshots();
  });

  it('保存した当日情報を検証して読み戻す(プランごと・利用者ごと)', async () => {
    expect(await saveTodayCache(SESSION, 'plan-1', withTransport, 1234)).toBe(true);
    const cached = await loadTodayCache(SESSION, 'plan-1');
    expect(cached?.payload).toEqual(withTransport);
    expect(cached?.offsetMs).toBe(1234);
    expect(await loadTodayCache(SESSION, 'plan-2')).toBeNull();
    expect(await loadTodayCache(null, 'plan-1')).toBeNull();
  });

  it('平文では残さない(以前の localStorage の保存は消す)', async () => {
    window.localStorage.setItem('travelcanvas:today:v1:plan-1', JSON.stringify({ payload: withTransport, savedAt: 1, offsetMs: 0 }));
    await saveTodayCache(SESSION, 'plan-1', withTransport, 0);
    expect(window.localStorage.getItem('travelcanvas:today:v1:plan-1')).toBeNull();
    expect(JSON.stringify(Object.entries(window.localStorage))).not.toContain(withTransport.events[0]?.title ?? '京都');
  });

  it('形式不正な保存データは使わない', async () => {
    await saveSnapshot(SESSION, 'today:p', { payload: { ...withTransport, events: 'x' }, savedAt: 1, offsetMs: 0 });
    expect(await loadTodayCache(SESSION, 'p')).toBeNull();
    await saveSnapshot(SESSION, 'today:q', { payload: withTransport });
    expect(await loadTodayCache(SESSION, 'q')).toBeNull();
  });
});

// [Gate G10-UX] UX-5 当日の流れ(今の予定の進み・NEXT の後の予定・済んだ数)
import { computeTodayFlow } from './todayModel';

describe('computeTodayFlow (Gate G10-UX)', () => {
  const ev = (id: string, start: string, end: string | null = null) => ({
    id, title: id, event_type: 'activity', start_at: start, end_at: end, local_start_time: null, address: null,
    latitude: null, longitude: null, has_ticket: false, reservation_id: null, time_source: 'start_at' as const,
    departure_at: null, transport_mode: null, transport_status: null,
  });
  const res = {
    plan_id: 'p', today_date: '2026-05-01', timezone_id: 'Asia/Tokyo', server_time: '2026-05-01T02:30:00Z',
    now_event: null, next_event: null, minutes_until_next: null, day_end_at: '2026-05-01T15:00:00Z',
    events: [
      ev('朝食', '2026-04-30T23:00:00Z', '2026-04-30T23:45:00Z'),
      ev('寺', '2026-05-01T02:00:00Z', '2026-05-01T03:00:00Z'),
      ev('昼食', '2026-05-01T03:30:00Z'),
      ev('庭園', '2026-05-01T05:00:00Z'),
      ev('夕食', '2026-05-01T09:00:00Z'),
    ],
  };

  it('今の予定の残りと進み、NEXT の後の予定、済んだ数', () => {
    const now = Date.parse('2026-05-01T02:30:00Z');
    const view = computeTodayView(res, now);
    expect(view.nowEvent?.id).toBe('寺');
    expect(view.nextEvent?.id).toBe('昼食');
    const flow = computeTodayFlow(res, view, now);
    expect(flow.nowProgress).toEqual({ minutesLeft: 30, percent: 50 });
    expect(flow.later.map((e) => e.id)).toEqual(['庭園', '夕食']);
    expect(flow.doneCount).toBe(1);
  });

  it('終わりの時刻が無い今の予定は、次の予定の開始までで進みを出す。NEXT が無ければ後の予定も無い', () => {
    const now = Date.parse('2026-05-01T09:30:00Z');
    const view = computeTodayView(res, now);
    expect(view.nowEvent?.id).toBe('夕食');
    const flow = computeTodayFlow(res, view, now);
    expect(flow.nowProgress?.minutesLeft).toBe(330); // 現地の翌日0時(day_end_at)まで
    expect(flow.later).toEqual([]);
    expect(flow.doneCount).toBe(4);
  });
});
