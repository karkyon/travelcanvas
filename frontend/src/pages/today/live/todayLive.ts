/**
 * [Gate TDay] 旅の当日「旅帖ライブ」の計算(画面から切り離した純粋関数。固定の時刻で試験する)。
 *
 * - 出発の合図の段階: backend の today_guide.stage と同じ基準(余裕あり 21分〜 / そろそろ 1〜20分 / 今出発 0〜−4分 / 遅れ気味)
 * - 一日の時間帯: 旅の前・朝(最初の予定の前)・旅の間・夜(最後の予定が済んだ後)・旅の終わり(最終日の夜)
 * - 旅帖の印の字: 予定の名前から、その場所らしい漢字を1〜2字(作れなければ「旅」)
 * - 空模様: 1時間ごとの降水確率を、今日の予定の時刻に重ねる(雨の時間にかかる屋外の予定)
 * - すきま時間の寄り道: 足した時に後の予定にはみ出すかどうか
 */
import type { TodayEvent } from '@/services/api';
import type { GuideEvent, GuideGap, TodayGuide } from '@/services/api/travelDay';

export type GoStage = 'relaxed' | 'soon' | 'now' | 'late';

export const STAGE_LABEL: Record<GoStage, string> = {
  relaxed: '余裕あり', soon: 'そろそろ', now: '今出発', late: '遅れ気味',
};
export const STAGE_ORDER: GoStage[] = ['relaxed', 'soon', 'now', 'late'];

export function goStage(minutesToLeave: number | null): GoStage | null {
  if (minutesToLeave == null || Number.isNaN(minutesToLeave)) return null;
  if (minutesToLeave > 20) return 'relaxed';
  if (minutesToLeave > 0) return 'soon';
  if (minutesToLeave > -5) return 'now';
  return 'late';
}

/** 出る時刻までの分(切り捨て。過ぎていれば負)。出る時刻が分からなければ null */
export function minutesTo(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - nowMs) / 60_000);
}

export interface GoNowView {
  stage: GoStage;
  /** 出る時刻までの分(負は過ぎた分) */
  minutesToLeave: number;
  leaveBy: string;
  /** 予定の開始までの分 */
  minutesToStart: number | null;
  /** 移動の分と出所(概算なら画面に「概算」と書く) */
  travelMinutes: number | null;
  estimated: boolean;
  /** 移動の分の出所(segment: 区間の出発時刻 / manual: 乗換を調べて入れた / estimate: 概算) */
  source: 'segment' | 'manual' | 'estimate' | null;
  /** 遅れ気味の時の到着の見込み(今から移動の分) */
  expectedArrivalMs: number | null;
  /** 輪の塗り(0〜1)。60分前を0、出る時刻を1 */
  ring: number;
  advice: string;
}

export function goNowView(next: TodayEvent | null, guide: GuideEvent | undefined, nowMs: number): GoNowView | null {
  if (!next) return null;
  const leaveBy = guide?.leave_by ?? next.departure_at ?? null;
  const m = minutesTo(leaveBy, nowMs);
  const stage = goStage(m);
  if (stage == null || m == null || leaveBy == null) return null;
  const travel = guide?.travel_minutes ?? null;
  const expected = stage === 'late' && travel != null ? nowMs + travel * 60_000 : null;
  const ring = Math.max(0, Math.min(1, 1 - m / 60));
  const advice = {
    relaxed: 'まだ時間があります。今の場所をもう少し楽しめます。',
    soon: '印を押す・写真を撮るなら今のうちに。',
    now: '今出ると予定どおりに着きます。',
    late: '予定より遅れそうです。お店や同行者に知らせるか、後の予定を組み直せます。',
  }[stage];
  return {
    stage, minutesToLeave: m, leaveBy, minutesToStart: minutesTo(next.start_at, nowMs), travelMinutes: travel,
    estimated: guide?.travel_source === 'estimate', source: guide?.travel_source ?? null, expectedArrivalMs: expected,
    ring, advice,
  };
}

export type DayPhase = 'before' | 'morning' | 'during' | 'night' | 'finished' | 'none';

/** 一日の時間帯。events は今日の予定(開始順)、doneCount は開始が過ぎて終わった数 */
export function dayPhase(guide: TodayGuide | null, events: TodayEvent[], nowMs: number, hasNow: boolean,
  hasNext: boolean): DayPhase {
  if (guide && !guide.day_id) return guide.upcoming ? 'before' : 'none';
  if (events.length === 0) return 'none';
  const firstStart = Date.parse(events[0]!.start_at ?? '');
  if (!hasNow && hasNext && !Number.isNaN(firstStart) && nowMs < firstStart) return 'morning';
  if (!hasNow && !hasNext) return guide?.is_last_day ? 'finished' : 'night';
  return 'during';
}

const SKIP_WORDS = ['駅', '店', '館', '寺', '社', '宮', '城', '園', '橋', '港', '湖', '山', '川', '海', '宿'];
/** 旅帖の印の字(場所の名前の最初の漢字。駅・寺などの種類の字があれば添える。2字まで) */
export function sealGlyph(title: string, eventType?: string | null): string {
  const kanji = [...title].filter((c) => /\p{Script=Han}/u.test(c));
  if (eventType === 'accommodation' || eventType === 'lodging' || /ホテル|旅館|宿/.test(title)) return '宿';
  if (/出発|自宅/.test(title)) return '発';
  if (kanji.length === 0) {
    const first = [...title.trim()][0];
    return first && /\p{L}/u.test(first) ? first.toUpperCase() : '旅';
  }
  const kind = [...title].reverse().find((c) => SKIP_WORDS.includes(c));
  const head = kanji[0]!;
  if (kind && kind !== head) return `${head}${kind}`;
  return kanji.slice(0, 2).join('') || head;
}

/** 印の傾き(題名から決まる。同じ予定はいつも同じ傾き) */
export function sealTilt(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (Math.abs(h) % 13) - 6;
}

export interface SkyHour { hour: number; probability: number | null; rainy: boolean }

/** その時刻(旅行先の現地 "HH:MM")の時間の空模様 */
export function hourAt(hours: SkyHour[], localHm: string | null): SkyHour | null {
  if (!localHm) return null;
  const h = Number(localHm.slice(0, 2));
  return hours.find((x) => x.hour === h) ?? null;
}

/** 雨の時間帯の始まりと終わり(現地の時)。雨が無ければ null */
export function rainWindow(hours: SkyHour[], fromHour = 0): { start: number; end: number; max: number } | null {
  const rainy = hours.filter((h) => h.rainy && h.hour >= fromHour);
  if (rainy.length === 0) return null;
  const start = rainy[0]!.hour;
  let end = start;
  for (const h of rainy) if (h.hour === end + 1 || h.hour === end) end = h.hour;
  return { start, end: end + 1, max: Math.max(...rainy.map((h) => h.probability ?? 0)) };
}

/** 空模様を行動の言葉に */
export function skyAdvice(hours: SkyHour[], nowHour: number): string | null {
  const w = rainWindow(hours, nowHour);
  if (!w) return null;
  return `${w.start}〜${w.end}時に雨の可能性 ${w.max}%。傘を持って出よう`;
}

/** 現地の "HH:MM"(タイムゾーン付きで) */
export function localHm(iso: string | null, timeZone: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone ?? undefined, hour: '2-digit', minute: '2-digit',
      hour12: false }).format(new Date(t));
  } catch {
    return null;
  }
}

/** 現地の時(0〜23) */
export function localHour(ms: number, timeZone: string | null): number {
  const hm = localHm(new Date(ms).toISOString(), timeZone);
  return hm ? Number(hm.slice(0, 2)) : new Date(ms).getHours();
}

export interface DetourPlan { start: string; end: string; fits: boolean; overflowMinutes: number; leftMinutes: number }

/** すきま時間に stay 分の寄り道を足した時の時刻と、後の予定へのはみ出し */
export function planDetour(gap: GuideGap, stayMinutes: number, travelMinutes: number, timeZone: string | null): DetourPlan | null {
  const s = Date.parse(gap.start_at) + travelMinutes * 60_000;
  const e = s + stayMinutes * 60_000;
  const limit = Date.parse(gap.end_at);
  if (Number.isNaN(s) || Number.isNaN(limit)) return null;
  const start = localHm(new Date(s).toISOString(), timeZone);
  const end = localHm(new Date(e).toISOString(), timeZone);
  if (!start || !end) return null;
  const back = e + travelMinutes * 60_000;
  const overflow = Math.max(0, Math.ceil((back - limit) / 60_000));
  return { start, end, fits: overflow === 0, overflowMinutes: overflow,
    leftMinutes: Math.max(0, Math.floor((limit - back) / 60_000)) };
}

/** 寄り道の候補までの歩く時間の概算(片道。直線距離 × 1.3 を時速 4.5km で) */
export function walkMinutes(distanceKm: number | null): number {
  if (distanceKm == null) return 10;
  return Math.max(3, Math.round((distanceKm * 1.3 / 4.5) * 60));
}

/** 営業の照合の短い言葉 */
export function hoursLabel(status: string | null | undefined, minutes: number | null | undefined): { text: string; tone: 'good' | 'warn' | 'bad' } | null {
  switch (status) {
    case 'ok': return { text: '営業中', tone: 'good' };
    case 'near_close': return { text: minutes != null ? `閉店まで${minutes}分` : '閉店が近い', tone: 'warn' };
    case 'last_entry': return { text: '最終入場を過ぎる', tone: 'bad' };
    case 'last_order': return { text: 'ラストオーダーを過ぎる', tone: 'bad' };
    case 'closes_during': return { text: '滞在中に閉まる', tone: 'warn' };
    case 'closed': return { text: '営業時間外', tone: 'bad' };
    default: return null;
  }
}

/** 同行者に送る到着予定の文(位置は含めない) */
export function etaMessage(title: string, arriveHm: string | null, delay: number | null): string {
  const t = arriveHm ? `${arriveHm}ごろ` : 'まもなく';
  if (delay != null && delay > 0) return `「${title}」に${t}着きます(予定より${delay}分遅れ)`;
  return `「${title}」に${t}着きます`;
}

/** 夜のふりかえりの言葉 */
export function recapTitle(visited: number, total: number): string {
  if (total === 0) return 'おつかれさま';
  if (visited >= total) return 'すべての場所をめぐりました';
  return `${total}か所のうち${visited}か所をめぐりました`;
}

/** 読み上げ(設定で ON の時だけ呼ぶ)。読み上げできない環境では何もしない */
export function speak(text: string): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    // 何もしない
  }
}

export interface LiveSettings {
  notices: { go: boolean; arrive: boolean; rain: boolean; delay: boolean; detour: boolean };
  /** [Gate TDay-Mock] 位置(既定は OFF)。この端末の中だけで使い、送らない */
  location: { arrive: boolean; trail: boolean };
  voice: boolean;
  shareEta: boolean;
}
export const SETTINGS_KEY = 'tc.today.live';
export const DEFAULT_SETTINGS: LiveSettings = {
  notices: { go: true, arrive: true, rain: true, delay: true, detour: false }, location: { arrive: false, trail: false },
  voice: false, shareEta: false,
};
export function readSettings(): LiveSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<LiveSettings> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
    return { notices: { ...DEFAULT_SETTINGS.notices, ...(raw.notices ?? {}) },
      location: { ...DEFAULT_SETTINGS.location, ...(raw.location ?? {}) }, voice: raw.voice === true,
      shareEta: raw.shareEta === true };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export function writeSettings(s: LiveSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // 保存できない環境では、この画面を開いている間だけ
  }
}

const DISMISS_KEY = 'tc.today.dismissed';
/** 閉じた知らせ(同じ日に二度出さない)。key は「日付:種類:予定」 */
export function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(DISMISS_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
export function writeDismissed(keys: Set<string>): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...keys].slice(-60)));
  } catch {
    // 何もしない
  }
}

export interface LiveNotice { key: string; kind: 'go' | 'arrive' | 'rain' | 'delay' | 'detour'; title: string; sub: string; action: string; onAction: () => void }

// ---- [Gate TDay-Transit] 乗換の時刻(無料で正確: 外の地図の乗換で調べて、分かった時刻を区間に入れる) ----------

/** 前の予定から次の予定までの、Google マップの乗換(公共交通)の道順の URL(キー不要・無料)。座標が無ければ null */
export function transitUrl(from: { latitude: number | null; longitude: number | null } | null,
  to: { latitude: number | null; longitude: number | null }): string | null {
  if (to.latitude == null || to.longitude == null) return null;
  const q = new URLSearchParams({ api: '1', destination: `${Number(to.latitude)},${Number(to.longitude)}`, travelmode: 'transit' });
  if (from && from.latitude != null && from.longitude != null) q.set('origin', `${Number(from.latitude)},${Number(from.longitude)}`);
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - utcMs;
}

/** 旅行先の日付 "YYYY-MM-DD" と時刻 "HH:MM" → UTC の ISO。読めなければ null */
export function localToUtcIso(date: string | null, hm: string, timeZone: string | null): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const t = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!d || !t) return null;
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (!timeZone) return new Date(guess).toISOString();
  try {
    let ms = guess - zoneOffsetMs(guess, timeZone);
    ms = guess - zoneOffsetMs(ms, timeZone);
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

/** 出発の合図の補足(移動の分と出所) */
export function travelLabel(view: Pick<GoNowView, 'travelMinutes' | 'source'>): string {
  if (view.travelMinutes == null) return '登録した移動の出発時刻から';
  const base = `移動 約${view.travelMinutes}分`;
  if (view.source === 'manual') return `${base}(乗換で調べた時刻)`;
  if (view.source === 'segment') return `${base}(登録した移動)`;
  return base;
}

// ---- [Gate TDay-Mock] モックアップの画面の言葉・計算 -------------------------------------------------------------

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** "2026-11-13" → "11/13（金）" */
export function dateLabel(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${Number(m[2])}/${Number(m[3])}（${WEEK[d.getUTCDay()]}）`;
}
const KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export function kanjiNum(n: number): string {
  if (n <= 10) return n === 10 ? '十' : KANJI[n]!;
  if (n < 20) return `十${KANJI[n - 10]}`;
  if (n < 100) return `${KANJI[Math.floor(n / 10)]}十${n % 10 ? KANJI[n % 10] : ''}`;
  return String(n);
}
/** 印に入れる和暦の日付 "令和八年 十一月十三日"(2019-05-01 から令和) */
export function reiwaDate(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!m) return '';
  const y = Number(m[1]) - 2018;
  return `令和${y === 1 ? '元' : kanjiNum(y)}年 ${kanjiNum(Number(m[2]))}月${kanjiNum(Number(m[3]))}日`;
}
/** 雨の時間帯の見出し "14〜16時、雨の可能性 70%"。雨が無ければ null */
export function rainTitle(hours: SkyHour[], fromHour = 0): string | null {
  const w = rainWindow(hours, fromHour);
  return w ? `${w.start}〜${w.end}時、雨の可能性 ${w.max}%` : null;
}
/** 今日の空模様の一行 "晴れ 18° → 14〜16時 雨 70%"(気温・空の言葉は予報の値。無い所は省く) */
export function weatherLine(label: string | null, temp: number | null, hours: SkyHour[], fromHour = 0): string | null {
  const head = [label, temp != null ? `${Math.round(temp)}°` : null].filter(Boolean).join(' ');
  const w = rainWindow(hours, fromHour);
  const rain = w ? `${w.start}〜${w.end}時 雨 ${w.max}%` : null;
  const out = [head || null, rain].filter(Boolean).join(' → ');
  return out || null;
}
/** 2点の距離(km、球面) */
export function distanceKm(a: { latitude: number | null; longitude: number | null },
  b: { latitude: number | null; longitude: number | null }): number | null {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return null;
  const r = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
/** 印を押した場所を順に結んだ道のり(km、直線の和。概算) */
export function walkedKm(events: TodayEvent[], visited: Set<string>): number {
  const pts = events.filter((e) => visited.has(e.id) && e.latitude != null && e.longitude != null);
  let km = 0;
  for (let i = 1; i < pts.length; i += 1) km += distanceKm(pts[i - 1]!, pts[i]!) ?? 0;
  return Math.round(km * 10) / 10;
}
/** 滞在の予定との差 "予定より 2分長く滞在" */
export function stayDiffLabel(plannedStart: string | null, plannedEnd: string | null, actualStart: string | null,
  actualEnd: string | null): string | null {
  if (!plannedStart || !plannedEnd || !actualStart || !actualEnd) return null;
  const p = (Date.parse(plannedEnd) - Date.parse(plannedStart)) / 60_000;
  const a = (Date.parse(actualEnd) - Date.parse(actualStart)) / 60_000;
  if (Number.isNaN(p) || Number.isNaN(a)) return null;
  const d = Math.round(a - p);
  if (d === 0) return '予定どおりの滞在';
  return d > 0 ? `予定より ${d}分長く滞在` : `予定より ${-d}分短く滞在`;
}
/** 着いた時刻と予定の差 "予定より1分遅れ" */
export function arriveDiffLabel(plannedStart: string | null, actual: string | null): string | null {
  if (!plannedStart || !actual) return null;
  const d = Math.round((Date.parse(actual) - Date.parse(plannedStart)) / 60_000);
  if (Number.isNaN(d)) return null;
  if (d === 0) return '予定どおり';
  return d > 0 ? `予定より${d}分遅れ` : `予定より${-d}分早く`;
}
/** 1日だけ閉じる表示(朝・夜の画面を「今日の画面へ」で閉じた) */
export function readDayFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(`tc.today.flag.${key}`) === '1';
  } catch {
    return false;
  }
}
export function writeDayFlag(key: string): void {
  try {
    window.localStorage.setItem(`tc.today.flag.${key}`, '1');
  } catch {
    // 何もしない
  }
}
/** 今日の足跡(位置の設定を ON にした時だけ、この端末に置く。送らない) */
export type TrailPoint = [number, number, number];
const TRAIL_KEY = 'tc.today.trail.';
export function readTrail(planId: string, date: string | null): TrailPoint[] {
  if (!date) return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(`${TRAIL_KEY}${planId}.${date}`) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw.filter((p) => Array.isArray(p) && p.length === 3) as TrailPoint[]) : [];
  } catch {
    return [];
  }
}
export function addTrailPoint(planId: string, date: string | null, p: TrailPoint): TrailPoint[] {
  if (!date) return [];
  const cur = readTrail(planId, date);
  const last = cur[cur.length - 1];
  // 30m より近い点・30秒より短い間隔は足さない(電池と保存の量)
  if (last && distanceKm({ latitude: last[0], longitude: last[1] }, { latitude: p[0], longitude: p[1] })! < 0.03
    && p[2] - last[2] < 30_000) return cur;
  const next = [...cur, p].slice(-2000);
  try {
    window.localStorage.setItem(`${TRAIL_KEY}${planId}.${date}`, JSON.stringify(next));
  } catch {
    // 保存できなくても続ける
  }
  return next;
}
export function clearTrail(planId: string, date: string | null): void {
  try {
    window.localStorage.removeItem(`${TRAIL_KEY}${planId}.${date ?? ''}`);
  } catch {
    // 何もしない
  }
}
/** 同行者に送る文 */
export function shareText(lines: string[]): string {
  return lines.filter(Boolean).join('\n');
}

/** 出発の合図の画面の言葉(段階ごと)。leave/arrive は現地の "HH:MM" */
export function goScreenText(v: GoNowView, leave: string, arrive: string | null, expected: string | null = null): {
  ringTop: string; big: string; head: string; advice: string; primary: string;
} {
  switch (v.stage) {
    case 'relaxed':
      return { ringTop: '出発まで', big: `${v.minutesToLeave}分`, head: `${leave} に出れば大丈夫`,
        advice: 'まだ時間があります。今の場所をもう少し楽しんで。出る10分前にもう一度お知らせします。', primary: 'このまま楽しむ' };
    case 'soon':
      return { ringTop: '出発まで', big: `${v.minutesToLeave}分`, head: 'そろそろ準備を',
        advice: `印を押す・写真を撮るなら今のうちに。${leave} に出ると ${arrive ?? '予定どおり'} に着きます。`, primary: '案内を開く' };
    case 'now':
      return { ringTop: '今', big: '出発', head: `今出れば ${arrive ?? '予定どおり'} 着`,
        advice: '案内を開くと、着くまでの残り時間だけを大きく表示する「移動モード」に切り替わります。', primary: '移動モードで出発' };
    default:
      return { ringTop: '予定より', big: `+${-v.minutesToLeave}分`, head: `${expected ?? arrive ?? ''} 着の見込み`.trim(),
        advice: '予約の時刻を過ぎそうです。お店に連絡するか、後の予定を組み直せます（再計画）。', primary: '後の予定を組み直す' };
  }
}
/** 予定の種類の言葉(印の集まりの見出し) */
export const TYPE_LABEL: Record<string, string> = {
  sightseeing: '見どころ', dining: '食事の場所', accommodation: '宿', transport: '移動', activity: '体験の場所',
  shopping: '買い物の場所', other: '場所',
};
/** 移動の手段の言葉 */
export const MODE_WORD: Record<string, string> = {
  walking: '徒歩', walk: '徒歩', train: '電車', rail: '鉄道', bus: 'バス', driving: '車', car: '車', taxi: 'タクシー',
  bicycle: '自転車', ferry: '船', flight: '飛行機', transit: '電車・バス',
};
export function modeWord(mode: string | null | undefined): string {
  return (mode && MODE_WORD[mode]) || '移動';
}
/** 場所のメモを「着いたら」の手順に分ける(改行・。で区切る。最大6) */
export function noteLines(...texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const line of t.split(/\n|。/)) {
      const v = line.replace(/^\s*(?:[-・*•]|\d+[.)．、])\s*/, '').trim();
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out.slice(0, 6);
}
/** 分の長さ "1時間30分" */
export function durationLabel(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}時間${m ? `${m}分` : ''}` : `${m}分`;
}
