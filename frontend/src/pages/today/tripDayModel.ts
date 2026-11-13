/**
 * [Gate TripDayNav] 「旅の当日」の画面の見出し(わくわくする言葉で。値は旅行の日付と今日の日付だけから作る)。
 * - 旅行中: 1日目「いよいよ今日は旅の当日！」・途中「今日は旅の N日目！」・最後の日「今日は旅の最終日！」
 * - 出発の前: 「旅の当日まで あと N日」(前の日は「いよいよ明日は旅の当日！」)
 * - 旅のあと: 「おかえりなさい。旅はおしまい」
 */
export type TripPhase = 'live' | 'before' | 'after' | 'unknown';

export interface TripDayHeading {
  phase: TripPhase;
  eyebrow: string;
  title: string;
  dayNo: number | null;
  total: number | null;
  daysLeft: number | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function tripDayHeading(input: {
  /** 旅行の時刻帯での今日(当日の日程がある時だけ。backend の today_date) */
  todayDate: string | null;
  start: string | null;
  end: string | null;
  /** 端末の今日(当日の日程が無い時に、前か後かを決める) */
  deviceToday: string;
}): TripDayHeading {
  const start = input.start?.slice(0, 10) ?? null;
  const end = (input.end ?? input.start)?.slice(0, 10) ?? null;
  const okStart = start && DAY.test(start) ? start : null;
  const okEnd = end && DAY.test(end) ? end : null;
  const total = okStart && okEnd ? daysBetween(okStart, okEnd) + 1 : null;
  const today = input.todayDate && DAY.test(input.todayDate) ? input.todayDate : null;
  const ref = today ?? input.deviceToday;
  if (today || (okStart && okEnd && okStart <= ref && ref <= okEnd)) {
    const dayNo = okStart ? daysBetween(okStart, ref) + 1 : null;
    const title = dayNo === null || dayNo < 1 ? '今日は旅の当日！'
      : dayNo === 1 ? 'いよいよ今日は旅の当日！'
        : total !== null && dayNo >= total ? '今日は旅の最終日！'
          : `今日は旅の${dayNo}日目！`;
    const day = dayNo !== null && dayNo >= 1 ? ` · DAY ${dayNo}${total ? `/${total}` : ''}` : '';
    return { phase: 'live', eyebrow: `LIVE · 旅の当日${day}`, title, dayNo, total, daysLeft: 0 };
  }
  if (okStart && ref < okStart) {
    const daysLeft = daysBetween(ref, okStart);
    return {
      phase: 'before', eyebrow: 'COUNTDOWN · 旅の当日まで',
      title: daysLeft === 1 ? 'いよいよ明日は旅の当日！' : `旅の当日まで あと${daysLeft}日`,
      dayNo: null, total, daysLeft,
    };
  }
  if (okEnd && ref > okEnd) {
    return { phase: 'after', eyebrow: 'WELCOME HOME', title: 'おかえりなさい。旅はおしまい', dayNo: null, total, daysLeft: null };
  }
  return { phase: 'unknown', eyebrow: 'LIVE · 旅の当日', title: '旅の当日', dayNo: null, total, daysLeft: null };
}
