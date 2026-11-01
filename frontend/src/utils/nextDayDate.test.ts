import { describe, it, expect } from 'vitest';
import { nextDayDate } from './nextDayDate';

describe('nextDayDate', () => {
  it('最後の日の翌日(今日の日付に関係なく、既存の日と重ならない)', () => {
    expect(nextDayDate(['2026-11-01'], new Date(2026, 9, 31, 22, 0))).toBe('2026-11-02');
    expect(nextDayDate(['2026-11-03', '2026-11-01'], new Date(2026, 0, 1))).toBe('2026-11-04');
  });
  it('月末・年末・うるう年をまたぐ', () => {
    expect(nextDayDate(['2026-01-31'])).toBe('2026-02-01');
    expect(nextDayDate(['2026-12-31'])).toBe('2027-01-01');
    expect(nextDayDate(['2028-02-28'])).toBe('2028-02-29');
  });
  it('日が無い・読めない時は端末の今日', () => {
    expect(nextDayDate([], new Date(2026, 10, 1, 8, 30))).toBe('2026-11-01');
    expect(nextDayDate([null, 'x'], new Date(2026, 10, 1, 0, 5))).toBe('2026-11-01');
  });
});
