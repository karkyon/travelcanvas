/**
 * [Gate G11] 現地の日付・時刻・時刻帯の表示(docs/ux/G11_UIUX全範囲_実装仕様.md §3.2・UIX-M05)。
 *
 * - 1つの瞬間(UTC の ISO 文字列)を、出発地・到着地それぞれの IANA の時刻帯で表す(別々に保存した値を並べない)
 * - 端末の時刻帯は使わない。時刻帯が無効なら null(「時刻帯未確認」と出す)
 * - 時差は UTC との差(UTC+9・UTC−4)で出す(略称は国・言語で揺れるため)
 */
export interface ZonedParts {
  /** YYYY-MM-DD(現地) */
  date: string;
  /** M/D(現地) */
  shortDate: string;
  /** HH:MM(現地) */
  time: string;
  /** UTC+9 など */
  offset: string;
  zone: string;
}

export function isValidZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(iso: string | null | undefined, zone: string | null | undefined): ZonedParts | null {
  if (!iso || !isValidZone(zone)) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZoneName: 'shortOffset',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const offset = String(parts.timeZoneName ?? 'GMT').replace(/^GMT/, 'UTC').replace('-', '−') || 'UTC';
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    shortDate: `${Number(parts.month)}/${Number(parts.day)}`,
    time: `${parts.hour}:${parts.minute}`,
    offset: offset === 'UTC' ? 'UTC±0' : offset,
    zone,
  };
}

/** 到着が出発の何日後か(現地の日付どうしの差。日付変更線を越えると −1 もある) */
export function dayShift(from: ZonedParts, to: ZonedParts): number {
  const a = Date.UTC(Number(from.date.slice(0, 4)), Number(from.date.slice(5, 7)) - 1, Number(from.date.slice(8, 10)));
  const b = Date.UTC(Number(to.date.slice(0, 4)), Number(to.date.slice(5, 7)) - 1, Number(to.date.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function shiftLabel(days: number): string | null {
  if (days === 0) return null;
  if (days === 1) return '翌日着';
  if (days === -1) return '前日着';
  return days > 0 ? `${days}日後着` : `${-days}日前着`;
}

/** 時刻帯の表示名(都市の部分。Asia/Tokyo → Tokyo) */
export function zoneCity(zone: string): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}
