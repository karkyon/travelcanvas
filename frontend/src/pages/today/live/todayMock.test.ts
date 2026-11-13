/** [Gate TDay-Mock] モックアップの画面の言葉・計算(固定の値で確かめる) */
import { describe, it, expect, beforeEach } from 'vitest';
import type { TodayEvent } from '@/services/api';
import {
  DEFAULT_SETTINGS, addTrailPoint, arriveDiffLabel, dateLabel, durationLabel, goScreenText, modeWord, noteLines, rainTitle,
  readDayFlag, readSettings, readTrail, reiwaDate, stayDiffLabel, walkedKm, weatherLine, writeDayFlag, type GoNowView,
} from './todayLive';

const ev = (id: string, lat: number | null, lng: number | null): TodayEvent => ({
  id, title: id, event_type: 'sightseeing', start_at: null, end_at: null, local_start_time: null, address: null,
  latitude: lat, longitude: lng, has_ticket: false, reservation_id: null, time_source: 'local_start_time',
  departure_at: null, transport_mode: null, transport_status: null,
});
const go = (over: Partial<GoNowView>): GoNowView => ({
  stage: 'soon', minutesToLeave: 18, leaveBy: '2026-11-13T03:18:00Z', minutesToStart: 30, travelMinutes: 12, estimated: true,
  source: 'estimate', expectedArrivalMs: null, ring: 0.7, advice: '', ...over,
});

describe('モックアップの言葉', () => {
  beforeEach(() => window.localStorage.clear());

  it('日付は「11/13（金）」、印の日付は和暦の漢数字', () => {
    expect(dateLabel('2026-11-13')).toBe('11/13（金）');
    expect(dateLabel(null)).toBe('');
    expect(reiwaDate('2026-11-13')).toBe('令和八年 十一月十三日');
    expect(reiwaDate('2019-05-01')).toBe('令和元年 五月一日');
    expect(reiwaDate('2041-12-25')).toBe('令和二十三年 十二月二十五日');
  });

  it('雨の時間帯と空模様の一行(雨が無ければ書かない)', () => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, probability: h === 14 || h === 15 ? 70 : 10, rainy: h === 14 || h === 15 }));
    expect(rainTitle(hours)).toBe('14〜16時、雨の可能性 70%');
    expect(rainTitle(hours, 17)).toBeNull();
    expect(weatherLine('晴れ', 18.2, hours)).toBe('晴れ 18° → 14〜16時 雨 70%');
    expect(weatherLine(null, null, [])).toBeNull();
  });

  it('出発の合図の画面の言葉は段階ごと(モックアップ Mobile-GoNow)', () => {
    expect(goScreenText(go({ stage: 'relaxed', minutesToLeave: 38 }), '12:18', '12:30')).toMatchObject({
      ringTop: '出発まで', big: '38分', head: '12:18 に出れば大丈夫', primary: 'このまま楽しむ' });
    expect(goScreenText(go({}), '12:18', '12:30')).toMatchObject({ head: 'そろそろ準備を', primary: '案内を開く',
      advice: '印を押す・写真を撮るなら今のうちに。12:18 に出ると 12:30 に着きます。' });
    expect(goScreenText(go({ stage: 'now', minutesToLeave: 0 }), '12:18', '12:30')).toMatchObject({
      ringTop: '今', big: '出発', head: '今出れば 12:30 着', primary: '移動モードで出発' });
    expect(goScreenText(go({ stage: 'late', minutesToLeave: -8 }), '12:18', '12:30', '12:38')).toMatchObject({
      ringTop: '予定より', big: '+8分', head: '12:38 着の見込み', primary: '後の予定を組み直す' });
  });

  it('滞在・到着の予定との差、歩いた道のり(印を押した場所を順に結ぶ・概算)', () => {
    expect(stayDiffLabel('2026-11-13T02:00:00Z', '2026-11-13T03:06:00Z', '2026-11-13T02:00:00Z', '2026-11-13T03:08:00Z')).toBe('予定より 2分長く滞在');
    expect(stayDiffLabel(null, null, null, null)).toBeNull();
    expect(arriveDiffLabel('2026-11-13T03:30:00Z', '2026-11-13T03:31:00Z')).toBe('予定より1分遅れ');
    expect(arriveDiffLabel('2026-11-13T03:30:00Z', '2026-11-13T03:30:00Z')).toBe('予定どおり');
    const km = walkedKm([ev('a', 35.0, 135.86), ev('b', 35.01, 135.86), ev('c', null, null)], new Set(['a', 'b', 'c']));
    expect(km).toBeCloseTo(1.1, 1);
  });

  it('場所のメモを「着いたら」の手順に、移動の手段・長さを言葉に', () => {
    expect(noteLines('湖側の遊歩道を右手に。2階テラスへの外階段から入る\n- 予約名を伝える', null)).toEqual([
      '湖側の遊歩道を右手に', '2階テラスへの外階段から入る', '予約名を伝える']);
    expect(modeWord('walking')).toBe('徒歩');
    expect(modeWord(null)).toBe('移動');
    expect(durationLabel(90)).toBe('1時間30分');
    expect(durationLabel(15)).toBe('15分');
  });

  it('位置の設定は既定で OFF。古い保存(位置の項目が無い)も読める。朝・夜の画面を閉じたことは日ごとに覚える', () => {
    expect(DEFAULT_SETTINGS.location).toEqual({ arrive: false, trail: false });
    expect(DEFAULT_SETTINGS.notices.detour).toBe(false);
    window.localStorage.setItem('tc.today.live', JSON.stringify({ notices: { go: false }, voice: true }));
    expect(readSettings()).toMatchObject({ notices: { go: false, rain: true, detour: false }, location: { arrive: false, trail: false }, voice: true });
    expect(readDayFlag('morning.p.2026-11-13')).toBe(false);
    writeDayFlag('morning.p.2026-11-13');
    expect(readDayFlag('morning.p.2026-11-13')).toBe(true);
  });

  it('今日の足跡はこの端末だけに置き、近すぎる点・短すぎる間隔は足さない', () => {
    addTrailPoint('p', '2026-11-13', [35.0, 135.86, 0]);
    addTrailPoint('p', '2026-11-13', [35.0001, 135.86, 10_000]);
    addTrailPoint('p', '2026-11-13', [35.01, 135.86, 20_000]);
    expect(readTrail('p', '2026-11-13')).toHaveLength(2);
    expect(readTrail('p', '2026-11-14')).toEqual([]);
  });
});
