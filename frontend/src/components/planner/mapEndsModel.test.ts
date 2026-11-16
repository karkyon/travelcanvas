import { describe, expect, it } from 'vitest';
import { anchorWantsHome, buildMapEnds, directionArrow } from './mapEndsModel';

const ev = (id: string, category: string, lat?: number, lng?: number, title = id) =>
  ({ id, title, category, latitude: lat, longitude: lng, location_name: title }) as never;

describe('[Gate HomeRoute] 地図の日の端', () => {
  const plan = {
    journey_enabled: true, journey_start_place: '自宅', journey_end_place: null,
    days: [
      { events: [ev('a', 'sightseeing', 34.3, 136.8), ev('h1', 'accommodation', 34.30, 136.82, 'アクアフォレスト')] },
      { events: [ev('b', 'sightseeing', 34.27, 136.86)] },
      { events: [ev('c', 'sightseeing', 34.5, 136.7)] },
    ],
  };
  it('1日目: 出発が「自宅」なら自宅の候補(位置は持たない)', () => {
    const e = buildMapEnds(plan, 0);
    expect(e.start).toMatchObject({ kind: 'home', role: 'start', pos: null });
    expect(e.end).toBeNull(); // 今夜の宿はその日の予定として地図に出ている
  });
  it('2日目: 前の夜の宿の位置と予定の ID・連泊の今夜の宿', () => {
    const e = buildMapEnds(plan, 1);
    expect(e.start).toMatchObject({ kind: 'lodging', pos: [34.30, 136.82], eventId: 'h1', label: '前の夜の宿: アクアフォレスト' });
    expect(e.end).toMatchObject({ kind: 'lodging', role: 'end', eventId: 'h1' });
  });
  it('最終日: 帰着が空なら自宅の候補。別の場所なら出さない(架空の位置を作らない)', () => {
    expect(buildMapEnds(plan, 2).end).toMatchObject({ kind: 'home', role: 'end' });
    expect(buildMapEnds({ ...plan, journey_end_place: '東京駅' }, 2).end).toBeNull();
  });
  it('宿の座標が無ければ出さない', () => {
    const p2 = { ...plan, days: [{ events: [ev('h', 'accommodation')] }, { events: [ev('x', 'food', 1, 1)] }] };
    expect(buildMapEnds(p2, 1).start).toBeNull();
  });
  it('自宅の候補の判定と方向', () => {
    expect(anchorWantsHome({ kind: 'departure', place: '自宅(横浜)', time: null, continued: false })).toBe(true);
    expect(anchorWantsHome({ kind: 'lodging-from', place: null, time: null, continued: false })).toBe(false);
    expect(directionArrow([35, 139], [36, 139])).toBe('↑');
    expect(directionArrow([35, 139], [34, 138])).toBe('↙');
  });
});
