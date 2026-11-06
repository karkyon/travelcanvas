/** [Gate PlanSpotEdit] 予定の時間の計算(開始・滞在時間・終了・終わる日)。画面の部品(EventTimeImpact)から分けた純粋な関数 */

export interface EndValue { time: string; offset: number }

export const MAX_OFFSET = 2;

export function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

export function hhmm(total: number): string {
  const v = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 開始と終了(日数の差つき)から滞在の分。どちらかが無ければ null */
export function stayMinutes(start: string, end: EndValue): number | null {
  const s = toMinutes(start);
  const e = toMinutes(end.time);
  if (s === null || e === null) return null;
  const d = e + end.offset * 1440 - s;
  return d > 0 ? d : null;
}

/** 開始 + 滞在の分 → 終了(日をまたげば offset)。2 日後を越えたら null */
export function endFromStay(start: string, minutes: number): EndValue | null {
  const s = toMinutes(start);
  if (s === null || minutes <= 0) return null;
  const total = s + minutes;
  const offset = Math.floor(total / 1440);
  return offset > MAX_OFFSET ? null : { time: hhmm(total), offset };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
