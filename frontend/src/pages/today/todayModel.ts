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
import { loadSnapshot, saveSnapshot, type OfflineSession } from '@/utils/offlineVault';
import { safeExternalUrl } from '@/utils/safeNavigation';

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

/** [Gate G10-UX] 予定の地図の URL(座標が無ければ null) */
export function mapUrl(event: TodayEvent): string | null {
  if (event.latitude == null || event.longitude == null) return null;
  return safeExternalUrl(`https://www.google.com/maps/search/?api=1&query=${Number(event.latitude)},${Number(event.longitude)}`);
}

/** [Gate G10-UX] 予定の時刻(終わりがあれば「開始 〜 終わり」) */
export function timeRange(event: TodayEvent, timeZone: string | null): string {
  const start = formatTimeInZone(event.start_at, timeZone);
  return event.end_at ? `${start} 〜 ${formatTimeInZone(event.end_at, timeZone)}` : start;
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

/**
 * [Gate G10-UX] UX-5 当日の画面の流れ: 今の予定の進み具合(終わりが分かる時)と、NEXT の後の今日の予定・終わった数。
 * 終わりの時刻は computeTodayView と同じ考え方(end_at、無ければ次の予定の開始、それも無ければ現地の翌日0時)。
 */
export interface TodayFlow {
  /** 今の予定の残り(分)と進み(0〜100)。終わりが分からなければ null */
  nowProgress: { minutesLeft: number; percent: number } | null;
  /** NEXT より後の今日の予定(時刻順) */
  later: TodayEvent[];
  /** 今日すでに終わった予定の数(前日から続く予定は除く) */
  doneCount: number;
}

export function computeTodayFlow(res: TodayResponse, view: TodayView, nowMs: number): TodayFlow {
  const timed = res.events
    .map((e) => ({ e, start: toMs(e.start_at), end: toMs(e.end_at) }))
    .filter((t): t is { e: TodayEvent; start: number; end: number | null } => t.start != null)
    .sort((a, b) => a.start - b.start);
  const dayEnd = toMs(res.day_end_at);
  const endOf = (t: (typeof timed)[number]): number | null => {
    if (t.end != null) return t.end;
    const later = timed.filter((o) => o.start > t.start).map((o) => o.start);
    return later.length > 0 ? Math.min(...later) : dayEnd;
  };
  let nowProgress: TodayFlow['nowProgress'] = null;
  const nowT = view.nowEvent ? timed.find((t) => t.e.id === view.nowEvent!.id) ?? null : null;
  if (nowT) {
    const end = endOf(nowT);
    if (end != null && end > nowT.start) {
      const percent = Math.min(100, Math.max(0, Math.round(((nowMs - nowT.start) / (end - nowT.start)) * 100)));
      nowProgress = { minutesLeft: Math.max(0, Math.ceil((end - nowMs) / 60_000)), percent };
    }
  }
  const nextT = view.nextEvent ? timed.find((t) => t.e.id === view.nextEvent!.id) ?? null : null;
  const later = nextT
    ? timed.filter((t) => t.start > nextT.start && t.e.id !== view.nowEvent?.id).map((t) => t.e)
    : [];
  const todayStart = res.today_date ? timed.filter((t) => localDateIn(t.start, res.timezone_id) === res.today_date) : [];
  const doneCount = todayStart.filter((t) => {
    const end = endOf(t);
    return t.e.id !== view.nowEvent?.id && end != null && end <= nowMs;
  }).length;
  return { nowProgress, later, doneCount };
}

/** [Gate G10-UX] UX-5 状態は色だけで伝えない(文字を必ず付ける)。暗い見た目でも読める決まりの色 */
export const TRANSPORT_LABELS: Record<string, { text: string; className: string } | undefined> = {
  delayed: { text: '遅延', className: 'bg-danger-soft text-danger border border-danger' },
  cancelled: { text: '運休', className: 'bg-danger-solid text-white' },
  on_time: { text: '定刻', className: 'bg-success-soft text-success border border-success' },
};

// ===== オフライン表示用の保存(端末内のみ。失敗しても表示は継続する) =====
// [Gate K1] 以前は localStorage に平文で保存していた(予定名・場所・時刻が端末に読める形で残った)。
// 今は offlineVault で暗号化して IndexedDB に保存し、ログアウト後・失効後は開けない。
// 古い平文の保存は、保存・読み込みのたびに消す。

export interface TodayCache {
  payload: TodayResponse;
  savedAt: number;
  offsetMs: number;
}

const legacyCacheKey = (planId: string) => `travelcanvas:today:v1:${planId}`;
const snapshotName = (planId: string) => `today:${planId}`;

function removeLegacyPlaintext(planId: string): void {
  try {
    window.localStorage.removeItem(legacyCacheKey(planId));
  } catch {
    // localStorage が使えない環境では何も残っていない
  }
}

export async function saveTodayCache(
  session: OfflineSession | null, planId: string, payload: TodayResponse, offsetMs: number,
): Promise<boolean> {
  removeLegacyPlaintext(planId);
  return saveSnapshot(session, snapshotName(planId), { payload, savedAt: Date.now(), offsetMs } satisfies TodayCache);
}

export async function loadTodayCache(session: OfflineSession | null, planId: string): Promise<TodayCache | null> {
  removeLegacyPlaintext(planId);
  const snapshot = await loadSnapshot<Partial<TodayCache>>(session, snapshotName(planId));
  if (!snapshot) return null;
  try {
    const parsed = snapshot.data;
    if (typeof parsed.savedAt !== 'number' || typeof parsed.offsetMs !== 'number') return null;
    const payload = decodeResponse(parsed.payload, todayResponse, 'today cache');
    return { payload, savedAt: parsed.savedAt, offsetMs: parsed.offsetMs };
  } catch {
    return null;
  }
}
