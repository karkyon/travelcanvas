/**
 * [Gate M9-FE-B3] DateNavigation: アクティブタブへのスクロールはcurrentDay変化時のみ。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import DateNavigation from './DateNavigation';

const makeDays = () =>
  [0, 1, 2].map((i) => ({
    index: i,
    date: `2026-10-0${i + 1}`,
    dayOfWeek: '月',
    isActive: i === 0,
    isCompleted: false,
    eventCount: 0,
    status: 'upcoming' as const,
    highlights: [],
    totalCost: 0,
    totalDuration: 0,
  }));

const travelDates = { startDate: '2026-10-01', endDate: '2026-10-03' };

describe('DateNavigation (Gate M9-FE-B3)', () => {
  const originalScrollTo = HTMLElement.prototype.scrollTo;
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const scrollTo = vi.fn();

  beforeEach(() => {
    scrollTo.mockReset();
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
    // jsdomは幅0のため、タブが常に表示範囲外(右側)になるよう幅を与える
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 100 });
  });

  afterEach(() => {
    HTMLElement.prototype.scrollTo = originalScrollTo;
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    }
  });

  it('currentDayが変わった時だけスクロールし、days配列の再生成では再スクロールしない', () => {
    const onDayChange = vi.fn();
    const { rerender } = render(
      <DateNavigation days={makeDays()} currentDay={0} onDayChange={onDayChange} travelDates={travelDates} />
    );
    const afterMount = scrollTo.mock.calls.length;
    expect(afterMount).toBe(1);

    rerender(
      <DateNavigation days={makeDays()} currentDay={0} onDayChange={onDayChange} travelDates={travelDates} />
    );
    expect(scrollTo).toHaveBeenCalledTimes(afterMount);

    rerender(
      <DateNavigation days={makeDays()} currentDay={2} onDayChange={onDayChange} travelDates={travelDates} />
    );
    expect(scrollTo).toHaveBeenCalledTimes(afterMount + 1);
  });
});
