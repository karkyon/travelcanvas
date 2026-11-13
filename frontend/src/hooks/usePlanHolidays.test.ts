/** [Gate Remaining-2] FR-008 旅行の日ごとの祝日(日付 → 名前)。取れない時は空 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ getPlanHolidays: vi.fn() }));
vi.mock('@/services/api/remaining2', () => ({ getPlanHolidays: m.getPlanHolidays }));

import { usePlanHolidays } from './usePlanHolidays';

describe('usePlanHolidays', () => {
  it('祝日の日だけを日付で引ける', async () => {
    m.getPlanHolidays.mockResolvedValueOnce([
      { day_id: 'a', local_date: '2026-11-03', country_code: 'JP', holiday: '文化の日' },
      { day_id: 'b', local_date: '2026-11-04', country_code: 'JP', holiday: null },
    ]);
    const { result } = renderHook(() => usePlanHolidays('p1', ['2026-11-03', '2026-11-04']));
    await waitFor(() => expect(result.current).toEqual({ '2026-11-03': '文化の日' }));
  });

  it('失敗・旅行なしは空', async () => {
    m.getPlanHolidays.mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => usePlanHolidays('p1', ['2026-11-03']));
    await waitFor(() => expect(m.getPlanHolidays).toHaveBeenCalled());
    expect(result.current).toEqual({});
    expect(renderHook(() => usePlanHolidays(undefined, [])).result.current).toEqual({});
  });
});
