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
  notices: { go: boolean; arrive: boolean; rain: boolean; delay: boolean };
  voice: boolean;
  shareEta: boolean;
}
export const SETTINGS_KEY = 'tc.today.live';
export const DEFAULT_SETTINGS: LiveSettings = {
  notices: { go: true, arrive: true, rain: true, delay: true }, voice: false, shareEta: false,
};
export function readSettings(): LiveSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<LiveSettings> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
    return { notices: { ...DEFAULT_SETTINGS.notices, ...(raw.notices ?? {}) }, voice: raw.voice === true,
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

export interface LiveNotice { key: string; kind: 'go' | 'arrive' | 'rain' | 'delay'; title: string; sub: string; action: string; onAction: () => void }

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
