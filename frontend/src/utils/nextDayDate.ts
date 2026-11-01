/**
 * 日を追加する時の日付(YYYY-MM-DD)。最後の日(最も遅い日付)の翌日。日が無い時・日付が読めない時は端末の今日。
 * 日付の計算は暦の日だけで行う(UTC の時刻へ変換しないため、時差で日付がずれない)。
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function nextDayDate(dates: ReadonlyArray<string | null | undefined>, now: Date = new Date()): string {
  const valid = dates.filter((d): d is string => typeof d === 'string' && ISO.test(d)).sort();
  const last = valid[valid.length - 1];
  if (!last) return fmt(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const [, y, m, d] = ISO.exec(last)!;
  const next = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 1));
  return fmt(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}
