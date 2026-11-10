/**
 * [Gate EventArea] エリアの中の予定(おかげ横丁の中の赤福・ダンデライオン)の表示と並べ替えの計算。
 *
 * - エリアは種類 area の予定。中の予定は parent_event_id にエリアの ID を持ち、サーバーがいつもエリアのすぐ後ろに並べる
 * - 旅程: エリアを大きな枠にし、中の予定を字下げで続ける。枠の見出しに「エリア内の滞在・中の予定・空き」
 * - エリアと中の予定、中の予定どうしの間は「エリアの中の移動」(移動の区間として数えない)
 * - 並べ替え: 中の予定はエリアの中でだけ入れ替える。エリアを動かす時・エリアを越える時は、まとまりごと動かし、
 *   時刻は予定に付いたまま(keepSlots=false。位置の時刻を受け継ぐと、エリアの滞在の時刻がほかの予定に移るため)
 */
import type { ScheduleItem } from '@/types';

export const AREA = 'area';

type Ev = Pick<ScheduleItem, 'id' | 'title' | 'category' | 'parent_event_id' | 'start_time' | 'end_time' | 'end_day_offset' | 'locked'>;

export interface AreaRole {
  role: 'area' | 'member' | 'none';
  /** エリアの ID(エリア自身・中の予定) */
  areaId: string | null;
  /** 枠の最後(中の予定の最後。中が無いエリアはエリア自身) */
  last: boolean;
}

export const isArea = (e: Pick<Ev, 'category'> | undefined): boolean => e?.category === AREA;

/** 各予定の役割。中の予定はエリアのすぐ後ろに続いている時だけ枠に入れる(離れていれば普通の予定として出す) */
export function areaRoles(events: ReadonlyArray<Ev>): Map<string, AreaRole> {
  const out = new Map<string, AreaRole>();
  let current: string | null = null;
  events.forEach((e, i) => {
    if (isArea(e)) {
      current = e.id;
      out.set(e.id, { role: 'area', areaId: e.id, last: events[i + 1]?.parent_event_id !== e.id });
      return;
    }
    if (current && e.parent_event_id === current) {
      out.set(e.id, { role: 'member', areaId: current, last: events[i + 1]?.parent_event_id !== current });
      return;
    }
    current = null;
    out.set(e.id, { role: 'none', areaId: null, last: false });
  });
  return out;
}

/** 続く 2 つの予定がエリアの中(エリア → 中の予定・中の予定 → 中の予定) */
export function isInnerPair(prev: Ev | undefined, cur: Ev | undefined): boolean {
  const pid = cur?.parent_event_id;
  return Boolean(prev && pid && (prev.id === pid || prev.parent_event_id === pid));
}

function minutesOf(hhmm: string | undefined): number | null {
  const m = hhmm ? /^(\d{1,2}):(\d{2})/.exec(hhmm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function span(e: Pick<Ev, 'start_time' | 'end_time' | 'end_day_offset'>): number | null {
  const a = minutesOf(e.start_time);
  const b = minutesOf(e.end_time);
  if (a === null || b === null) return null;
  const d = b + (e.end_day_offset ?? 0) * 24 * 60 - a;
  return d >= 0 ? d : null;
}

export function durationText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}時間${m}分` : h ? `${h}時間` : `${m}分`;
}

export interface AreaSummary { stay: number | null; count: number; used: number; free: number | null; text: string }

/**
 * エリアの見出しの数: 滞在(エリアの開始〜終了)・中の予定の数・空き(滞在 − 中の予定の時間の合計。中の移動は数えない)。
 * 分からない数は文に出さない。
 */
export function areaSummary(area: Ev, members: ReadonlyArray<Ev>): AreaSummary {
  const stay = span(area);
  const used = members.reduce((acc, m) => acc + (span(m) ?? 0), 0);
  const free = stay !== null ? Math.max(0, stay - used) : null;
  const parts = [
    stay !== null ? `エリア内の滞在 ${durationText(stay)}` : 'エリア内の滞在 時刻未設定',
    `中の予定 ${members.length}件`,
    free !== null && members.length > 0 ? `空き ${durationText(free)}` : null,
  ].filter(Boolean);
  return { stay, count: members.length, used, free, text: parts.join('・') };
}

/** その予定が入っているまとまり(エリアと中の予定。普通の予定は 1 つだけ)の [始め, 終わり] の位置 */
export function blockOf(events: ReadonlyArray<Ev>, index: number, roles = areaRoles(events)): [number, number] {
  const e = events[index];
  if (!e) return [index, index];
  const r = roles.get(e.id);
  if (!r || r.role === 'none') return [index, index];
  let start = index;
  while (start > 0 && roles.get(events[start]!.id)?.role === 'member') start -= 1;
  let end = start;
  while (end + 1 < events.length && events[end + 1]!.parent_event_id === events[start]!.id
    && roles.get(events[end + 1]!.id)?.role === 'member') end += 1;
  return [start, end];
}

export type AreaMove =
  | { kind: 'default' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'move'; order: string[]; keepSlots: boolean; text: string };

/**
 * ↑↓ の並べ替え。エリアが関わらない時は 'default'(今までの入れ替え)。
 * 中の予定はエリアの中でだけ入れ替える。エリア・エリアを越える予定は、まとまりごと動かす(時刻は予定に付いたまま)。
 */
export function areaMove(events: ReadonlyArray<Ev>, index: number, delta: -1 | 1): AreaMove {
  const roles = areaRoles(events);
  const ev = events[index];
  if (!ev) return { kind: 'default' };
  const role = roles.get(ev.id)!;
  if (role.role === 'member') {
    const target = events[index + delta];
    if (target && roles.get(target.id)?.role === 'member' && target.parent_event_id === ev.parent_event_id) {
      return { kind: 'default' };
    }
    const area = events.find((e) => e.id === role.areaId);
    return { kind: 'blocked', reason: `「${ev.title}」はエリア「${area?.title ?? ''}」の中の予定です。外へ出す時は、編集の「エリア」で外してください` };
  }
  const [s, e] = blockOf(events, index, roles);
  const ns = delta < 0 ? (s > 0 ? blockOf(events, s - 1, roles)[0] : -1) : e + 1;
  if (ns < 0 || ns >= events.length) {
    return s === e && !isArea(ev) ? { kind: 'default' } : { kind: 'blocked', reason: 'これ以上は動かせません' };
  }
  const [bs, be] = blockOf(events, ns, roles);
  if (s === e && bs === be && !isArea(ev) && !isArea(events[bs])) return { kind: 'default' };
  const mine = events.slice(s, e + 1);
  const theirs = events.slice(bs, be + 1);
  const locked = [...mine, ...theirs].find((x) => x.locked);
  if (locked) return { kind: 'blocked', reason: `確定の予定「${locked.title}」が関わるため動かせません` };
  const ids = events.map((x) => x.id);
  const order = delta < 0
    ? [...ids.slice(0, bs), ...mine.map((x) => x.id), ...theirs.map((x) => x.id), ...ids.slice(e + 1)]
    : [...ids.slice(0, s), ...theirs.map((x) => x.id), ...mine.map((x) => x.id), ...ids.slice(be + 1)];
  const what = isArea(ev) ? `エリア「${ev.title}」と中の予定` : `「${ev.title}」`;
  return { kind: 'move', order, keepSlots: false, text: `${what}を${delta < 0 ? '前' : '後ろ'}へ動かす案にしました(時刻は予定に付いたまま)。まだ保存していません` };
}

/** [Gate EventArea] 2 点の距離(メートル) */
function meters(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * [Gate EventArea] エリアの範囲の円: 中心はエリアの位置(無ければ中の予定の位置の真ん中)、半径は中の予定が入る大きさ
 * (最小 120m・最大 1.5km)。位置が分からなければ出さない。
 */
export function areaCircles(events: ReadonlyArray<ScheduleItem>): { id: string; title: string; center: [number, number]; radius: number }[] {
  const pos = (e: ScheduleItem): [number, number] | null =>
    (typeof e.latitude === 'number' && typeof e.longitude === 'number' ? [e.latitude, e.longitude] : null);
  return events.filter((e) => e.category === 'area').flatMap((a) => {
    const inner = events.filter((e) => e.parent_event_id === a.id).map(pos).filter((p): p is [number, number] => p !== null);
    const own = pos(a);
    const center: [number, number] | null = own ?? (inner.length
      ? [inner.reduce((s, p) => s + p[0], 0) / inner.length, inner.reduce((s, p) => s + p[1], 0) / inner.length] : null);
    if (!center) return [];
    const far = inner.reduce((m, p) => Math.max(m, meters(center, p)), 0);
    return [{ id: a.id, title: a.title, center, radius: Math.min(1500, Math.max(120, far + 60)) }];
  });
}
