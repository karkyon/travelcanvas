/** [Gate EventArea] エリアの中の予定の表示と並べ替えの計算 */
import { describe, expect, it } from 'vitest';
import type { ScheduleItem } from '@/types';
import { areaCircles, areaMove, areaRoles, areaSummary, blockOf, isInnerPair } from './areaModel';

const ev = (id: string, extra: Partial<ScheduleItem> = {}): ScheduleItem =>
  ({ id, title: id, category: 'sightseeing', ...extra }) as ScheduleItem;

// 伊勢神宮 → おかげ横丁(エリア: 赤福・ダンデライオン)→ 鳥羽水族館
const list = [
  ev('伊勢神宮', { start_time: '10:00', end_time: '12:00' }),
  ev('おかげ横丁', { category: 'area', start_time: '13:45', end_time: '15:45' }),
  ev('赤福', { parent_event_id: 'おかげ横丁', start_time: '13:50', end_time: '14:20' }),
  ev('ダンデライオン', { parent_event_id: 'おかげ横丁', start_time: '14:30', end_time: '15:30' }),
  ev('鳥羽水族館', { start_time: '16:30', end_time: '18:00' }),
];

describe('areaModel', () => {
  it('役割: エリア・中の予定(枠の最後)・普通の予定', () => {
    const r = areaRoles(list);
    expect(r.get('おかげ横丁')).toEqual({ role: 'area', areaId: 'おかげ横丁', last: false });
    expect(r.get('赤福')).toEqual({ role: 'member', areaId: 'おかげ横丁', last: false });
    expect(r.get('ダンデライオン')).toEqual({ role: 'member', areaId: 'おかげ横丁', last: true });
    expect(r.get('鳥羽水族館')!.role).toBe('none');
    // 中が無いエリアはエリア自身が枠の最後
    expect(areaRoles([ev('a', { category: 'area' }), ev('b')]).get('a')!.last).toBe(true);
    // エリアから離れた中の予定は枠に入れない
    expect(areaRoles([ev('a', { category: 'area' }), ev('b'), ev('c', { parent_event_id: 'a' })]).get('c')!.role).toBe('none');
  });

  it('エリアの中の移動(数えない)', () => {
    expect(isInnerPair(list[1], list[2])).toBe(true);
    expect(isInnerPair(list[2], list[3])).toBe(true);
    expect(isInnerPair(list[3], list[4])).toBe(false);
    expect(isInnerPair(list[0], list[1])).toBe(false);
  });

  it('見出しの数: 滞在・中の予定・空き', () => {
    const s = areaSummary(list[1]!, [list[2]!, list[3]!]);
    expect(s).toMatchObject({ stay: 120, count: 2, used: 90, free: 30 });
    expect(s.text).toBe('エリア内の滞在 2時間・中の予定 2件・空き 30分');
    expect(areaSummary(ev('x', { category: 'area' }), []).text).toBe('エリア内の滞在 時刻未設定・中の予定 0件');
  });

  it('まとまりの位置', () => {
    expect(blockOf(list, 1)).toEqual([1, 3]);
    expect(blockOf(list, 3)).toEqual([1, 3]);
    expect(blockOf(list, 0)).toEqual([0, 0]);
  });

  it('並べ替え: 中の予定はエリアの中だけ。外へは出ない', () => {
    expect(areaMove(list, 3, -1)).toEqual({ kind: 'default' });
    expect(areaMove(list, 2, -1)).toMatchObject({ kind: 'blocked' });
    expect(areaMove(list, 3, 1)).toMatchObject({ kind: 'blocked' });
  });

  it('並べ替え: エリアとエリアを越える予定は、まとまりごと(時刻は予定に付いたまま)', () => {
    const up = areaMove(list, 1, -1);
    expect(up).toMatchObject({ kind: 'move', keepSlots: false,
      order: ['おかげ横丁', '赤福', 'ダンデライオン', '伊勢神宮', '鳥羽水族館'] });
    const over = areaMove(list, 4, -1);
    expect(over).toMatchObject({ kind: 'move', order: ['伊勢神宮', '鳥羽水族館', 'おかげ横丁', '赤福', 'ダンデライオン'] });
    // 端のまとまりはそれ以上動かない(エリアと中の予定を入れ替えない)
    expect(areaMove(list.slice(0, 4), 1, 1)).toMatchObject({ kind: 'blocked' });
    // エリアが関わらない入れ替えは今まで通り
    expect(areaMove([ev('a'), ev('b')], 1, -1)).toEqual({ kind: 'default' });
    // 確定の予定が関わると動かさない
    const locked = list.map((e) => (e.id === '伊勢神宮' ? { ...e, locked: true } : e));
    expect(areaMove(locked, 1, -1)).toMatchObject({ kind: 'blocked' });
  });

  it('地図の範囲の円: エリアの位置(無ければ中の予定の真ん中)を中心に、中の予定が入る大きさ', () => {
    const evs = [
      ev('A', { category: 'area' }),
      ev('m1', { parent_event_id: 'A', latitude: 34.46, longitude: 136.72 }),
      ev('m2', { parent_event_id: 'A', latitude: 34.462, longitude: 136.722 }),
      ev('B', { category: 'area' }),  // 位置が無い
    ];
    const [c] = areaCircles(evs);
    expect(areaCircles(evs)).toHaveLength(1);
    expect(c!.center[0]).toBeCloseTo(34.461, 3);
    expect(c!.radius).toBeGreaterThanOrEqual(120);
    expect(c!.radius).toBeLessThan(400);
    expect(areaCircles([ev('A', { category: 'area', latitude: 34.46, longitude: 136.72 })])[0]!.radius).toBe(120);
  });
});
