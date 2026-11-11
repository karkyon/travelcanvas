/** [Gate EventArea] エリアの中の予定の表示と並べ替えの計算 */
import { describe, expect, it } from 'vitest';
import type { ScheduleItem } from '@/types';
import { applyExtra, areaCircles, areaDrop, areaMove, areaRoles, areaSummary, blockOf, isInnerPair } from './areaModel';

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

describe('[AreaDrag] ドラッグでエリアへ入れる・出す', () => {
  const day = () => [
    ev('伊勢神宮', { start_time: '10:00', end_time: '12:00' }),
    ev('おかげ横丁', { category: 'area', start_time: '13:45', end_time: '15:45' }),
    ev('赤福', { parent_event_id: 'おかげ横丁', start_time: '14:45', end_time: '15:15' }),
    ev('ダンデライオン', { start_time: '16:15', end_time: '16:45' }),
  ];

  it('外 → 外はエリアと関係ない(今までの入れ替え)', () => {
    expect(areaDrop(day(), '伊勢神宮', 4, null)).toEqual({ kind: 'plain' });
  });

  it('外の予定をエリアの中へ: 中の予定の後ろへ時刻を付け、はみ出したらエリアの終わりを延ばす', () => {
    const r = areaDrop(day(), 'ダンデライオン', 3, 'おかげ横丁');
    expect(r.kind).toBe('move');
    if (r.kind !== 'move') return;
    expect(r.order).toEqual(['伊勢神宮', 'おかげ横丁', '赤福', 'ダンデライオン']);
    expect(r.extra).toEqual({ parents: { ダンデライオン: 'おかげ横丁' },
      times: { ダンデライオン: { start: '15:15', end: '15:45' } } });
  });

  it('エリアの先頭へ入れると中の予定を後ろへずらす。エリアのまとまりは外の位置へ(中には入れない)', () => {
    const list = [...day()];
    list[2] = { ...list[2]!, start_time: '13:45', end_time: '15:30' };
    const r = areaDrop(list, '伊勢神宮', 2, 'おかげ横丁');
    if (r.kind !== 'move') throw new Error(r.kind);
    expect(r.extra.times).toEqual({ 伊勢神宮: { start: '13:45', end: '15:45' }, 赤福: { start: '15:45', end: '17:30' },
      おかげ横丁: { start: '13:45', end: '17:30' } });
    const m = areaDrop(day(), 'おかげ横丁', 0, null);
    expect(m.kind === 'move' && m.order).toEqual(['おかげ横丁', '赤福', '伊勢神宮', 'ダンデライオン']);
    expect(areaDrop(day(), 'おかげ横丁', 2, 'おかげ横丁').kind).toBe('blocked');
  });

  it('確定の予定は動かさない・日をまたぐ時刻にはしない', () => {
    const locked = day().map((e) => (e.id === 'ダンデライオン' ? { ...e, locked: true } : e));
    expect(areaDrop(locked, 'ダンデライオン', 3, 'おかげ横丁').kind).toBe('blocked');
    const late = day().map((e) => (e.id === 'ダンデライオン' ? { ...e, start_time: '22:00', end_time: '23:50' } : e));
    late[2] = { ...late[2]!, start_time: '22:30', end_time: '23:30' };
    expect(areaDrop(late, 'ダンデライオン', 3, 'おかげ横丁')).toMatchObject({ kind: 'blocked' });
  });

  it('案の見え方: エリアの指定と時刻を当てる', () => {
    const v = applyExtra(day(), { parents: { ダンデライオン: 'おかげ横丁' }, times: { ダンデライオン: { start: '15:15', end: '15:45' } } });
    expect(v[3]).toMatchObject({ parent_event_id: 'おかげ横丁', start_time: '15:15', end_time: '15:45' });
  });
});
