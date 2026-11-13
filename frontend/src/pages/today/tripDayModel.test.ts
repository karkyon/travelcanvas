import { describe, expect, it } from 'vitest';
import { tripDayHeading } from './tripDayModel';

const h = (todayDate: string | null, deviceToday: string, start = '2026-11-28', end = '2026-11-30') =>
  tripDayHeading({ todayDate, start, end, deviceToday });

describe('[Gate TripDayNav] 旅の当日の見出し', () => {
  it('旅行中は日ごとにわくわくする見出し', () => {
    expect(h('2026-11-28', '2026-11-28').title).toBe('いよいよ今日は旅の当日！');
    expect(h('2026-11-28', '2026-11-28').eyebrow).toBe('LIVE · 旅の当日 · DAY 1/3');
    expect(h('2026-11-29', '2026-11-29').title).toBe('今日は旅の2日目！');
    expect(h('2026-11-30', '2026-11-30').title).toBe('今日は旅の最終日！');
  });
  it('出発の前は当日までの日数', () => {
    expect(h(null, '2026-11-12').title).toBe('旅の当日まで あと16日');
    expect(h(null, '2026-11-27').title).toBe('いよいよ明日は旅の当日！');
    expect(h(null, '2026-11-12').phase).toBe('before');
  });
  it('旅のあと・日付の分からない旅行', () => {
    expect(h(null, '2026-12-05').phase).toBe('after');
    expect(tripDayHeading({ todayDate: null, start: null, end: null, deviceToday: '2026-11-12' }).title).toBe('旅の当日');
    expect(tripDayHeading({ todayDate: '2026-11-12', start: null, end: null, deviceToday: '2026-11-12' }).title).toBe('今日は旅の当日！');
  });
});
