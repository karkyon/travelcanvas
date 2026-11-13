/** [Gate TimelineRedesign] 地図の上の「この日の旅程チェック」の計算 */
import { describe, expect, it } from 'vitest';
import { dayCheck, minutesText } from './mapCheckModel';
import type { TravelSegment } from '@/services/api/types/segments';

const seg = (from: string, to: string, min: number) => ({ id: `${from}-${to}`, from_event_id: from, to_event_id: to, duration_minutes: min }) as unknown as TravelSegment;
const ev = [
  { id: 'a', title: '道の駅', start_time: '09:30', end_time: '10:00' },
  { id: 'b', title: '外宮', start_time: '11:45', end_time: '13:45' },
  { id: 'c', title: 'おかげ横丁', start_time: '13:45', end_time: '15:45' },
  { id: 'c1', title: '赤福', start_time: '14:15', end_time: '14:45', parent_event_id: 'c' },
];

describe('dayCheck', () => {
  it('ゆとり: 空き − 移動の合計。エリアの中は数えない', () => {
    const r = dayCheck(ev, {}, {}, [seg('a', 'b', 89), seg('b', 'c', 0)]);
    expect(r.freeMinutes).toBe(16); // 10:00→11:45 は 105 分 − 89 分
    expect(r.late).toEqual([]);
    expect(r.moveUnset).toBe(0);
  });
  it('間に合わない区間・移動の未設定・前の予定と合わない区間', () => {
    const r = dayCheck(ev, {}, {}, [seg('a', 'b', 120), seg('x', 'c', 5)]);
    expect(r.late).toEqual(['外宮', 'おかげ横丁']);
    expect(r.moveMismatch).toBe(1);
    const r2 = dayCheck(ev, {}, {}, []);
    expect(r2.moveUnset).toBe(2);
  });
  it('営業時間・予約', () => {
    const r = dayCheck(ev, {
      a: { tone: 'good', symbol: '✓', text: '', sourceText: null }, b: { tone: 'bad', symbol: '×', text: '', sourceText: null },
    }, {
      c1: { state: 'none', issues: [], reservations: [], suggestions: [] },
      b: { state: 'suggest', issues: [], reservations: [], suggestions: [] },
    }, []);
    expect(r.hoursGood).toBe(1);
    expect(r.hoursProblems).toEqual(['外宮']);
    expect(r.unlinked).toEqual(['外宮']);
    expect(r.unbooked).toBe(1);
  });
  it('minutesText', () => {
    expect(minutesText(40)).toBe('40分');
    expect(minutesText(120)).toBe('2時間');
    expect(minutesText(95)).toBe('1時間35分');
  });
});
