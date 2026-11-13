/**
 * [Gate TDay] 旅の当日「旅帖ライブ」の API(backend/app/api/v1/today_live.py)。
 * 最初に読む JS を小さく保つため CompleteTravelAPI には足さず、当日の画面(後から読む)だけがここを import する。
 *
 * - GET    /plans/{id}/today/guide    : 出発の合図(出る時刻と出所)・営業の照合・すきま時間・旅帖の印・何日目か・旅の前
 * - POST   /plans/{id}/today/detours  : すきま時間の寄り道の候補(保存しない)
 * - GET/PUT/DELETE /plans/{id}/today/eta : 同行者への到着予定の共有(位置は送らない・期限つき)
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import {
  arrayOf, bool, decodeResponse, int, nullable, num, object, oneOf, optional, record, str, type Decoder,
} from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export type HoursStatus = 'ok' | 'near_close' | 'last_entry' | 'last_order' | 'closes_during' | 'closed' | 'unknown';
export interface GuideHours {
  status: HoursStatus; reason: string | null; window_label: string | null; closes_at: string | null;
  minutes_to_close: number | null; last_entry: string | null; last_order: string | null;
  estimated: boolean | null; stale: boolean | null;
}
export interface GuideEvent {
  event_id: string;
  place_id: string | null;
  phone: string | null;
  image_memory_id: string | null;
  end_at: string | null;
  end_estimated: boolean;
  travel_minutes: number | null;
  travel_mode: string | null;
  distance_km: number | null;
  /** segment: 登録した移動区間の出発時刻 / manual: 乗換を調べて入れた所要時間 / estimate: 概算 */
  travel_source: 'segment' | 'manual' | 'estimate' | null;
  leave_by: string | null;
  fit: string;
  hours: GuideHours | null;
  /** [Gate TDay-Transit] 予定の開始(UTC)・一つ前の(位置のある)予定・この予定へ向かう区間 */
  start_at: string | null;
  from_event_id: string | null;
  segment_id: string | null;
  segment_revision: number | null;
  segment_departure_at: string | null;
  /** [Gate TDay-Mock] 入口・目印(場所のメモ)・場所のメモ・自分のメモ(予定の説明)・この予定の写真(最大6)・最新のひとこと */
  entrance_note?: string | null;
  place_note?: string | null;
  memo?: string | null;
  photo_ids?: string[];
  note_text?: string | null;
  audio_count?: number;
}
export interface GuideStamp {
  status: 'visited' | 'skipped' | null; revision: number | null; actual_start_at: string | null;
  actual_end_at?: string | null;
  memory_count: number; photo_count: number;
}
export interface GuideBookingRes {
  id: string; type: string; type_label: string; status: string; provider_name: string | null; guest_count: number | null;
  start: string | null; end: string | null;
}
export interface GuideBooking { state: 'booked' | 'issue'; issues: string[]; reservations: GuideBookingRes[] }
export interface GuideLodging {
  event_id: string; title: string; start_at: string | null; address: string | null; phone: string | null;
  latitude: number | null; longitude: number | null; check_in: string | null; booking: 'booked' | 'issue' | null;
  guest_count: number | null; nights: number | null; notes: string | null; memo: string | null; entrance_note: string | null;
}
export interface GuideDayPhoto { id: string; event_id: string; at: string | null }
export interface GuideTrip {
  days: number; stamps: { event_id: string; title: string; event_type: string }[]; stamp_count: number;
  photos: number; notes: number; missed: { event_id: string; title: string }[];
}
export interface GuidePrevDay { date: string; title: string | null; visited: number; photos: number }
export interface GuideGap { after_event_id: string; before_event_id: string; start_at: string; end_at: string; minutes: number }
export interface GuideUpcoming {
  date: string; days_until: number; day_title: string | null; is_trip_start: boolean;
  first_event_title: string | null; first_event_time: string | null;
  /** [Gate TDay-Mock] その日の時刻のある予定の数 */
  event_count?: number;
}
export interface GuideNextDay {
  date: string; day_title: string | null; event_count: number; first_event_title: string | null;
  first_event_time: string | null;
}
export interface TodayGuide {
  plan_id: string;
  server_time: string;
  day_id: string | null;
  day_title: string | null;
  local_date: string | null;
  timezone_id: string | null;
  day_index: number | null;
  day_count: number;
  is_last_day: boolean;
  upcoming: GuideUpcoming | null;
  /** 明日(次の日)のチラ見せ */
  next_day: GuideNextDay | null;
  min_gap_minutes: number;
  events: Record<string, GuideEvent>;
  gaps: GuideGap[];
  stamps: Record<string, GuideStamp>;
  metrics: { visited: number; total: number; photos: number; notes: number };
  /** [Gate TDay-Mock] 予約(予約済み・要確認)・今日の宿・今日の写真・旅全体(最終日)・前の日 */
  bookings?: Record<string, GuideBooking>;
  lodging?: GuideLodging | null;
  day_photos?: GuideDayPhoto[];
  trip?: GuideTrip | null;
  prev_day?: GuidePrevDay | null;
}

const hours: Decoder<GuideHours> = object<GuideHours>({
  status: oneOf('ok', 'near_close', 'last_entry', 'last_order', 'closes_during', 'closed', 'unknown'),
  reason: nullable(str), window_label: nullable(str), closes_at: nullable(str), minutes_to_close: nullable(int),
  last_entry: nullable(str), last_order: nullable(str), estimated: nullable(bool), stale: nullable(bool),
});
const guideEvent: Decoder<GuideEvent> = object<GuideEvent>({
  event_id: str, place_id: nullable(str), phone: nullable(str), image_memory_id: nullable(str),
  end_at: nullable(str), end_estimated: bool, travel_minutes: nullable(int), travel_mode: nullable(str),
  distance_km: nullable(num), travel_source: nullable(oneOf('segment', 'manual', 'estimate')), leave_by: nullable(str),
  fit: str, hours: nullable(hours), start_at: nullable(str), from_event_id: nullable(str), segment_id: nullable(str),
  segment_revision: nullable(int), segment_departure_at: nullable(str),
  entrance_note: optional(nullable(str)) as Decoder<string | null | undefined>,
  place_note: optional(nullable(str)) as Decoder<string | null | undefined>,
  memo: optional(nullable(str)) as Decoder<string | null | undefined>,
  photo_ids: optional(arrayOf(str)) as Decoder<string[] | undefined>,
  note_text: optional(nullable(str)) as Decoder<string | null | undefined>,
  audio_count: optional(int) as Decoder<number | undefined>,
});
const stamp: Decoder<GuideStamp> = object<GuideStamp>({
  status: nullable(oneOf('visited', 'skipped')), revision: nullable(int), actual_start_at: nullable(str),
  actual_end_at: optional(nullable(str)) as Decoder<string | null | undefined>,
  memory_count: int, photo_count: int,
});
const bookingRes: Decoder<GuideBookingRes> = object<GuideBookingRes>({
  id: str, type: str, type_label: str, status: str, provider_name: nullable(str), guest_count: nullable(int),
  start: nullable(str), end: nullable(str),
});
const booking: Decoder<GuideBooking> = object<GuideBooking>({
  state: oneOf('booked', 'issue'), issues: arrayOf(str), reservations: arrayOf(bookingRes),
});
const lodging: Decoder<GuideLodging> = object<GuideLodging>({
  event_id: str, title: str, start_at: nullable(str), address: nullable(str), phone: nullable(str),
  latitude: nullable(num), longitude: nullable(num), check_in: nullable(str), booking: nullable(oneOf('booked', 'issue')),
  guest_count: nullable(int), nights: nullable(int), notes: nullable(str), memo: nullable(str), entrance_note: nullable(str),
});
const trip: Decoder<GuideTrip> = object<GuideTrip>({
  days: int, stamps: arrayOf(object({ event_id: str, title: str, event_type: str })), stamp_count: int, photos: int,
  notes: int, missed: arrayOf(object({ event_id: str, title: str })),
});
const mapOf = <T>(d: Decoder<T>): Decoder<Record<string, T>> => (v, path) => {
  const raw = record(v, path);
  return Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, d(x, `${path}.${k}`)]));
};
export const todayGuide: Decoder<TodayGuide> = object<TodayGuide>({
  plan_id: str, server_time: str, day_id: nullable(str), day_title: nullable(str), local_date: nullable(str),
  timezone_id: nullable(str), day_index: nullable(int), day_count: int, is_last_day: bool,
  upcoming: nullable(object<GuideUpcoming>({
    date: str, days_until: int, day_title: nullable(str), is_trip_start: bool,
    first_event_title: nullable(str), first_event_time: nullable(str),
    event_count: optional(int) as Decoder<number | undefined>,
  })),
  next_day: nullable(object<GuideNextDay>({
    date: str, day_title: nullable(str), event_count: int, first_event_title: nullable(str), first_event_time: nullable(str),
  })),
  min_gap_minutes: int,
  events: mapOf(guideEvent),
  gaps: arrayOf(object<GuideGap>({ after_event_id: str, before_event_id: str, start_at: str, end_at: str, minutes: int })),
  stamps: mapOf(stamp),
  metrics: object({ visited: int, total: int, photos: int, notes: int }),
  bookings: optional((v, path) => mapOf(booking)(v, path)) as Decoder<Record<string, GuideBooking> | undefined>,
  lodging: optional(nullable(lodging)) as Decoder<GuideLodging | null | undefined>,
  day_photos: optional(arrayOf(object<GuideDayPhoto>({ id: str, event_id: str, at: nullable(str) }))) as Decoder<GuideDayPhoto[] | undefined>,
  trip: optional(nullable(trip)) as Decoder<GuideTrip | null | undefined>,
  prev_day: optional(nullable(object<GuidePrevDay>({ date: str, title: nullable(str), visited: int, photos: int }))) as Decoder<GuidePrevDay | null | undefined>,
});

export async function getTodayGuide(planId: string): Promise<TodayGuide> {
  const r = await api.get(`/plans/${planId}/today/guide`, SILENT);
  return decodeResponse(r.data, todayGuide, 'GET /plans/{id}/today/guide');
}

export type DetourKind = 'all' | 'cafe' | 'sweets' | 'indoor' | 'surprise';
export interface DetourCandidate {
  name: string; address: string | null; latitude: number | null; longitude: number | null; distance_km: number | null;
  genre_label: string | null; category: string | null; provider: string | null; url: string | null; fit: string;
}
export interface DetourResult {
  kind: DetourKind; candidates: DetourCandidate[]; region: { label: string; radius_km: number | null } | null;
  message: string | null;
}
const detourResult: Decoder<DetourResult> = object<DetourResult>({
  kind: oneOf('all', 'cafe', 'sweets', 'indoor', 'surprise'),
  candidates: arrayOf(object<DetourCandidate>({
    name: str, address: optional(nullable(str)) as Decoder<string | null>, latitude: nullable(num), longitude: nullable(num),
    distance_km: nullable(num), genre_label: optional(nullable(str)) as Decoder<string | null>,
    category: optional(nullable(str)) as Decoder<string | null>, provider: optional(nullable(str)) as Decoder<string | null>,
    url: optional(nullable(str)) as Decoder<string | null>, fit: str,
  })),
  region: nullable(object({ label: str, radius_km: nullable(num) })),
  message: optional(nullable(str)) as Decoder<string | null>,
});

export async function findDetours(planId: string, body: {
  after_event_id?: string | null; before_event_id?: string | null; kind: DetourKind;
}): Promise<DetourResult> {
  const r = await api.post(`/plans/${planId}/today/detours`, body, SILENT);
  const out = decodeResponse(r.data, detourResult, 'POST /plans/{id}/today/detours');
  return { ...out, candidates: out.candidates.map((c) => ({ ...c, address: c.address ?? null, genre_label: c.genre_label ?? null,
    category: c.category ?? null, provider: c.provider ?? null, url: c.url ?? null })), message: out.message ?? null };
}

export interface EtaShare {
  user_id: string; label: string; is_self: boolean; event_id: string; event_title: string; arrive_at: string;
  planned_start_at: string | null; delay_minutes: number | null; until: string;
}
export interface EtaState { plan_id: string; shares: EtaShare[]; max_hours: number; notice: string }
const etaState: Decoder<EtaState> = object<EtaState>({
  plan_id: str, max_hours: int, notice: str,
  shares: arrayOf(object<EtaShare>({
    user_id: str, label: str, is_self: bool, event_id: str, event_title: str, arrive_at: str,
    planned_start_at: nullable(str), delay_minutes: nullable(int), until: str,
  })),
});

export async function getEta(planId: string): Promise<EtaState> {
  return decodeResponse((await api.get(`/plans/${planId}/today/eta`, SILENT)).data, etaState, 'GET /plans/{id}/today/eta');
}
export async function putEta(planId: string, body: { event_id: string; arrive_at: string; until: string }): Promise<EtaState> {
  return decodeResponse((await api.put(`/plans/${planId}/today/eta`, body, SILENT)).data, etaState, 'PUT /plans/{id}/today/eta');
}
export async function deleteEta(planId: string): Promise<void> {
  await api.delete(`/plans/${planId}/today/eta`, SILENT);
}

// ---- 既存の API(当日の画面の操作に使う物)を、この画面からはここ経由で呼ぶ ------------------------------------

/** 旅帖の印を押す = 予定の実績を「行った」(到着の時刻つき)にする。PUT /plans/{id}/journey/events/{event_id} */
export async function pressStamp(planId: string, eventId: string, at: string, revision: number | null) {
  return api.putEventActual(planId, eventId, { status: 'visited', actual_start_at: at, source: 'manual' },
    revision ?? undefined);
}
/** 印を取り消す(実績を消す) */
export async function removeStamp(planId: string, eventId: string) {
  return api.deleteEventActual(planId, eventId);
}
/** この場所のひとこと(メモ) */
export async function addNote(planId: string, input: { event_id: string; day_id: string | null; body: string;
  visibility: 'private' | 'members'; place_name: string | null; include_in_journal?: boolean }) {
  return api.createMemory(planId, { kind: 'note', body: input.body, event_id: input.event_id, day_id: input.day_id,
    visibility: input.visibility, place_name: input.place_name, occurred_at: new Date().toISOString(),
    ...(input.include_in_journal != null ? { include_in_journal: input.include_in_journal } : {}) });
}
/** 写真・声の記録 */
export async function addMedia(planId: string, input: { kind: 'photo' | 'audio'; file: File; event_id: string;
  day_id: string | null; body: string | null; visibility: 'private' | 'members'; place_name: string | null;
  include_in_journal?: boolean }) {
  return api.uploadMemory(planId, { ...input, occurred_at: new Date().toISOString() });
}
/** [Gate TDay-Mock] 行けなかった場所を「次の旅の候補」(候補箱・行きたい場所リスト)に残す */
export async function keepForNextTrip(planId: string, input: { title: string; address: string | null;
  latitude: number | null; longitude: number | null }) {
  return api.post(`/plans/${planId}/candidates`, {
    title: input.title, note: '旅の当日に行けなかった場所', priority: 2,
    ...(input.address ? { address: input.address } : {}),
    ...(input.latitude != null && input.longitude != null ? { latitude: input.latitude, longitude: input.longitude } : {}),
  }, SILENT);
}
/** 寄り道を旅程に足す(POST /plans/{id}/events)。時刻は旅行先の現地時間の "HH:MM" */
export async function addDetourEvent(planId: string, input: { day_id: string; title: string; local_start_time: string;
  local_end_time: string; address: string | null; latitude: number | null; longitude: number | null }) {
  const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tday-${Date.now()}`;
  return api.createEvent(planId, {
    day_id: input.day_id, title: input.title, event_type: 'sightseeing', local_start_time: input.local_start_time,
    local_end_time: input.local_end_time, ...(input.address ? { address: input.address } : {}),
    ...(input.latitude != null && input.longitude != null ? { latitude: input.latitude, longitude: input.longitude } : {}),
  }, key);
}

/**
 * [Gate TDay-Transit] 乗換を調べて分かった時刻を、この予定へ向かう移動区間に入れる(以後は概算ではなくこの時刻で
 * 出発の合図を出す)。区間が無ければ一つ前の予定からの区間を作る。所要時間は手で入れた値(provider=manual)になる。
 */
export async function saveTransitTime(planId: string, input: {
  to_event_id: string; from_event_id: string | null; segment_id: string | null; segment_revision: number | null;
  mode: 'train' | 'bus' | 'mixed' | 'walking' | 'taxi'; duration_minutes: number; departure_at: string | null;
}) {
  const data = { mode: input.mode, duration_minutes: input.duration_minutes,
    ...(input.departure_at ? { planned_departure_at: input.departure_at } : {}) };
  if (input.segment_id && input.segment_revision != null) {
    return api.updateSegment(planId, input.segment_id, data, input.segment_revision);
  }
  if (!input.from_event_id) throw new Error('一つ前の予定の場所が無いため、区間を作れません');
  const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tday-seg-${Date.now()}`;
  return api.createSegment(planId, { from_event_id: input.from_event_id, to_event_id: input.to_event_id, ...data }, key);
}
