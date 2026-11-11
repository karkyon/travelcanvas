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
    return { kind: 'blocked', reason: `「${ev.title}」はエリア「${area?.title ?? ''}」の中の予定です。外へ出す時は、ドラッグでエリアの外へ落としてください` };
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

// ===== [Gate AreaDrag] ドラッグでエリアへ入れる・出す・エリアの中で並べ替える =====

type DropEv = Ev & Pick<ScheduleItem, 'duration'>;

/** 並べ替えと一緒に送る、エリアの出し入れと時刻の付け直し */
export interface AreaExtra {
  parents?: Record<string, string | null>;
  times?: Record<string, { start: string; end?: string | null }>;
}

export type AreaDrop =
  | { kind: 'plain' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'move'; order: string[]; extra: AreaExtra; text: string };

const hmOf = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 予定の長さ(分)。終了が無ければ所要時間、それも無ければ 30 分 */
export function stayMinutes(e: DropEv): number {
  const s = span(e);
  if (s !== null && s > 0) return s;
  return e.duration && e.duration > 0 ? e.duration : 30;
}

/**
 * エリア A の中の予定に、新しい順で時刻を付け直す。
 * - 元から中にあった予定の開始の時刻(早い順)を、新しい順の位置に配る(エリアの時間帯の中で並べ替える)
 * - 新しく入れた予定は、前の予定の終わり(先頭ならエリアの開始)から。長さはそれぞれの予定のまま
 * - 前の予定と重なれば後ろへずらす。はみ出したら、エリアの終わりを延ばす・開始を早める(縮めはしない)
 * 戻り値: 予定 ID → [開始, 終了](分)。時刻を付けられない予定(時刻の無い予定)は含めない
 */
export function packArea(area: DropEv, members: ReadonlyArray<DropEv>, entering: ReadonlySet<string>,
): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const aStart = minutesOf(area.start_time);
  const slots = members.filter((m) => !entering.has(m.id)).map((m) => minutesOf(m.start_time))
    .filter((v): v is number => v !== null).sort((a, b) => a - b);
  let cursor: number | null = aStart;
  for (const m of members) {
    const own = minutesOf(m.start_time);
    const isNew = entering.has(m.id);
    if (!isNew && own === null) continue;  // 時刻の無い予定はそのまま
    const preferred = isNew ? cursor ?? own : slots.shift() ?? cursor ?? own;
    if (preferred === null) continue;
    const start = cursor !== null ? Math.max(preferred, cursor) : preferred;
    const end = start + stayMinutes(m);
    out.set(m.id, [start, end]);
    cursor = end;
  }
  const spans = [...out.values()];
  if (spans.length) {
    const lo = Math.min(...spans.map(([s]) => s));
    const hi = Math.max(...spans.map(([, e]) => e));
    const aEnd = aStart !== null ? aStart + (span(area) ?? 0) : null;
    const ns = aStart === null ? lo : Math.min(aStart, lo);
    const ne = aEnd === null || aEnd <= ns ? hi : Math.max(aEnd, hi);
    out.set(area.id, [ns, ne]);
  }
  return out;
}

/**
 * ドラッグの結果。gap は元の並びで「i 番目の予定の前」(末尾は件数)、parent は落とした所のエリア(外なら null)。
 * - エリアが関わらない(外 → 外)なら 'plain'(今までのスポットの入れ替え)
 * - エリア自身はまとまりごと外の位置へ(時刻は予定に付いたまま)
 * - 外 → エリア・エリア → 外・エリアの中の並べ替え: 並び・エリアの指定・時刻(エリアの延長を含む)を 1 回で送る
 */
export function areaDrop(events: ReadonlyArray<DropEv>, dragId: string, gap: number, parent: string | null): AreaDrop {
  const roles = areaRoles(events);
  const idx = events.findIndex((e) => e.id === dragId);
  const dragged = events[idx];
  if (!dragged) return { kind: 'blocked', reason: '動かす予定が見つかりません' };
  if (dragged.locked) return { kind: 'blocked', reason: `確定の予定「${dragged.title}」は動かせません` };
  const ids = events.map((e) => e.id);
  const role = roles.get(dragId)!;

  // エリアのまとまりを動かす(落とす先はエリアの外。ほかのエリアの中なら、そのエリアの前へ)
  if (role.role === 'area') {
    const [s, e] = blockOf(events, idx, roles);
    let at = gap;
    if (at > s && at <= e + 1) return { kind: 'blocked', reason: '同じ位置です' };
    const inside = events[at] && roles.get(events[at]!.id)?.role === 'member' ? roles.get(events[at]!.id)!.areaId : null;
    if (inside) at = events.findIndex((x) => x.id === inside);
    const block = ids.slice(s, e + 1);
    const rest = ids.filter((x) => !block.includes(x));
    const pos = at > e ? at - block.length : at;
    const order = [...rest.slice(0, pos), ...block, ...rest.slice(pos)];
    const locked = events.find((x, i) => x.locked && order[i] !== x.id);
    if (locked) return { kind: 'blocked', reason: `確定の予定「${locked.title}」の位置が変わるため動かせません` };
    return { kind: 'move', order, extra: {}, text: `エリア「${dragged.title}」と中の予定を${order.indexOf(dragged.id) + 1}番目へ動かす案にしました(時刻は予定に付いたまま)。まだ保存していません` };
  }

  const from = role.role === 'member' ? role.areaId : null;
  if (!from && !parent) return { kind: 'plain' };
  const area = parent ? events.find((x) => x.id === parent && isArea(x)) : undefined;
  if (parent && !area) return { kind: 'blocked', reason: '入れる先のエリアが見つかりません' };

  // 並び: 自分を抜いて、落とした所へ。エリアの中へは、エリアのまとまりの中に収める。外へは、まとまりの外に出す
  const rest = ids.filter((x) => x !== dragId);
  let pos = gap > idx ? gap - 1 : gap;
  const restEv = rest.map((x) => events.find((y) => y.id === x)!);
  const restRoles = areaRoles(restEv);
  if (area) {
    const ai = rest.indexOf(area.id);
    const [, be] = blockOf(restEv, ai, restRoles);
    pos = Math.min(Math.max(pos, ai + 1), be + 1);
  } else if (pos < rest.length && restRoles.get(rest[pos]!)?.role === 'member') {
    const ai = rest.indexOf(restRoles.get(rest[pos]!)!.areaId!);
    pos = blockOf(restEv, ai, restRoles)[1] + 1;  // エリアの中へは入れない(まとまりの後ろへ)
  }
  const order = [...rest.slice(0, pos), dragId, ...rest.slice(pos)];
  if (order.join(',') === ids.join(',') && from === parent) return { kind: 'blocked', reason: '同じ位置です' };
  const lockedMoved = events.find((x, i) => x.locked && order[i] !== x.id);
  if (lockedMoved) return { kind: 'blocked', reason: `確定の予定「${lockedMoved.title}」の位置が変わるため動かせません` };

  // 時刻
  const byId = new Map(events.map((e) => [e.id, e]));
  const next = new Map<string, [number, number]>();
  const repack = (areaId: string, enteringIds: string[]) => {
    const a = byId.get(areaId)!;
    const members = order.filter((x) => x !== areaId && (x === dragId ? parent === areaId : byId.get(x)!.parent_event_id === areaId))
      .map((x) => byId.get(x)!);
    for (const [k, v] of packArea(a, members, new Set(enteringIds))) next.set(k, v);
  };
  if (parent) repack(parent, from === parent ? [] : [dragId]);
  if (from && from !== parent) {
    repack(from, []);
    // エリアから出した予定: 前の予定の終わりから(長さはそのまま)
    const own = minutesOf(dragged.start_time);
    const prevId = order[order.indexOf(dragId) - 1];
    let prev = prevId ? byId.get(prevId) : undefined;
    // 前がエリアの中の予定なら、エリアの終わりから(エリアの方が長い時)
    if (prev?.parent_event_id && prev.id !== dragId) prev = byId.get(prev.parent_event_id) ?? prev;
    const endOf = (e: DropEv): number | null => {
      const n = next.get(e.id);
      if (n) return n[1];
      const ps = minutesOf(e.start_time);
      return ps !== null ? ps + stayMinutes(e) : null;
    };
    const start = (prev ? endOf(prev) : null) ?? own;
    if (start !== null) next.set(dragId, [start, start + stayMinutes(dragged)]);
  }
  const times: Record<string, { start: string; end?: string | null }> = {};
  for (const [id, [s, e]] of next) {
    const ev = byId.get(id)!;
    if (e > 24 * 60 - 1) return { kind: 'blocked', reason: `「${ev.title}」の時刻が日をまたぐため、この位置には入れられません(時刻を直してから動かしてください)` };
    const st = hmOf(s);
    const en = hmOf(e);
    if (minutesOf(ev.start_time) === s && minutesOf(ev.end_time) === e) continue;
    if (ev.locked) return { kind: 'blocked', reason: `確定の予定「${ev.title}」の時刻が変わるため動かせません` };
    times[id] = { start: st, end: en };
  }
  const extra: AreaExtra = { times };
  if (from !== parent) extra.parents = { [dragId]: parent };
  const areaTime = (id: string) => (times[id] ? `(エリアの時刻を ${times[id]!.start}〜${times[id]!.end} に)` : '');
  const text = parent && from === parent
    ? `「${dragged.title}」をエリア「${area!.title}」の中で動かす案にしました${areaTime(parent)}。まだ保存していません`
    : parent
      ? `「${dragged.title}」をエリア「${area!.title}」へ入れる案にしました${areaTime(parent)}。まだ保存していません`
      : `「${dragged.title}」をエリア「${byId.get(from!)?.title ?? ''}」から出す案にしました。まだ保存していません`;
  return { kind: 'move', order, extra, text };
}

/** 案の見え方: 並び・エリアの指定・時刻を当てた予定の一覧 */
export function applyExtra<T extends Ev>(events: ReadonlyArray<T>, extra: AreaExtra | null | undefined): T[] {
  if (!extra || (!extra.parents && !extra.times)) return [...events];
  return events.map((e) => {
    let out = e;
    if (extra.parents && e.id in extra.parents) out = { ...out, parent_event_id: extra.parents[e.id] ?? undefined };
    const t = extra.times?.[e.id];
    if (t) out = { ...out, start_time: t.start, end_time: t.end ?? out.end_time, end_day_offset: 0 };
    return out;
  });
}
