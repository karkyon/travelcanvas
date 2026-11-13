/**
 * [Gate Remaining-2] FR-008 旅行の日ごとの祝日(日付 → 祝日の名前)。日本は計算、日本の外は Nager.Date(backend が取る)。
 * 取れない時は空(画面は祝日を出さないだけ)。日付の組が変わった時だけ取り直す。
 */
import { useEffect, useState } from 'react';

export function usePlanHolidays(planId: string | undefined, dates: string[]): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = dates.join(',');
  useEffect(() => {
    if (!planId || !key) {
      setMap({});
      return undefined;
    }
    let alive = true;
    import('@/services/api/remaining2')
      .then((m) => m.getPlanHolidays(planId))
      .then((days) => {
        if (!alive) return;
        const next: Record<string, string> = {};
        for (const d of days) if (d.holiday) next[d.local_date] = d.holiday;
        setMap(next);
      })
      .catch(() => { if (alive) setMap({}); });
    return () => { alive = false; };
  }, [planId, key]);
  return map;
}
