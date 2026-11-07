/**
 * [Gate SpotInfo] 旅程の「NEXT」(次に向かう予定)の印をどの予定に付けるか。
 * その日の現地の日付が今日の時だけ、今の現地時刻より後に始まる最初の予定に付ける。今日でない日・日付の無い日は付けない。
 */
export function localToday(timeZone: string | undefined, now: Date = new Date()): { date: string; time: string } {
  let tz = timeZone || undefined;
  try {
    if (tz) new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = undefined; // 知らない時刻帯は端末の時刻帯で
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function nextEventIndexFor(
  events: ReadonlyArray<{ start_time?: string }>, dayDate: string | undefined, timeZone: string | undefined, now: Date = new Date(),
): number {
  if (!dayDate) return -1;
  const today = localToday(timeZone, now);
  if (dayDate.slice(0, 10) !== today.date) return -1;
  return events.findIndex((e) => (e.start_time || '') > today.time);
}
