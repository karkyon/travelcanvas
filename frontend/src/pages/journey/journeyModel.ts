/**
 * [Gate P14] 旅の振り返り(FR-054・FR-053)の表示用の整形。
 *
 * - 時刻は日程のタイムゾーン(IANA)で表示・入力する(端末のタイムゾーンに依存しない)
 * - 達成指標: 値が無い(分母0)指標は「—」と表示し、0%と見せない(CA-011)
 */
import type { JourneyMetrics } from '@/services/api';

function parts(date: Date, tz: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** 指定したタイムゾーンでの時刻(HH:MM)。表示用 */
export function localTime(iso: string | null, tz: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const p = parts(d, tz);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/** 日程の日付(YYYY-MM-DD)と時刻(HH:MM)を、日程のタイムゾーンの時刻としてUTCのISO文字列にする */
export function zonedToIso(date: string, time: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m || !t) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  try {
    // タイムゾーンのずれを2回当てて求める(夏時間の切り替わりも近い側に寄せる)
    let ts = guess;
    for (let i = 0; i < 2; i += 1) {
      const p = parts(new Date(ts), tz);
      const shown = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
      ts += guess - shown;
    }
    return new Date(ts).toISOString();
  } catch {
    return null;
  }
}

export function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function diffLabel(min: number | null): string {
  if (min === null) return '';
  if (min === 0) return '予定どおり';
  return min > 0 ? `予定より${min}分遅れ` : `予定より${-min}分早い`;
}

export function metricRows(m: JourneyMetrics): Array<{ label: string; value: string; help: string }> {
  return [
    { label: '計画達成率', value: percent(m.plan_achievement_rate), help: `予定${m.planned_events}件のうち行った${m.visited}件` },
    { label: '訪問達成率', value: percent(m.visit_rate), help: '行った・行かなかったを記録した予定のうち行ったもの' },
    { label: '写真付き訪問率', value: percent(m.photo_visit_rate), help: '行った予定のうち写真の記録があるもの' },
    { label: '記録完成率', value: percent(m.record_completion_rate), help: `未記録の予定${m.unrecorded}件` },
    { label: '滞在時間', value: m.stay_minutes === null ? '—' : `${Math.floor(m.stay_minutes / 60)}時間${m.stay_minutes % 60}分`,
      help: `到着と出発を記録した${m.timed_visits}件の合計` },
    { label: '移動距離', value: m.track_distance_m === null ? '—' : `${(m.track_distance_m / 1000).toFixed(1)}km`,
      help: 'あなたの位置の軌跡(サーバーに保存したもの)から' },
  ];
}
