/**
 * [Gate SpotMode] FR-060 スポットモードの計算(画面を持たない純粋な関数。spotModel.test.ts)。
 *
 * - 距離・歩く時間は直線の目安(道順ではない)。歩く速さは 80m/分(当日の画面と同じ)
 * - 残り時間と「戻り始め」の時刻: 集合の時刻 − 今いる場所から集合の場所まで歩く時間。出発の合図と同じ 4 段階
 * - 次どこ？: 気分の条件・近さ・行きたい印・営業中・残り時間で並べる(AI は使わない)。理由を札で返す
 * - 残り時間で回れる道順の案: 近い順に、集合に間に合う間だけ足す(行きたいを先に)
 */
import type { DayHours } from '@/services/api/types/candidates';
import type { SpotGenre, SpotItem } from '@/services/api/types/spotAreas';

export type LatLng = [number, number];
export const WALK_M_PER_MIN = 80;

export const GENRE_META: Record<SpotGenre, { label: string; color: string; short: string }> = {
  food: { label: '食べ歩き', color: '#b23c22', short: '食' },
  cafe: { label: 'カフェ', color: '#8a5a12', short: 'カ' },
  gift: { label: 'お土産', color: '#1d4ed8', short: '土' },
  sight: { label: '見どころ', color: '#0f6e66', short: '見' },
  rest: { label: '休憩・トイレ', color: '#475569', short: '休' },
  other: { label: 'そのほか', color: '#5b6b80', short: '他' },
};
export const GENRE_ORDER: SpotGenre[] = ['food', 'cafe', 'gift', 'sight', 'rest', 'other'];

export function distanceM(a: LatLng, b: LatLng): number {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dla = toRad(b[0] - a[0]);
  const dlo = toRad(b[1] - a[1]);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dlo / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const walkMinutes = (m: number): number => Math.max(1, Math.ceil(m / WALK_M_PER_MIN));

export const roundMeters = (m: number): number => (m < 1000 ? Math.round(m / 10) * 10 : Math.round(m / 100) * 100);

export function formatDistance(m: number): string {
  const r = roundMeters(m);
  return r < 1000 ? `${r}m` : `${(r / 1000).toFixed(1)}km`;
}

/** 方角(度。北=0、東=90) */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
export const directionWord = (deg: number): string => DIRS[Math.round(deg / 45) % 8]!;

export const pointOf = (i: { latitude: number | null; longitude: number | null }): LatLng | null =>
  i.latitude != null && i.longitude != null ? [i.latitude, i.longitude] : null;

/** 'HH:MM' → 0 時からの分 */
export function minutesOf(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const hhmm = (min: number): string => {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

/** その時間帯(既定は端末の時間帯)の今の時刻(0 時からの分)と日付 */
export function nowIn(timeZone: string | null | undefined, nowMs: number): { minutes: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { minutes: Number(get('hour')) * 60 + Number(get('minute')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

export type ReturnLevel = 'calm' | 'soon' | 'now' | 'late';
export const RETURN_LABEL: Record<ReturnLevel, string> = { calm: 'ゆっくり', soon: 'そろそろ', now: 'いま', late: '遅れ' };

export interface TimeState {
  /** 終わり(集合の時刻。無ければ終わりの時刻)までの分。時刻が無ければ null */
  remain: number | null;
  /** 戻り始めの時刻(分)。集合の場所まで歩く時間を引く */
  returnBy: number | null;
  level: ReturnLevel | null;
  /** 0〜1 の経過の割合(始まりと終わりがある時) */
  progress: number | null;
  /** 集合の場所まで歩く分(位置が分からなければ null) */
  walkToMeet: number | null;
}

export function timeState(area: { start_time: string | null; end_time: string | null; meet_time: string | null;
  meet_latitude: number | null; meet_longitude: number | null }, nowMin: number, me: LatLng | null): TimeState {
  const end = minutesOf(area.meet_time) ?? minutesOf(area.end_time);
  const start = minutesOf(area.start_time);
  if (end == null) return { remain: null, returnBy: null, level: null, progress: null, walkToMeet: null };
  const meet = pointOf({ latitude: area.meet_latitude, longitude: area.meet_longitude });
  const walkToMeet = me && meet ? walkMinutes(distanceM(me, meet)) : null;
  const returnBy = end - (walkToMeet ?? 0);
  const toReturn = returnBy - nowMin;
  const level: ReturnLevel = toReturn < 0 ? 'late' : toReturn <= 10 ? 'now' : toReturn <= 30 ? 'soon' : 'calm';
  const progress = start != null && end > start ? Math.min(1, Math.max(0, (nowMin - start) / (end - start))) : null;
  return { remain: end - nowMin, returnBy, level, progress, walkToMeet };
}

/** その日の営業時間で、今が営業中か(分からなければ null) */
export function openAt(h: DayHours | null | undefined, nowMin: number): boolean | null {
  if (!h || h.source === 'unknown') return null;
  if (h.closed) return false;
  for (const w of h.windows) {
    const o = minutesOf(w.open);
    const c = minutesOf(w.close);
    if (o == null || c == null) continue;
    const close = w.crosses_midnight || c <= o ? c + 1440 : c;
    if (nowMin >= o && nowMin < close) return true;
  }
  return h.windows.length ? false : null;
}

export type Mood = 'tired' | 'hungry' | 'rain' | 'quick' | 'photo' | 'toilet';
export const MOODS: Array<{ key: Mood; label: string }> = [
  { key: 'tired', label: '歩き疲れた' }, { key: 'hungry', label: '小腹がすいた' }, { key: 'rain', label: '雨・屋内' },
  { key: 'quick', label: 'さっと 15分' }, { key: 'photo', label: '写真を撮りたい' }, { key: 'toilet', label: 'トイレ' },
];

export function matchesMood(i: SpotItem, mood: Mood): boolean {
  switch (mood) {
    case 'tired': return i.seats;
    case 'hungry': return i.genre === 'food' || i.genre === 'cafe';
    case 'rain': return i.fit === 'indoor';
    case 'quick': return i.stay_minutes <= 15;
    case 'photo': return i.genre === 'sight';
    case 'toilet': return i.genre === 'rest';
  }
}

export const isDone = (i: SpotItem): boolean => !!i.visited_at || i.skipped;

export interface Ranked {
  item: SpotItem;
  score: number;
  walk: number | null;
  meters: number | null;
  open: boolean | null;
  reasons: string[];
}

/** 次どこ？ 済み・今日はやめるを除き、閉まっている所・残り時間に収まらない所は後ろへ回す */
export function rankNext(items: SpotItem[], me: LatLng | null, moods: Mood[], nowMin: number,
  remain: number | null): Ranked[] {
  const out: Ranked[] = [];
  for (const i of items) {
    if (isDone(i)) continue;
    const p = pointOf(i);
    const meters = me && p ? distanceM(me, p) : null;
    const walk = meters != null ? walkMinutes(meters) : null;
    const open = openAt(i.hours_today, nowMin);
    const reasons: string[] = [];
    let score = 0;
    const hits = moods.filter((m) => matchesMood(i, m));
    if (moods.length) {
      score += hits.length * 40;
      if (!hits.length) score -= 30;
    }
    if (i.seats && moods.includes('tired')) reasons.push('座れる');
    if (i.fit === 'indoor' && moods.includes('rain')) reasons.push('屋内');
    if (i.stay_minutes <= 15 && moods.includes('quick')) reasons.push('さっと');
    if (walk != null) {
      score -= walk * 3;
      if (walk <= 3) reasons.push(`近い ${walk}分`);
    }
    if (i.priority === 'want') {
      score += 30;
      reasons.push('行きたい');
    }
    if (i.wanted_by.length) {
      score += i.wanted_by.length * 5;
      if (i.priority !== 'want') reasons.push(`行きたい印 ${i.wanted_by.length}`);
    }
    if (open === true) {
      score += 10;
      reasons.push('営業中');
    } else if (open === false) {
      score -= 200;
      reasons.push('営業時間外');
    }
    if (remain != null) {
      const need = (walk ?? 0) + i.stay_minutes;
      if (need <= remain) {
        score += 10;
        reasons.push('残り時間に収まる');
      } else {
        score -= 100;
        reasons.push('時間が足りない');
      }
    }
    out.push({ item: i, score, walk, meters, open, reasons });
  }
  return out.sort((a, b) => b.score - a.score || (a.walk ?? 999) - (b.walk ?? 999) || a.item.sort_order - b.item.sort_order);
}

export interface Chain {
  order: SpotItem[];
  walk: number;
  stay: number;
  /** 集合の場所に着く時刻(分。集合の場所が無ければ最後の候補を出る時刻) */
  arrive: number;
  spare: number | null;
}

/** 残り時間で回れる道順の案(行きたいを先に、近い所から。集合に間に合う間だけ足す) */
export function planChain(items: SpotItem[], start: LatLng | null, nowMin: number, endMin: number | null,
  meet: LatLng | null): Chain | null {
  if (!start) return null;
  const pool = items.filter((i) => !isDone(i) && pointOf(i));
  const order: SpotItem[] = [];
  let here: LatLng = start;
  let walk = 0;
  let stay = 0;
  const backFrom = (p: LatLng) => (meet ? walkMinutes(distanceM(p, meet)) : 0);
  for (const pass of ['want', 'any'] as const) {
    let added = true;
    while (added) {
      added = false;
      const cands = pool.filter((i) => !order.includes(i) && (pass === 'any' || i.priority === 'want'))
        .map((i) => ({ i, w: walkMinutes(distanceM(here, pointOf(i)!)) }))
        .sort((a, b) => a.w - b.w);
      for (const { i, w } of cands) {
        const p = pointOf(i)!;
        const total = nowMin + walk + stay + w + i.stay_minutes + backFrom(p);
        if (endMin == null || total <= endMin) {
          order.push(i);
          walk += w;
          stay += i.stay_minutes;
          here = p;
          added = true;
          break;
        }
      }
      if (endMin == null && order.length >= 4) break;
    }
  }
  if (!order.length) return null;
  walk += backFrom(here);
  const arrive = nowMin + walk + stay;
  return { order, walk, stay, arrive, spare: endMin != null ? endMin - arrive : null };
}

export type SortMode = 'near' | 'plan' | 'want';
export function sortItems(items: SpotItem[], me: LatLng | null, mode: SortMode): SpotItem[] {
  const d = (i: SpotItem) => {
    const p = pointOf(i);
    return me && p ? distanceM(me, p) : Number.MAX_SAFE_INTEGER;
  };
  return [...items].sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || (
    mode === 'near' ? d(a) - d(b) || a.sort_order - b.sort_order
      : mode === 'want' ? Number(b.priority === 'want') - Number(a.priority === 'want') ||
        b.wanted_by.length - a.wanted_by.length || a.sort_order - b.sort_order
        : a.sort_order - b.sort_order));
}

/** 地図アプリで開く(歩き) */
export const googleWalkUrl = (p: LatLng): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${p[0]},${p[1]}&travelmode=walking`;
export const appleWalkUrl = (p: LatLng): string => `https://maps.apple.com/?daddr=${p[0]},${p[1]}&dirflg=w`;

/** エリアの真ん中(エリアの値、無ければ候補の平均) */
export function areaCenter(area: { center_latitude: number | null; center_longitude: number | null; items: SpotItem[] }): LatLng | null {
  if (area.center_latitude != null && area.center_longitude != null) return [area.center_latitude, area.center_longitude];
  const pts = area.items.map(pointOf).filter((p): p is LatLng => !!p);
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** 予定の画面から勧めるか(時間: 始まりの 10 分前〜終わり。位置: 範囲 + 200m 以内) */
export function shouldSuggest(area: { suggest_on_approach: boolean; start_time: string | null; end_time: string | null;
  radius_m: number }, nowMin: number, center: LatLng | null, me: LatLng | null): 'near' | 'time' | null {
  if (!area.suggest_on_approach) return null;
  if (me && center && distanceM(me, center) <= area.radius_m + 200) return 'near';
  const s = minutesOf(area.start_time);
  const e = minutesOf(area.end_time);
  if (s != null && nowMin >= s - 10 && nowMin <= (e ?? s + 120)) return 'time';
  return null;
}

/** 準備: 「行きたい」だけを並びの順に回った時の目安(分。滞在 + 直線の歩き) */
export function wantMinutes(items: Array<{ priority: string; stay_minutes: number; point: LatLng | null }>): number {
  const wants = items.filter((i) => i.priority === 'want');
  let total = wants.reduce((s, i) => s + i.stay_minutes, 0);
  const pts = wants.map((i) => i.point).filter((p): p is LatLng => !!p);
  for (let k = 1; k < pts.length; k += 1) total += walkMinutes(distanceM(pts[k - 1]!, pts[k]!));
  return total;
}
