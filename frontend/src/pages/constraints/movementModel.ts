/**
 * [Gate G7] MOVE-03 移動・滞在の既定の入力と、日ごとの疲れの目安の表示(MovementSettingsPanel・FeasibilityPanel)。
 */
import type { DayMetric, MovementPace, MovementSettingsValue } from '@/services/api/types/g7';

export interface MovementDraft {
  enabled: boolean;
  pace: MovementPace;
  withChildren: boolean;
  withSeniors: boolean;
  size: string;
  stays: Record<string, string>;
  breakMinutes: string;
  maxContinuous: string;
  maxDayHours: string;
  margin: string;
}

const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function draftFrom(v: MovementSettingsValue): MovementDraft {
  const stays: Record<string, string> = {};
  for (const [k, n] of Object.entries(v.stay_minutes)) stays[k] = s(n);
  return {
    enabled: v.enabled, pace: v.pace, withChildren: v.party.with_children, withSeniors: v.party.with_seniors,
    size: s(v.party.size), stays, breakMinutes: s(v.break_minutes), maxContinuous: s(v.max_continuous_minutes),
    maxDayHours: v.max_day_minutes === null ? '' : String(Math.round(v.max_day_minutes / 60)),
    margin: s(v.last_transport_margin_minutes),
  };
}

function intOrNull(text: string, label: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n)) throw new Error(`${label}は整数で入力してください`);
  return n;
}

/** 入力 → 送る設定(範囲の検査は backend が行う。ここでは数字かどうかだけ) */
export function draftToSettings(d: MovementDraft): Partial<MovementSettingsValue> {
  const stays: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(d.stays)) {
    if (k === 'accommodation' || k === 'transportation') continue;
    stays[k] = intOrNull(v, '既定の滞在');
  }
  const brk = intOrNull(d.breakMinutes, '休憩とみなす空き');
  const margin = intOrNull(d.margin, '最終の便の前の余裕');
  const hours = intOrNull(d.maxDayHours, '1日の活動の上限');
  return {
    enabled: d.enabled, pace: d.pace,
    party: { with_children: d.withChildren, with_seniors: d.withSeniors, size: intOrNull(d.size, '人数') },
    stay_minutes: stays,
    ...(brk !== null ? { break_minutes: brk } : {}),
    max_continuous_minutes: intOrNull(d.maxContinuous, '休憩なしで続けてよい時間'),
    max_day_minutes: hours === null ? null : hours * 60,
    ...(margin !== null ? { last_transport_margin_minutes: margin } : {}),
  };
}

export const LEVEL_LABEL: Record<DayMetric['level'], string> = { light: 'ゆとり', normal: 'ふつう', heavy: '疲れやすい' };

export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}時間${m ? `${m}分` : ''}` : `${m}分`;
}

export function dayMetricText(m: DayMetric): string {
  const parts = [`活動${hm(m.active_minutes)}`];
  if (m.walking_minutes) parts.push(`徒歩${hm(m.walking_minutes)}`);
  if (m.ride_minutes) parts.push(`乗り物${hm(m.ride_minutes)}`);
  parts.push(`休憩なし最長${hm(m.longest_continuous_minutes)}`);
  return `${parts.join('・')}(疲れの目安${m.fatigue_percent}%・${LEVEL_LABEL[m.level]})`
    + (m.estimated ? '・見積もりを含む' : '') + (m.incomplete ? '・終わりが分からない予定あり' : '');
}
