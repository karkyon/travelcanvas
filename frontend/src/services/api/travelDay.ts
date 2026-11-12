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
  /** segment: 登録した移動区間の出発時刻 / estimate: 直線距離からの概算 */
  travel_source: 'segment' | 'estimate' | null;
  leave_by: string | null;
  fit: string;
  hours: GuideHours | null;
}
export interface GuideStamp {
  status: 'visited' | 'skipped' | null; revision: number | null; actual_start_at: string | null;
  memory_count: number; photo_count: number;
}
export interface GuideGap { after_event_id: string; before_event_id: string; start_at: string; end_at: string; minutes: number }
export interface GuideUpcoming {
  date: string; days_until: number; day_title: string | null; is_trip_start: boolean;
  first_event_title: string | null; first_event_time: string | null;
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
}

const hours: Decoder<GuideHours> = object<GuideHours>({
  status: oneOf('ok', 'near_close', 'last_entry', 'last_order', 'closes_during', 'closed', 'unknown'),
  reason: nullable(str), window_label: nullable(str), closes_at: nullable(str), minutes_to_close: nullable(int),
  last_entry: nullable(str), last_order: nullable(str), estimated: nullable(bool), stale: nullable(bool),
});
const guideEvent: Decoder<GuideEvent> = object<GuideEvent>({
  event_id: str, place_id: nullable(str), phone: nullable(str), image_memory_id: nullable(str),
  end_at: nullable(str), end_estimated: bool, travel_minutes: nullable(int), travel_mode: nullable(str),
  distance_km: nullable(num), travel_source: nullable(oneOf('segment', 'estimate')), leave_by: nullable(str),
  fit: str, hours: nullable(hours),
});
const stamp: Decoder<GuideStamp> = object<GuideStamp>({
  status: nullable(oneOf('visited', 'skipped')), revision: nullable(int), actual_start_at: nullable(str),
  memory_count: int, photo_count: int,
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
  })),
  next_day: nullable(object<GuideNextDay>({
    date: str, day_title: nullable(str), event_count: int, first_event_title: nullable(str), first_event_time: nullable(str),
  })),
  min_gap_minutes: int,
  events: mapOf(guideEvent),
  gaps: arrayOf(object<GuideGap>({ after_event_id: str, before_event_id: str, start_at: str, end_at: str, minutes: int })),
  stamps: mapOf(stamp),
  metrics: object({ visited: int, total: int, photos: int, notes: int }),
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
  visibility: 'private' | 'members'; place_name: string | null }) {
  return api.createMemory(planId, { kind: 'note', body: input.body, event_id: input.event_id, day_id: input.day_id,
    visibility: input.visibility, place_name: input.place_name, occurred_at: new Date().toISOString() });
}
/** 写真・声の記録 */
export async function addMedia(planId: string, input: { kind: 'photo' | 'audio'; file: File; event_id: string;
  day_id: string | null; body: string | null; visibility: 'private' | 'members'; place_name: string | null }) {
  return api.uploadMemory(planId, { ...input, occurred_at: new Date().toISOString() });
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
