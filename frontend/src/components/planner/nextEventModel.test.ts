/** [Gate SpotInfo] NEXT はその日の現地の日付が今日の時だけ。 */
import { describe, it, expect } from 'vitest';
import { localToday, nextEventIndexFor } from './nextEventModel';

const events = [{ start_time: '08:10' }, { start_time: '09:58' }, { start_time: '12:00' }];
const now = new Date('2026-11-07T00:30:00Z'); // 東京 09:30

describe('nextEventIndexFor', () => {
  it('今日(現地)なら今より後の最初の予定', () => {
    expect(localToday('Asia/Tokyo', now)).toEqual({ date: '2026-11-07', time: '09:30' });
    expect(nextEventIndexFor(events, '2026-11-07', 'Asia/Tokyo', now)).toBe(1);
  });
  it('今日でない日・日付の無い日は付けない', () => {
    expect(nextEventIndexFor(events, '2025-05-17', 'Asia/Tokyo', now)).toBe(-1);
    expect(nextEventIndexFor(events, '2026-11-08', 'Asia/Tokyo', now)).toBe(-1);
    expect(nextEventIndexFor(events, undefined, 'Asia/Tokyo', now)).toBe(-1);
  });
  it('現地の日付で比べる(ロサンゼルスはまだ 11/6 の 16:30)', () => {
    const la = [{ start_time: '10:00' }, { start_time: '18:00' }];
    expect(nextEventIndexFor(la, '2026-11-06', 'America/Los_Angeles', now)).toBe(1);
    expect(nextEventIndexFor(la, '2026-11-07', 'America/Los_Angeles', now)).toBe(-1);
  });
});
