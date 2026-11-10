/**
 * [Gate G11] 旅程の画面の表示の決まり(営業時間の帯・到着の移動区間・時差・全日程のチャート)。画面から切り離した計算だけ。
 * docs/ux/G11_UIUX全範囲_実装仕様.md §3.2・§4、UIX-M04〜M07。
 */
import type { EventHoursCheck } from '@/services/api/types/g11planner';
import type { TravelSegment } from '@/services/api/types/segments';
import type { DaySchedule } from '@/types';
import { durationLabel, transportMode, transportText } from '@/utils/transportModes';
import { dayShift, shiftLabel, zoneCity, zonedParts, type ZonedParts } from '@/utils/zonedTime';

export type Tone = 'good' | 'warn' | 'bad' | 'muted';

export interface HoursBadge {
  symbol: string;
  text: string;
  tone: Tone;
  /** 出典と確認の日(あれば) */
  sourceText: string | null;
}

function sourceText(h: EventHoursCheck): string | null {
  const src = h.source;
  if (!src) return null;
  const label = typeof src.label === 'string' ? src.label : typeof src.provider === 'string' ? src.provider : null;
  const at = typeof src.retrieved_at === 'string' ? src.retrieved_at.slice(0, 10).replace(/-/g, '/') : null;
  const parts = [label ? `出典: ${label}` : null, at ? `確認 ${at}` : null].filter(Boolean);
  return parts.length ? parts.join('・') : null;
}

/** 営業時間の照合の帯(記号と文字。色だけで伝えない) */
export function hoursBadge(h: EventHoursCheck | null | undefined, pending = false): HoursBadge | null {
  if (pending) return { symbol: '…', text: '営業時間を確認中', tone: 'muted', sourceText: null };
  if (!h) return null;
  const src = sourceText(h);
  const est = h.estimated ? '(既定の滞在の見積もり)' : '';
  switch (h.status) {
    case 'ok':
      return { symbol: '✓', text: `営業時間内 · ${h.window_label ?? ''}`.trim(), tone: 'good', sourceText: src };
    case 'near_close': {
      const what = h.last_entry ? '最終入場' : '閉店';
      return { symbol: '⚠', text: `${what}まで${h.minutes_to_close ?? 0}分 · ${h.window_label ?? ''}`, tone: 'warn', sourceText: src };
    }
    case 'last_entry':
      return { symbol: '⚠', text: `最終入場 ${h.last_entry} を過ぎて着く予定`, tone: 'bad', sourceText: src };
    case 'last_order':
      return { symbol: '⚠', text: `ラストオーダー ${h.last_order} を過ぎて着く予定`, tone: 'warn', sourceText: src };
    case 'closes_during':
      return { symbol: '⚠', text: `滞在の途中で閉まります(${h.closes_at} 閉店)${est}`, tone: 'warn', sourceText: src };
    case 'closed': {
      const why = h.reason === 'closed_special' ? 'この日は臨時休業'
        : h.reason === 'closed_day' ? 'この曜日は休業日'
          : h.reason === 'before_open' ? `開く前に着く予定(${h.windows.join('・')})`
            : `閉まった後に着く予定(${h.windows.join('・')})`;
      return { symbol: '✕', text: why, tone: 'bad', sourceText: src };
    }
    default: {
      const why = h.reason === 'stale_source' ? '営業時間の情報が古い・再確認してください'
        // [Gate PlanUX] 時刻を決めていない予定は、営業時間の照合を出さない(時刻・営業時間は必須ではない)
        : h.reason === 'no_time' || h.reason === 'no_place' ? null
            : '営業時間未確認';
      return why ? { symbol: '?', text: why, tone: 'muted', sourceText: src } : null;
    }
  }
}

export interface ArrivalLeg {
  /** [Gate G11 段階9] アイコン(TransportIcon)のための mode */
  mode: string | null;
  modeLabel: string;
  text: string;
  isEstimate: boolean;
  status: TravelSegment['status'];
  /** 時差をまたぐ時だけ(出発・到着の現地の時刻) */
  crossZone: { from: ZonedParts; to: ZonedParts; shift: string | null; text: string } | null;
  /** 時刻帯が無効で現地の時刻を出せない */
  zoneUnknown: boolean;
  /** [Gate TravelEstimate] 距離(「12.5km」)・内訳(「下道 25分 / 高速利用 19分」)・計算のもと(説明) */
  distance?: string | null;
  detail?: string | null;
  basis?: string | null;
}

/** [Gate TravelEstimate] 距離の文字(1km 未満は m) */
export function kmText(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km)) return null;
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10}m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)}km`;
}

/** [Gate TravelEstimate] 区間の見積もりの距離・内訳・計算のもと */
export function estimateDetail(seg: Pick<TravelSegment, 'distance_km' | 'estimate_variants' | 'estimate_basis' | 'mode'>): {
  distance: string | null; detail: string | null; basis: string | null } {
  const vs = seg.estimate_variants ?? [];
  const modeLabel = transportMode(seg.mode).label;
  let detail: string | null = null;
  if (vs.length > 1) detail = vs.map((v) => `${v.label} ${durationLabel(v.duration_minutes)}`).join(' / ');
  else if (vs.length === 1 && vs[0]!.label !== modeLabel && vs[0]!.label !== '徒歩') detail = vs[0]!.label;
  const notes = vs.map((v) => v.note).filter((n): n is string => Boolean(n));
  const basis = [seg.estimate_basis, ...notes].filter(Boolean).join('。') || null;
  return { distance: kmText(seg.distance_km), detail, basis };
}

/** その予定へ着く移動区間(取消でないもの。複数あれば最後に作られたもの) */
export function arrivalSegment(eventId: string, segments: TravelSegment[]): TravelSegment | null {
  const hits = segments.filter((s) => s.to_event_id === eventId && s.status !== 'cancelled');
  return hits.length ? hits[hits.length - 1]! : null;
}

/** 予定 → 題名(区間の行で、別の日の出発の予定の名前を出す) */
export function titleOfEvent(days: DaySchedule[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of days) for (const e of d.events) out[e.id] = e.title;
  return out;
}

export function zoneOfEvent(days: DaySchedule[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const d of days) for (const e of d.events) out[e.id] = d.timezone_id;
  return out;
}

export function arrivalLeg(seg: TravelSegment | null, zones: Record<string, string | undefined>,
  toZone: string | undefined): ArrivalLeg | null {
  if (!seg) return null;
  const mode = transportMode(seg.mode);
  const fromZone = seg.from_event_id ? zones[seg.from_event_id] : toZone;
  let crossZone: ArrivalLeg['crossZone'] = null;
  let zoneUnknown = false;
  if (fromZone && toZone && fromZone !== toZone && (seg.planned_departure_at || seg.planned_arrival_at)) {
    const depIso = seg.planned_departure_at;
    const arrIso = seg.planned_arrival_at
      ?? (depIso && seg.duration_minutes != null
        ? new Date(new Date(depIso).getTime() + seg.duration_minutes * 60_000).toISOString() : null);
    const from = zonedParts(depIso, fromZone);
    const to = zonedParts(arrIso, toZone);
    if (from && to) {
      const shift = shiftLabel(dayShift(from, to));
      crossZone = {
        from, to, shift,
        text: `${from.shortDate} ${from.time} ${zoneCity(fromZone)}(${from.offset})→ ${to.shortDate} ${to.time} `
          + `${zoneCity(toZone)}(${to.offset})${shift ? `・${shift}` : ''}`,
      };
    } else {
      zoneUnknown = true;
    }
  }
  return {
    mode: mode.mode,
    modeLabel: mode.label,
    text: transportText(seg.mode, seg.duration_minutes),
    isEstimate: seg.is_estimate,
    status: seg.status,
    crossZone,
    zoneUnknown,
    ...estimateDetail(seg),
  };
}

// ===================================================================== 移動の区間の行・並べ替えの影響

/**
 * 区間の出発の予定が、今の並びの直前の予定と違う(並べ替えで合わなくなった)か。
 * 日の最初の予定は、出発の予定が同じ日の中にある時だけ合わない(前の日の最後から着く区間は合っている)。
 * 出発が場所だけの区間は判定しない。
 */
function segmentMismatch(events: ReadonlyArray<{ id: string }>, index: number, seg: TravelSegment): boolean {
  const from = seg.from_event_id;
  if (!from) return false;
  if (index > 0) return events[index - 1]!.id !== from;
  return events.some((e) => e.id === from);
}

export interface SegmentRow {
  leg: ArrivalLeg;
  /** 出発の予定の名前(旅行の中に無ければ null) */
  fromTitle: string | null;
  mismatch: boolean;
}

/** [Gate G11] 予定の前に置く移動の区間の行(タイムラインの独立した行。UIX-M03) */
export function segmentRow(events: ReadonlyArray<{ id: string }>, index: number, segments: TravelSegment[],
  zones: Record<string, string | undefined>, toZone: string | undefined, titles: Record<string, string>): SegmentRow | null {
  const ev = events[index];
  if (!ev) return null;
  const seg = arrivalSegment(ev.id, segments);
  const leg = arrivalLeg(seg, zones, toZone);
  if (!seg || !leg) return null;
  return {
    leg,
    fromTitle: seg.from_event_id ? titles[seg.from_event_id] ?? null : null,
    mismatch: segmentMismatch(events, index, seg),
  };
}

export type ImpactHoursState = 'pending' | 'no_place' | 'no_baseline' | 'unchanged' | 'changed';

export interface ReorderImpactModel {
  moves: Array<{ id: string; title: string; from: number; to: number }>;
  hours: { state: ImpactHoursState; changes: Array<{ id: string; title: string; before: string; after: string }> };
  /** 着く区間が今の並びと合わない予定の名前 */
  mismatches: string[];
  /** この日の予定へ着く区間の数 */
  segmentCount: number;
}

function hoursLabel(h: EventHoursCheck | undefined): string {
  const b = hoursBadge(h);
  return b ? `${b.symbol} ${b.text}` : '照合なし';
}

/**
 * [Gate G11] 並べ替えの影響(UIX-M03): 動かす前の並び・営業時間の判定と、今の並び・判定の差。
 * 開始・終了の時刻は並べ替えで変えないので、営業時間の判定は時刻が同じなら変わらない(変わった時だけ並べる)。
 */
export function reorderImpact(baseline: string[], beforeHours: Record<string, EventHoursCheck> | null,
  events: ReadonlyArray<{ id: string; title: string; place_id?: string }>, afterHours: Record<string, EventHoursCheck> | null,
  pending: boolean, segments: TravelSegment[]): ReorderImpactModel {
  const moves = events.map((e, to) => ({ id: e.id, title: e.title, from: baseline.indexOf(e.id), to }))
    .filter((m) => m.from !== -1 && m.from !== m.to);
  let state: ImpactHoursState;
  const changes: ReorderImpactModel['hours']['changes'] = [];
  if (!events.some((e) => e.place_id)) state = 'no_place';
  else if (pending || !afterHours) state = 'pending';
  else if (!beforeHours) state = 'no_baseline';
  else {
    for (const e of events) {
      if (!e.place_id) continue;
      const b = beforeHours[e.id];
      const a = afterHours[e.id];
      if (`${b?.status}|${b?.reason}` !== `${a?.status}|${a?.reason}`) {
        changes.push({ id: e.id, title: e.title, before: hoursLabel(b), after: hoursLabel(a) });
      }
    }
    state = changes.length ? 'changed' : 'unchanged';
  }
  const mismatches: string[] = [];
  let segmentCount = 0;
  events.forEach((e, i) => {
    const seg = arrivalSegment(e.id, segments);
    if (!seg) return;
    segmentCount += 1;
    if (segmentMismatch(events, i, seg)) mismatches.push(e.title);
  });
  return { moves, hours: { state, changes }, mismatches, segmentCount };
}

/** 並べ替えを止める理由(確定の予定は動かさない。確定の予定と入れ替わる移動もしない)。動かせる時は null */
export function moveBlockedReason(events: ReadonlyArray<{ title: string; locked?: boolean }>, index: number,
  delta: -1 | 1): string | null {
  const ev = events[index];
  const target = events[index + delta];
  if (!ev || !target) return null;
  if (ev.locked) return `「${ev.title}」は確定の予定のため動かせません`;
  if (target.locked) return `確定の予定「${target.title}」と入れ替わるため動かせません`;
  return null;
}

// ===================================================================== 全日程のチャート

function toMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : null;
}

export interface ChartEvent {
  id: string;
  title: string;
  start: number | null;
  end: number | null;
  /** 終わりが分からない時は表示のための目安(60分)で、文字では「終了未設定」 */
  endKnown: boolean;
  /** [Gate TimelineDrag] 種類(帯の色)と、ドラッグで時刻を変える時の長さ(分。終わりが分からなければ null) */
  category?: string;
  duration?: number | null;
  modeText: string | null;
  mode: string | null;
}

export interface ChartDay {
  index: number;
  id: string;
  date: string;
  timezone: string | null;
  events: ChartEvent[];
  untimed: ChartEvent[];
  first: string | null;
  last: string | null;
  travelMinutes: number;
  freeMinutes: number | null;
  lockedCount: number;
  /** [Gate TravelEstimate] 移動の帯(到着する予定の前)・空き時間(15 分以上)・手段ごとの合計 */
  travels?: ChartTravel[];
  gaps?: Array<[number, number]>;
  byMode?: Array<{ mode: string; label: string; minutes: number; km: number | null }>;
}

export interface ChartTravel { eventId: string; start: number; end: number; mode: string; minutes: number; km: number | null }

/** 空き時間として示す最短(分) */
export const GAP_MIN = 15;

export interface ChartModel {
  days: ChartDay[];
  /** 全ての日で同じ時刻の物差し(分) */
  scaleStart: number;
  scaleEnd: number;
}

const DEFAULT_STAY = 60;

function hm(v: number | null): string | null {
  if (v === null) return null;
  const h = Math.floor(v / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 区間の合計(重ならない区間の和)。空き時間・移動の合計で二重に数えない */
export function unionMinutes(ranges: Array<[number, number]>): number {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curA: number | null = null;
  let curB = 0;
  for (const [a, b] of sorted) {
    if (curA === null || a > curB) {
      if (curA !== null) total += curB - curA;
      curA = a;
      curB = b;
    } else {
      curB = Math.max(curB, b);
    }
  }
  if (curA !== null) total += curB - curA;
  return total;
}

/** [Gate TimelineDrag] 時刻の重なる予定を横に並べる(重なる予定の集まりごとに列を分ける。以前は上に重なって隠れていた) */
export function overlapLanes(items: { id: string; start: number; end: number }[]): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  let group: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const flush = () => { for (const g of group) out.set(g.id, { lane: g.lane, of: laneEnds.length }); group = []; laneEnds = []; };
  for (const it of sorted) {
    if (it.start >= groupEnd) { flush(); groupEnd = -Infinity; }
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end); } else laneEnds[lane] = it.end;
    group.push({ id: it.id, lane });
    groupEnd = Math.max(groupEnd, it.end);
  }
  flush();
  return out;
}

/** [Gate TravelEstimate] 予定と移動のあいだの空き(GAP_MIN 分以上。最初の予定より前・最後の予定より後は数えない) */
export function freeGaps(intervals: Array<[number, number]>): Array<[number, number]> {
  const xs = intervals.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  let end: number | null = null;
  for (const [a, b] of xs) {
    if (end !== null && a - end >= GAP_MIN) out.push([end, a]);
    end = end === null ? b : Math.max(end, b);
  }
  return out;
}

/** 全日程の物差しにいつも含める時間帯(分) */
export const CHART_DAY_START = 6 * 60;
export const CHART_DAY_END = 22 * 60;

export function buildChart(days: DaySchedule[], segments: TravelSegment[], locked: Set<string> = new Set()): ChartModel {
  let scaleStart = 24 * 60;
  let scaleEnd = 0;
  const out: ChartDay[] = days.map((d, index) => {
    const timed: ChartEvent[] = [];
    const untimed: ChartEvent[] = [];
    const busy: Array<[number, number]> = [];
    const travel: Array<[number, number]> = [];
    const travels: ChartTravel[] = [];
    for (const e of d.events) {
      const seg = arrivalSegment(e.id, segments);
      const start = toMinutes(e.start_time);
      let end = toMinutes(e.end_time);
      if (start !== null && end !== null && (e.end_day_offset ?? 0) > 0) end = 24 * 60;
      const endKnown = end !== null && start !== null && end >= start;
      const item: ChartEvent = {
        id: e.id, title: e.title, start, end: endKnown ? end : start !== null ? Math.min(24 * 60, start + DEFAULT_STAY) : null,
        endKnown, modeText: seg ? transportText(seg.mode, seg.duration_minutes) : null, mode: seg ? seg.mode : null,
        category: e.category ?? 'other',
        duration: start !== null && end !== null && end >= start && !(e.end_day_offset ?? 0) ? end - start : null,
      };
      if (start === null) {
        untimed.push(item);
        continue;
      }
      timed.push(item);
      busy.push([start, item.end ?? start]);
      if (seg?.duration_minutes) {
        travel.push([Math.max(0, start - seg.duration_minutes), start]);
        travels.push({ eventId: e.id, start: Math.max(0, start - seg.duration_minutes), end: start, mode: seg.mode,
          minutes: seg.duration_minutes, km: seg.distance_km ?? null });
      }
      scaleStart = Math.min(scaleStart, start);
      scaleEnd = Math.max(scaleEnd, item.end ?? start);
    }
    timed.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    const first = timed[0]?.start ?? null;
    const lastEnd = timed.length ? Math.max(...timed.map((t) => t.end ?? t.start ?? 0)) : null;
    const travelMinutes = unionMinutes(travel);
    const occupied = unionMinutes([...busy, ...travel]);
    const span = first !== null && lastEnd !== null ? lastEnd - Math.min(first, ...travel.map(([a]) => a)) : null;
    const gaps = freeGaps([...busy, ...travel]);
    const modes = new Map<string, { minutes: number; km: number | null }>();
    for (const t of travels) {
      const label = transportMode(t.mode).label;
      const cur = modes.get(label) ?? { minutes: 0, km: 0 };
      modes.set(label, { minutes: cur.minutes + t.minutes, km: cur.km === null || t.km === null ? null : cur.km + t.km });
    }
    const byMode = [...modes.entries()].map(([label, v]) => ({ mode: label, label, minutes: v.minutes, km: v.km }));
    return {
      index, id: d.id, date: d.date ?? '', timezone: d.timezone_id ?? null, events: timed, untimed,
      first: hm(first), last: hm(lastEnd), travelMinutes, freeMinutes: span !== null ? Math.max(0, span - occupied) : null,
      lockedCount: d.events.filter((e) => locked.has(e.id)).length,
      travels, gaps, byMode,
    };
  });
  // [Gate TimelineDrag] 物差しはいつも 6:00〜22:00 を含める(予定の時刻だけに合わせると、1 件ドラッグした直後に
  // 物差しが 1〜2 時間に縮み、ほかの予定を落とす時刻が無くなっていた)。それより早い・遅い予定があれば広げる
  scaleStart = Math.min(scaleStart, CHART_DAY_START);
  scaleEnd = Math.max(scaleEnd, CHART_DAY_END);
  scaleStart = Math.floor(scaleStart / 60) * 60;
  scaleEnd = Math.min(24 * 60, Math.ceil(scaleEnd / 60) * 60);
  return { days: out, scaleStart, scaleEnd };
}


/**
 * [Gate PlanSpotEdit] 「スポットだけを入れ替える」並べ替えの見え方(保存する前の案と、サーバーの reorder の keep_slots と同じ規則)。
 * 位置 i の予定は、元の位置 i の予定の時刻(開始・終了・終わる日)を受け継ぐ。移動区間の端(予定)も同じ位置の予定へ付け替える
 * (移動手段・所要時間はそのまま)。saved は今の並び、order は案の並び(同じ予定の集まり)。
 */
export function keepSlots<E extends { id: string; start_time?: string; end_time?: string; end_day_offset?: number }>(
  saved: ReadonlyArray<E>, order: ReadonlyArray<string>, segments: TravelSegment[],
): { events: E[]; segments: TravelSegment[] } {
  const byId = new Map(saved.map((e) => [e.id, e] as const));
  if (order.length !== saved.length || order.some((id) => !byId.has(id))) return { events: [...saved], segments };
  const events = order.map((id, i) => {
    const slot = saved[i]!;
    return { ...byId.get(id)!, start_time: slot.start_time, end_time: slot.end_time, end_day_offset: slot.end_day_offset };
  });
  const moved = new Map<string, string>();
  saved.forEach((e, i) => { if (order[i] !== e.id) moved.set(e.id, order[i]!); });
  if (moved.size === 0) return { events, segments };
  const remap = (id: string | null) => (id && moved.has(id) ? moved.get(id)! : id);
  return {
    events,
    segments: segments.map((sg) => (moved.has(sg.from_event_id ?? '') || moved.has(sg.to_event_id ?? '')
      ? { ...sg, from_event_id: remap(sg.from_event_id), to_event_id: remap(sg.to_event_id) } : sg)),
  };
}

/** [Gate EventMoveDay] 別の日へ移す時の並びの位置。時刻があれば時刻の順の位置、無ければ最後 */
export function insertIndexByTime(events: ReadonlyArray<{ id: string; start_time?: string | null }>, startTime?: string | null,
  skipId?: string): number {
  const list = events.filter((e) => e.id !== skipId);
  if (!startTime) return list.length;
  const at = list.findIndex((e) => !!e.start_time && e.start_time > startTime);
  return at < 0 ? list.length : at;
}

/** [Gate TimelineDrag] 落とした位置の時刻(15分単位に丸め、0:00〜23:45 に収める) */
export const SNAP_MINUTES = 15;
export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  return Math.min(24 * 60 - step, Math.max(0, Math.round(minutes / step) * step));
}
export function minutesToHm(v: number): string {
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
/** 開始を start へ変える時の新しい終わり(長さを保つ。日をまたぐなら 23:59 で止める。長さが分からなければ null) */
export function shiftedEnd(start: number, duration: number | null | undefined): string | null {
  if (duration === null || duration === undefined) return null;
  return minutesToHm(Math.min(24 * 60 - 1, start + duration));
}
