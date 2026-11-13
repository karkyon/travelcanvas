import { describe, expect, it } from 'vitest';
import { publishCurrentTrip, tripRange, useCurrentTripStore } from './currentTripStore';

describe('[Gate TripDayNav] 旅行の期間', () => {
  it('旅行の日付が無ければ日程の最初・最後の日付から', () => {
    expect(tripRange({ id: 'p', days: [{ date: '2026-11-29' }, { date: '2026-11-28' }, { date: null }] }))
      .toEqual({ start: '2026-11-28', end: '2026-11-29' });
    expect(tripRange({ id: 'p', start_date: '2026-11-27', end_date: '2026-11-30', days: [{ date: '2026-11-28' }] }))
      .toEqual({ start: '2026-11-27', end: '2026-11-30' });
    publishCurrentTrip({ id: 'p1', title: '伊勢', days: [{ date: '2026-11-28' }] });
    expect(useCurrentTripStore.getState().trip).toMatchObject({ start_date: '2026-11-28', end_date: '2026-11-28' });
  });
});
