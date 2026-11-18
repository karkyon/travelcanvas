/** [Gate SpotMode] FR-060 スポットモードの計算 */
import { describe, expect, it } from 'vitest';
import type { SpotItem } from '@/services/api/types/spotAreas';
import {
  bearingDeg, directionWord, distanceM, formatDistance, hhmm, matchesMood, minutesOf, nowIn, openAt, planChain,
  rankNext, shouldSuggest, sortItems, timeState, walkMinutes, googleWalkUrl, appleWalkUrl, type LatLng,
} from './spotModel';

const ME: LatLng = [34.4632, 136.7246];
const mk = (over: Partial<SpotItem>): SpotItem => ({
  id: over.id ?? 'i', candidate_id: 'c', title: '候補', note: null, category: null, address: null,
  latitude: 34.4622, longitude: 136.7249, place_id: null, genre: 'food', genre_label: '食べ歩き', priority: 'maybe',
  stay_minutes: 20, sort_order: 0, visited_at: null, visited_by: null, skipped: false, wanted_by: [], wanted_by_me: false,
  fit: 'unknown', seats: false, hours_today: null, ...over,
});

describe('距離・方角・時刻', () => {
  it('直線の距離と歩く分(80m/分)', () => {
    const m = distanceM(ME, [34.4622, 136.7249]);
    expect(m).toBeGreaterThan(100);
    expect(m).toBeLessThan(130);
    expect(walkMinutes(m)).toBe(2);
    expect(walkMinutes(0)).toBe(1);
    expect(formatDistance(1234)).toBe('1.2km');
    expect(formatDistance(214)).toBe('210m');
  });
  it('方角の言葉', () => {
    expect(directionWord(bearingDeg(ME, [34.47, 136.7246]))).toBe('北');
    expect(directionWord(bearingDeg(ME, [34.4632, 136.74]))).toBe('東');
  });
  it('HH:MM と分', () => {
    expect(minutesOf('13:05')).toBe(785);
    expect(minutesOf('bad')).toBeNull();
    expect(hhmm(785)).toBe('13:05');
    expect(hhmm(-5)).toBe('23:55');
  });
  it('時間帯の今の時刻', () => {
    const n = nowIn('Asia/Tokyo', Date.UTC(2026, 10, 29, 4, 30));
    expect(n).toEqual({ minutes: 13 * 60 + 30, date: '2026-11-29' });
  });
});

describe('残り時間と戻り始め', () => {
  const area = { start_time: '13:00', end_time: '15:30', meet_time: '15:30', meet_latitude: 34.4640, meet_longitude: 136.7230 };
  it('集合まで歩く分を引いて戻り始めを出す', () => {
    const t = timeState(area, 13 * 60 + 48, ME);
    expect(t.walkToMeet).toBe(3);
    expect(t.returnBy).toBe(15 * 60 + 27);
    expect(t.remain).toBe(102);
    expect(t.level).toBe('calm');
    expect(t.progress).toBeCloseTo(48 / 150);
  });
  it('4 段階', () => {
    expect(timeState(area, 15 * 60 + 5, null).level).toBe('soon');
    expect(timeState(area, 15 * 60 + 25, null).level).toBe('now');
    expect(timeState(area, 15 * 60 + 31, null).level).toBe('late');
    expect(timeState({ ...area, end_time: null, meet_time: null }, 0, null).remain).toBeNull();
  });
});

describe('営業時間', () => {
  const h = (windows: Array<[string, string]>, closed = false) => ({ date: '2026-11-29', source: 'weekly' as const, closed, note: null,
    windows: windows.map(([open, close]) => ({ open, close, crosses_midnight: false, last_entry: null, last_order: null, source: 'w' })),
    summary: '' });
  it('営業中・時間外・休み・不明', () => {
    expect(openAt(h([['09:00', '17:00']]), 13 * 60)).toBe(true);
    expect(openAt(h([['09:00', '17:00']]), 18 * 60)).toBe(false);
    expect(openAt(h([], true), 13 * 60)).toBe(false);
    expect(openAt(null, 13 * 60)).toBeNull();
    expect(openAt({ ...h([]), source: 'unknown' }, 0)).toBeNull();
  });
});

describe('次どこ？', () => {
  const near = mk({ id: 'near', title: '豚捨', latitude: 34.4628, longitude: 136.7247 });
  const want = mk({ id: 'want', title: '赤福', priority: 'want', seats: true, latitude: 34.4610, longitude: 136.7247 });
  const cafe = mk({ id: 'cafe', genre: 'cafe', seats: true, fit: 'indoor', latitude: 34.4605, longitude: 136.7262, stay_minutes: 30 });
  const done = mk({ id: 'done', visited_at: '2026-11-29T04:00:00Z' });
  it('済みを除き、気分に合う物を先に、理由を付ける', () => {
    const r = rankNext([near, want, cafe, done], ME, ['tired'], 13 * 60 + 48, 100);
    expect(r.map((x) => x.item.id)).toEqual(['want', 'cafe', 'near']);
    expect(r[0]!.reasons).toEqual(expect.arrayContaining(['座れる', '行きたい', '残り時間に収まる']));
  });
  it('雨・屋内', () => {
    expect(rankNext([near, want, cafe], ME, ['rain'], 0, null)[0]!.item.id).toBe('cafe');
    expect(matchesMood(cafe, 'rain')).toBe(true);
    expect(matchesMood(near, 'toilet')).toBe(false);
  });
  it('時間が足りない・営業時間外は後ろ', () => {
    const r = rankNext([cafe, near], ME, [], 0, 10);
    expect(r[0]!.item.id).toBe('near');
    expect(r[1]!.reasons).toContain('時間が足りない');
  });
});

describe('回れる道順の案', () => {
  it('行きたいを先に、集合に間に合う間だけ足す', () => {
    const a = mk({ id: 'a', priority: 'want', latitude: 34.4610, longitude: 136.7247, stay_minutes: 20 });
    const b = mk({ id: 'b', latitude: 34.4628, longitude: 136.7247, stay_minutes: 15 });
    const c = mk({ id: 'c', latitude: 34.4617, longitude: 136.7240, stay_minutes: 30 });
    const meet: LatLng = [34.4640, 136.7230];
    const chain = planChain([a, b, c], ME, 13 * 60 + 48, 15 * 60 + 30, meet)!;
    expect(chain.order[0]!.id).toBe('a');
    expect(chain.order.map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(chain.spare).toBeGreaterThanOrEqual(0);
    const short = planChain([a, b, c], ME, 13 * 60 + 48, 14 * 60 + 20, meet)!;
    expect(short.order.map((i) => i.id)).toEqual(['a']);
    expect(planChain([a], null, 0, null, null)).toBeNull();
  });
});

describe('並び・勧め・地図アプリ', () => {
  it('近い順(済みは後ろ)・行きたい順', () => {
    const x = mk({ id: 'x', latitude: 34.4630, longitude: 136.7246 });
    const y = mk({ id: 'y', latitude: 34.4600, longitude: 136.7246, priority: 'want' });
    const z = mk({ id: 'z', latitude: 34.4631, longitude: 136.7246, skipped: true });
    expect(sortItems([y, z, x], ME, 'near').map((i) => i.id)).toEqual(['x', 'y', 'z']);
    expect(sortItems([x, y], ME, 'want').map((i) => i.id)).toEqual(['y', 'x']);
  });
  it('近づいた・時間になったら勧める(勧めない設定なら出さない)', () => {
    const area = { suggest_on_approach: true, start_time: '13:00', end_time: '15:30', radius_m: 400 };
    expect(shouldSuggest(area, 0, ME, ME)).toBe('near');
    expect(shouldSuggest(area, 12 * 60 + 55, ME, null)).toBe('time');
    expect(shouldSuggest(area, 11 * 60, ME, [35, 137])).toBeNull();
    expect(shouldSuggest({ ...area, suggest_on_approach: false }, 13 * 60, ME, ME)).toBeNull();
  });
  it('地図アプリの URL', () => {
    expect(googleWalkUrl([34.1, 136.2])).toContain('destination=34.1,136.2&travelmode=walking');
    expect(appleWalkUrl([34.1, 136.2])).toContain('daddr=34.1,136.2&dirflg=w');
  });
});
