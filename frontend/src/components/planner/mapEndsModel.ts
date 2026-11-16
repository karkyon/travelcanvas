/**
 * [Gate HomeRoute] 旅程の地図の「日の最初と最後」(前の夜の宿・今夜の宿・自宅)。
 *
 * - 前の夜の宿から: 前の日までの宿の予定の位置(座標がある時だけ。架空の位置を作らない)
 * - 今夜の宿: 続けて泊まる想定(連泊)の時だけ。宿の予定がその日にあれば、その予定が地図に出ているので足さない
 * - 出発・帰着: 場所が空か「自宅」を含む時だけ自宅の候補にする(位置は本人の自宅の場所から。PlanMap で決める)
 */
import type { DaySchedule } from '@/types';
import { dayAnchors, type DayAnchor, type JourneyEnds } from './journeyModel';

export type MapEndKind = 'lodging' | 'home';
export interface MapEnd {
  role: 'start' | 'end';
  kind: MapEndKind;
  label: string;
  /** 宿の位置。自宅は null(本人の自宅の場所を PlanMap で使う) */
  pos: [number, number] | null;
  /** 宿の予定の ID(移動区間の手段を探す) */
  eventId: string | null;
  /** 出発・帰着の行に入れた移動手段(自宅の時) */
  mode: string | null;
}
export interface MapEnds { start: MapEnd | null; end: MapEnd | null }

export const LODGING_COLOR = '#7c3aed';
export const HOME_COLOR = '#1d4ed8';

/** 出発・帰着の場所が自宅を指しているか(空のままも自宅の候補) */
export function anchorWantsHome(a: DayAnchor | null): boolean {
  if (!a || (a.kind !== 'departure' && a.kind !== 'arrival')) return false;
  return !a.place || a.place.includes('自宅');
}

type PlanLike = JourneyEnds & { days: Pick<DaySchedule, 'events'>[] };

function lodgingPos(plan: PlanLike, eventId: string | null | undefined): [number, number] | null {
  if (!eventId) return null;
  for (const d of plan.days) {
    const e = d.events.find((x) => x.id === eventId);
    if (e) return typeof e.latitude === 'number' && typeof e.longitude === 'number' ? [e.latitude, e.longitude] : null;
  }
  return null;
}

function fromAnchor(plan: PlanLike, a: DayAnchor | null, role: 'start' | 'end'): MapEnd | null {
  if (!a) return null;
  if (anchorWantsHome(a)) {
    return { role, kind: 'home', label: role === 'start' ? '自宅から出発' : '自宅へ帰る', pos: null, eventId: null, mode: a.mode ?? null };
  }
  if (a.kind === 'lodging-from' || (a.kind === 'lodging-to' && a.continued)) {
    const pos = lodgingPos(plan, a.eventId);
    if (!pos) return null;
    const name = a.place ?? '宿';
    return { role, kind: 'lodging', label: role === 'start' ? `前の夜の宿: ${name}` : `今夜の宿: ${name}`, pos, eventId: a.eventId ?? null, mode: null };
  }
  return null;
}

export function buildMapEnds(plan: PlanLike, index: number): MapEnds {
  const { start, end } = dayAnchors(plan, index);
  return { start: fromAnchor(plan, start, 'start'), end: fromAnchor(plan, end, 'end') };
}

/** 地図の外にある点の方向(8方位の矢印)と直線の距離 */
export function directionArrow(from: [number, number], to: [number, number]): string {
  const dy = to[0] - from[0];
  const dx = (to[1] - from[1]) * Math.cos((from[0] * Math.PI) / 180);
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // 東=0, 北=90
  const arrows = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
  return arrows[((Math.round(deg / 45) % 8) + 8) % 8]!;
}
