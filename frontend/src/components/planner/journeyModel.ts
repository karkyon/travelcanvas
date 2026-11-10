/**
 * [Gate JourneyEnds] 旅程の日の最初と最後に出す「つなぎ」の行。
 *
 * - 1 日目の最初: 出発(旅行の基本情報で「出発・到着を出す」を選んだ時。場所・時刻は任意)
 * - 最終日の最後: 到着(同上)
 * - 2 日目以降の最初: 前の夜の宿から出発
 * - 最終日以外の最後: 今夜の宿。宿の予定(種類「宿」)が無い日は、前の宿に続けて泊まる想定(連泊)として出す。
 *   それより前にも宿が無ければ「今夜の宿が未設定」
 * 宿はその日の最後の「宿」の予定(チェックインの予定)で決める。
 */
import type { DaySchedule } from '@/types';

export type AnchorKind = 'departure' | 'arrival' | 'lodging-from' | 'lodging-to' | 'lodging-missing';
export interface DayAnchor {
  kind: AnchorKind;
  /** 場所の名前(宿の名前・出発地)。分からなければ null */
  place: string | null;
  /** "HH:MM"(出発・到着だけ) */
  time: string | null;
  /** 宿の予定が無い日に、前の宿に続けて泊まる想定で出している */
  continued: boolean;
}
export interface JourneyEnds {
  journey_enabled?: boolean | null;
  journey_start_place?: string | null;
  journey_start_time?: string | null;
  journey_end_place?: string | null;
  journey_end_time?: string | null;
}

type Lodging = { place: string; continued: boolean } | null;

/** 各日の夜の宿(連泊の想定を含む) */
export function nightlyLodging(days: Pick<DaySchedule, 'events'>[]): Lodging[] {
  let last: string | null = null;
  return days.map((d) => {
    const own = [...d.events].reverse().find((e) => e.category === 'accommodation');
    if (own) {
      last = (own.location_name || own.title || '').trim() || '宿';
      return { place: last, continued: false };
    }
    return last ? { place: last, continued: true } : null;
  });
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** その日の最初と最後の行(無ければ null) */
export function dayAnchors(plan: JourneyEnds & { days: Pick<DaySchedule, 'events'>[] }, index: number): { start: DayAnchor | null; end: DayAnchor | null } {
  const n = plan.days.length;
  if (index < 0 || index >= n) return { start: null, end: null };
  const nights = nightlyLodging(plan.days);
  const on = Boolean(plan.journey_enabled);
  let start: DayAnchor | null = null;
  let end: DayAnchor | null = null;
  if (index === 0) {
    if (on) start = { kind: 'departure', place: clean(plan.journey_start_place), time: hhmm(plan.journey_start_time), continued: false };
  } else {
    const prev = nights[index - 1];
    if (prev) start = { kind: 'lodging-from', place: prev.place, time: null, continued: prev.continued };
  }
  if (index === n - 1) {
    if (on) end = { kind: 'arrival', place: clean(plan.journey_end_place), time: hhmm(plan.journey_end_time), continued: false };
  } else {
    const tonight = nights[index];
    end = tonight
      ? { kind: 'lodging-to', place: tonight.place, time: null, continued: tonight.continued }
      : { kind: 'lodging-missing', place: null, time: null, continued: false };
  }
  return { start, end };
}

/** 行の見出しと本文(読み上げにも使う) */
export function anchorText(a: DayAnchor): { label: string; body: string } {
  switch (a.kind) {
    case 'departure':
      return { label: '出発', body: [a.place ?? '出発地(未設定)', a.time].filter(Boolean).join(' · ') };
    case 'arrival':
      return { label: '到着', body: [a.place ?? '到着地(未設定)', a.time].filter(Boolean).join(' · ') };
    case 'lodging-from':
      return { label: '前の夜の宿から', body: `${a.place ?? '宿'}${a.continued ? '(連泊の想定)' : ''}` };
    case 'lodging-to':
      return { label: '今夜の宿', body: `${a.place ?? '宿'}${a.continued ? '(続けて泊まる想定)' : ''}` };
    default:
      return { label: '今夜の宿', body: '未設定' };
  }
}
