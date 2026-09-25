/**
 * [Gate L1b] 当日モード(SC-07、FR-029/030/032)の表示ロジック。
 *
 * backend(app/services/today_mode.py)と同じ規則で、取得済みの今日の予定
 * (TodayResponse.events)から端末側でNOW/NEXTを再計算する。これにより
 * - 30秒ごとの再取得の合間でもNOW/NEXTとカウントダウンが進む
 * - 通信が切れても、保存済みの当日情報から現在時刻に応じたNOW/NEXTを出せる
 * (FR-032 オフライン表示)。
 *
 * 時刻の表示は端末のタイムゾーンではなく、日程のIANAタイムゾーン
 * (TodayResponse.timezone_id)の現地時刻で行う。端末の時計のずれは
 * server_timeとの差(offsetMs)で補正する。
 */
import { decodeResponse } from '@/services/api/decode';
import { todayResponse } from '@/services/api/decoders';
import type { TodayEvent, TodayResponse } from '@/services/api';

export interface TodayView {
  /** 保存済みデータが「今日」(日程タイムゾーン基準)のものか。falseならNOW/NEXTは出さない。 */
  isCurrentDay: boolean;
  nowEvent: TodayEvent | null;
  nextEvent: TodayEvent | null;
  minutesUntilNext: number | null;
  minutesUntilDeparture: number | null;
}

const toMs = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** 指定タイムゾーンでの日付(YYYY-MM-DD)。不正なタイムゾーンはUTC。 */
export function localDateIn(nowMs: number, timeZone: string | null): string {
  const format = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(nowMs)
    );
  try {
    return format(timeZone || 'UTC');
  } catch {
    return format('UTC');
  }
}

/** 日程の現地時刻(HH:MM)で表示する。不正なタイムゾーンは端末の時刻で表示。 */
export function formatTimeInZone(iso: string | null, timeZone: string | null): string {
  const ms = toMs(iso);
  if (ms == null) return '--:--';
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
  try {
    return new Date(ms).toLocaleTimeString('ja-JP', timeZone ? { ...opts, timeZone } : opts);
  } catch {
    return new Date(ms).toLocaleTimeString('ja-JP', opts);
  }
}

export function formatCountdown(minutes: number | null): string {
  if (minutes == null) return '';
  if (minutes <= 0) return 'まもなく';
  if (minutes < 60) return `${minutes}分後`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間後` : `${h}時間${m}分後`;
}

const minutesBetween = (fromMs: number, toMsValue: number) => Math.floor((toMsValue - fromMs) / 60_000);

/** 取得済みの当日情報から、指定時刻(ms、server補正済み)のNOW/NEXTを求める。 */
export function computeTodayView(res: TodayResponse, nowMs: number): TodayView {
  const empty: TodayView = {
    isCurrentDay: true, nowEvent: null, nextEvent: null, minutesUntilNext: null, minutesUntilDeparture: null,
  };
  if (res.today_date && localDateIn(nowMs, res.timezone_id) !== res.today_date) {
    return { ...empty, isCurrentDay: false };
  }

  const timed = res.events
    .map((e) => ({ e, start: toMs(e.start_at), end: toMs(e.end_at) }))
    .filter((t): t is { e: TodayEvent; start: number; end: number | null } => t.start != null)
    .sort((a, b) => a.start - b.start);
  const dayEnd = toMs(res.day_end_at);

  let now: (typeof timed)[number] | null = null;
  for (const t of timed) {
    let end = t.end;
    if (end == null) {
      const later = timed.filter((o) => o.start > t.start).map((o) => o.start);
      end = later.length > 0 ? Math.min(...later) : dayEnd;
    }
    if (t.start <= nowMs && (end == null || nowMs < end) && (now == null || t.start >= now.start)) {
      now = t;
    }
  }

  // NEXTは今日の予定のみ(前日から継続中の予定は現在より前に始まっているため対象外)
  const next = res.today_date ? timed.find((t) => t.start > nowMs) ?? null : null;
  const departure = next ? toMs(next.e.departure_at) : null;

  return {
    isCurrentDay: true,
    nowEvent: now?.e ?? null,
    nextEvent: next?.e ?? null,
    minutesUntilNext: next ? minutesBetween(nowMs, next.start) : null,
    minutesUntilDeparture: departure != null && departure > nowMs ? minutesBetween(nowMs, departure) : null,
  };
}

export const TRANSPORT_LABELS: Record<string, { text: string; className: string } | undefined> = {
  delayed: { text: '遅延', className: 'bg-red-100 text-red-800' },
  cancelled: { text: '運休', className: 'bg-red-600 text-white' },
  on_time: { text: '定刻', className: 'bg-green-100 text-green-800' },
};

// ===== オフライン表示用の保存(端末内のみ。失敗しても表示は継続する) =====

export interface TodayCache {
  payload: TodayResponse;
  savedAt: number;
  offsetMs: number;
}

const cacheKey = (planId: string) => `travelcanvas:today:v1:${planId}`;

export function saveTodayCache(planId: string, payload: TodayResponse, offsetMs: number): void {
  try {
    const value: TodayCache = { payload, savedAt: Date.now(), offsetMs };
    window.localStorage.setItem(cacheKey(planId), JSON.stringify(value));
  } catch {
    // 保存できない環境(プライベートモード・容量超過等)では保存を諦める
  }
}

export function loadTodayCache(planId: string): TodayCache | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(planId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TodayCache>;
    if (typeof parsed.savedAt !== 'number' || typeof parsed.offsetMs !== 'number') return null;
    const payload = decodeResponse(parsed.payload, todayResponse, 'today cache');
    return { payload, savedAt: parsed.savedAt, offsetMs: parsed.offsetMs };
  } catch {
    return null;
  }
}
