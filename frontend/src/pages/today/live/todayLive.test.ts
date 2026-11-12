/** [Gate TDay] 旅帖ライブの計算(固定の時刻)。backend の today_guide.stage と同じ基準であることも確かめる */
import { describe, it, expect, beforeEach } from 'vitest';
import type { TodayEvent } from '@/services/api';
import type { GuideEvent, TodayGuide } from '@/services/api/travelDay';
import {
  DEFAULT_SETTINGS, dayPhase, etaMessage, goNowView, goStage, hoursLabel, localHm, planDetour, rainWindow, readDismissed,
  readSettings, recapTitle, sealGlyph, sealTilt, skyAdvice, walkMinutes, writeDismissed, writeSettings,
} from './todayLive';

const ev = (over: Partial<TodayEvent>): TodayEvent => ({
  id: 'e', title: '予定', event_type: 'activity', start_at: null, end_at: null, local_start_time: null, address: null,
  latitude: null, longitude: null, has_ticket: false, reservation_id: null, time_source: 'local_start_time',
  departure_at: null, transport_mode: null, transport_status: null, ...over,
});
const gev = (over: Partial<GuideEvent>): GuideEvent => ({
  event_id: 'e', place_id: null, phone: null, image_memory_id: null, end_at: null, end_estimated: false,
  travel_minutes: null, travel_mode: null, distance_km: null, travel_source: null, leave_by: null, fit: 'unknown',
  hours: null, ...over,
});
const at = (iso: string) => Date.parse(iso);

describe('出発の合図', () => {
  it('段階の境目は backend と同じ(21分〜余裕あり・1〜20分そろそろ・0〜−4分今出発・それより後は遅れ気味)', () => {
    expect([null, 38, 21, 20, 1, 0, -4, -5].map(goStage)).toEqual([null, 'relaxed', 'relaxed', 'soon', 'soon', 'now', 'now', 'late']);
  });

  it('出る時刻は guide を優先し、無ければ移動区間の出発時刻。概算の時は estimated', () => {
    const next = ev({ id: 'n', start_at: '2026-11-13T03:30:00Z', departure_at: '2026-11-13T03:05:00Z' });
    const g = gev({ leave_by: '2026-11-13T03:18:00Z', travel_minutes: 12, travel_source: 'estimate' });
    const v = goNowView(next, g, at('2026-11-13T03:00:00Z'))!;
    expect(v).toMatchObject({ stage: 'soon', minutesToLeave: 18, leaveBy: '2026-11-13T03:18:00Z', minutesToStart: 30,
      travelMinutes: 12, estimated: true, expectedArrivalMs: null });
    expect(v.ring).toBeCloseTo(0.7, 2);
    const seg = goNowView(next, undefined, at('2026-11-13T02:00:00Z'))!;
    expect(seg).toMatchObject({ stage: 'relaxed', minutesToLeave: 65, estimated: false, ring: 0 });
    expect(goNowView(ev({ start_at: '2026-11-13T03:30:00Z' }), undefined, at('2026-11-13T03:00:00Z'))).toBeNull();
  });

  it('遅れ気味の時は、今から移動の分で着く見込みを出す', () => {
    const next = ev({ id: 'n', start_at: '2026-11-13T03:30:00Z' });
    const v = goNowView(next, gev({ leave_by: '2026-11-13T03:18:00Z', travel_minutes: 12 }), at('2026-11-13T03:26:00Z'))!;
    expect(v.stage).toBe('late');
    expect(v.expectedArrivalMs).toBe(at('2026-11-13T03:38:00Z'));
  });
});

describe('旅帖の印の字', () => {
  it('場所の最初の漢字と種類の字。宿・出発は決まった字。漢字が無ければ頭の文字', () => {
    expect(sealGlyph('大津駅')).toBe('大駅');
    expect(sealGlyph('本要寺')).toBe('本寺');
    expect(sealGlyph('浜大津の湖岸')).toBe('浜湖');
    expect(sealGlyph('琵琶湖ホテル')).toBe('宿');
    expect(sealGlyph('自宅を出発')).toBe('発');
    expect(sealGlyph('Oh!Me テラス')).toBe('O');
    expect(sealGlyph('！？')).toBe('旅');
    expect(sealGlyph('京都')).toBe('京都');
  });
  it('傾きは同じ予定ならいつも同じ(−6〜6度)', () => {
    expect(sealTilt('abc')).toBe(sealTilt('abc'));
    for (const id of ['a', 'bb', 'ccc', 'event-1']) expect(Math.abs(sealTilt(id))).toBeLessThanOrEqual(6);
  });
});

describe('空模様', () => {
  const hours = [10, 11, 12, 13, 14, 15, 16, 17].map((h) => ({ hour: h, probability: h >= 14 && h <= 15 ? 70 : 10, rainy: h >= 14 && h <= 15 }));
  it('雨の時間帯と行動の言葉', () => {
    expect(rainWindow(hours)).toEqual({ start: 14, end: 16, max: 70 });
    expect(skyAdvice(hours, 12)).toBe('14〜16時に雨の可能性 70%。傘を持って出よう');
    expect(skyAdvice(hours, 17)).toBeNull();
  });
  it('現地の時刻', () => {
    expect(localHm('2026-11-13T03:30:00Z', 'Asia/Tokyo')).toBe('12:30');
    expect(localHm(null, 'Asia/Tokyo')).toBeNull();
  });
});

describe('寄り道', () => {
  const gap = { after_event_id: 'a', before_event_id: 'b', start_at: '2026-11-13T05:55:00Z', end_at: '2026-11-13T06:45:00Z', minutes: 50 };
  it('足した時刻と、次の予定への影響(行き帰りの歩く時間を含む)', () => {
    expect(planDetour(gap, 30, 5, 'Asia/Tokyo')).toEqual({ start: '15:00', end: '15:30', fits: true, overflowMinutes: 0, leftMinutes: 10 });
    expect(planDetour(gap, 45, 5, 'Asia/Tokyo')).toMatchObject({ fits: false, overflowMinutes: 5 });
  });
  it('歩く時間の概算(片道)', () => {
    expect(walkMinutes(0.3)).toBe(5);
    expect(walkMinutes(null)).toBe(10);
    expect(walkMinutes(0)).toBe(3);
  });
});

describe('一日の時間帯', () => {
  const g = (over: Partial<TodayGuide>): TodayGuide => ({
    plan_id: 'p', server_time: '', day_id: 'd', day_title: null, local_date: '2026-11-13', timezone_id: 'Asia/Tokyo',
    day_index: 1, day_count: 2, is_last_day: false, upcoming: null, next_day: null, min_gap_minutes: 30, events: {}, gaps: [],
    stamps: {}, metrics: { visited: 0, total: 0, photos: 0, notes: 0 }, ...over,
  });
  const evs = [ev({ id: 'a', start_at: '2026-11-13T00:00:00Z' }), ev({ id: 'b', start_at: '2026-11-13T05:00:00Z' })];
  it('旅の前・朝・旅の間・夜・旅の終わり', () => {
    expect(dayPhase(g({ day_id: null, upcoming: { date: '2026-11-14', days_until: 1, day_title: null, is_trip_start: true,
      first_event_title: null, first_event_time: null } }), [], 0, false, false)).toBe('before');
    expect(dayPhase(g({ day_id: null }), [], 0, false, false)).toBe('none');
    expect(dayPhase(g({}), evs, at('2026-11-12T23:00:00Z'), false, true)).toBe('morning');
    expect(dayPhase(g({}), evs, at('2026-11-13T01:00:00Z'), true, true)).toBe('during');
    expect(dayPhase(g({}), evs, at('2026-11-13T12:00:00Z'), false, false)).toBe('night');
    expect(dayPhase(g({ is_last_day: true }), evs, at('2026-11-13T12:00:00Z'), false, false)).toBe('finished');
  });
});

describe('言葉', () => {
  it('営業の照合', () => {
    expect(hoursLabel('ok', 90)).toEqual({ text: '営業中', tone: 'good' });
    expect(hoursLabel('near_close', 20)).toEqual({ text: '閉店まで20分', tone: 'warn' });
    expect(hoursLabel('closed', null)?.tone).toBe('bad');
    expect(hoursLabel('unknown', null)).toBeNull();
  });
  it('到着予定の文(位置は含めない)・ふりかえり', () => {
    expect(etaMessage('テラス', '12:30', null)).toBe('「テラス」に12:30ごろ着きます');
    expect(etaMessage('テラス', '12:40', 10)).toBe('「テラス」に12:40ごろ着きます(予定より10分遅れ)');
    expect(recapTitle(3, 3)).toBe('すべての場所をめぐりました');
    expect(recapTitle(2, 5)).toBe('5か所のうち2か所をめぐりました');
  });
});

describe('当日の設定・閉じた知らせ(この端末に覚える)', () => {
  beforeEach(() => window.localStorage.clear());
  it('既定・保存・壊れた値', () => {
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
    writeSettings({ ...DEFAULT_SETTINGS, voice: true, notices: { ...DEFAULT_SETTINGS.notices, rain: false } });
    expect(readSettings()).toMatchObject({ voice: true, notices: { rain: false, go: true } });
    window.localStorage.setItem('tc.today.live', '{bad');
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
    writeDismissed(new Set(['2026-11-13:go:x']));
    expect(readDismissed().has('2026-11-13:go:x')).toBe(true);
  });
});
