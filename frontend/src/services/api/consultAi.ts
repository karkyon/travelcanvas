/**
 * [Gate ConsultAI] 旅行相談で外部の提供元を使う口(backend/app/api/v1/trip_intents.py の /trip-intents/ai/*)。
 * 押した時だけ送る。Idempotency-Key は押した1回ごとに1つ。結果は保存しない(AI は「未確認」、Google は帰属を出す)。
 * 鍵は画面へ来ない(サーバーだけが持つ)。画面の中で失敗を案内するため、共通のエラーの toast は出さない。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import {
  arrayOf, bool, decodeResponse, int, nullable, num, object, oneOf, optional, str, type Decoder,
} from './decode';
import type { ExtractInput, IntentExtraction, IntentItem, IntentQuestion } from './types/tripIntent';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const withKey = (key: string): AxiosRequestConfig => ({ ...SILENT, headers: { 'Idempotency-Key': key } });
const anyValue: Decoder<unknown> = (v) => v;

export type ConsultOperation = 'ai.generate' | 'places.search' | 'routes.element';

export interface ConsultOperationStatus {
  provider: string; included: boolean; key_ready: boolean; suspended: boolean; reason: string | null; ready: boolean;
}

export interface ConsultUsage {
  currency: string; plan_cap: string; plan_used: string; plan_reserved: string; plan_remaining: string;
  class: string; scope?: string;
}

export interface ConsultAiStatus {
  class: string; class_label: string; consent: { ai_processing: boolean };
  operations: Record<ConsultOperation, ConsultOperationStatus>;
  stub: boolean; model: string; max_text_chars: number; usage?: ConsultUsage; session_error?: string | null;
}

export interface AiExtraction extends IntentExtraction {
  suggested_areas: Array<{ name: string; reason: string; source: 'ai_suggested' }>;
  unknowns: string[];
  /** [Gate ConsultAI] 決まった項目に分けられない希望(その他) */
  notes: string[];
  /** [Gate AdminUAT U05] 食い違う希望(AI は片方に決めない。利用者に確かめる) */
  contradictions?: string[];
  model: string;
  usage: ConsultUsage;
  notice: string;
  stub: boolean;
}

export interface ConsultPlace {
  provider: string; place_id: string; name: string; address: string | null; latitude: number | null;
  longitude: number | null; maps_uri: string | null;
}

export interface ConsultPlacesResult {
  results: ConsultPlace[]; usage: ConsultUsage; attribution: string; retrieved_at: string; notice: string; stub: boolean;
}

export interface ConsultRouteResult {
  result: { duration_minutes: number | null; distance_km: number | null } | null; mode: string; usage: ConsultUsage;
  attribution: string; retrieved_at: string; notice: string; stub: boolean;
}

export type ConsultRouteMode = 'driving' | 'walking' | 'bicycling' | 'transit';

const usage: Decoder<ConsultUsage> = object<ConsultUsage>({
  currency: str, plan_cap: str, plan_used: str, plan_reserved: str, plan_remaining: str, class: str,
  scope: optional(str),
});

const opStatus: Decoder<ConsultOperationStatus> = object<ConsultOperationStatus>({
  provider: str, included: bool, key_ready: bool, suspended: bool, reason: nullable(str), ready: bool,
});

const status: Decoder<ConsultAiStatus> = object<ConsultAiStatus>({
  class: str, class_label: str, consent: object<{ ai_processing: boolean }>({ ai_processing: bool }),
  operations: object<Record<ConsultOperation, ConsultOperationStatus>>({
    'ai.generate': opStatus, 'places.search': opStatus, 'routes.element': opStatus,
  }),
  stub: bool, model: str, max_text_chars: int, usage: optional(usage), session_error: optional(nullable(str)),
});

const question: Decoder<IntentQuestion> = object<IntentQuestion>({
  id: oneOf('one_way_strength', 'budget_scope', 'party_size'), text: str,
  options: arrayOf(object<{ value: string; label: string }>({ value: str, label: str })),
  suggested: nullable(str), hint: nullable(str),
});

const item: Decoder<IntentItem> = object<IntentItem>({
  key: str, label: str, value: anyValue, display: str, source: oneOf('user_input', 'text', 'unspecified', 'ai'),
  strength: oneOf('required', 'preferred', 'undecided'), evidence: nullable(str), question: nullable(question),
  needs_answer: bool, note: nullable(str), sensitive: bool,
});

const extraction: Decoder<AiExtraction> = object<AiExtraction>({
  items: arrayOf(item),
  areas: arrayOf(object<{ name: string; source: 'user_input' }>({ name: str, source: oneOf('user_input') })),
  suggested_areas: arrayOf(object<{ name: string; reason: string; source: 'ai_suggested' }>({
    name: str, reason: str, source: oneOf('ai_suggested') })),
  unknowns: arrayOf(str), notes: arrayOf(str), contradictions: optional(arrayOf(str)), nights: nullable(int), extractor: str, ai_connected: bool, model: str, usage,
  notice: str, stub: bool,
});

const place: Decoder<ConsultPlace> = object<ConsultPlace>({
  provider: str, place_id: str, name: str, address: nullable(str), latitude: nullable(num), longitude: nullable(num),
  maps_uri: nullable(str),
});

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export async function startConsult(): Promise<{ session_id: string; expires_at: string }> {
  const r = await api.post('/trip-intents/ai/session', {}, SILENT);
  return decodeResponse(r.data, object<{ session_id: string; expires_at: string }>({ session_id: str, expires_at: str }),
    'POST /trip-intents/ai/session');
}

export async function getConsultAiStatus(sessionId: string | null): Promise<ConsultAiStatus> {
  const r = await api.get('/trip-intents/ai/status', { ...SILENT, params: sessionId ? { session_id: sessionId } : {} });
  return decodeResponse(r.data, status, 'GET /trip-intents/ai/status');
}

export async function aiExtract(sessionId: string, input: ExtractInput, key: string): Promise<AiExtraction> {
  const r = await api.post('/trip-intents/ai/extract', { ...input, session_id: sessionId }, withKey(key));
  return decodeResponse(r.data, extraction, 'POST /trip-intents/ai/extract');
}

export async function consultPlaces(sessionId: string, query: string, at: { latitude: number; longitude: number } | null,
  key: string, radiusKm?: number): Promise<ConsultPlacesResult> {
  const r = await api.post('/trip-intents/ai/places-search',
    { session_id: sessionId, query, ...(at ?? {}), ...(at && radiusKm ? { radius_km: radiusKm } : {}) }, withKey(key));
  return decodeResponse(r.data, object<ConsultPlacesResult>({
    results: arrayOf(place), usage, attribution: str, retrieved_at: str, notice: str, stub: bool,
  }), 'POST /trip-intents/ai/places-search');
}

export async function consultRoute(sessionId: string, origin: { latitude: number; longitude: number },
  dest: { latitude: number; longitude: number }, mode: ConsultRouteMode, key: string): Promise<ConsultRouteResult> {
  const r = await api.post('/trip-intents/ai/route', {
    session_id: sessionId, origin_latitude: origin.latitude, origin_longitude: origin.longitude,
    dest_latitude: dest.latitude, dest_longitude: dest.longitude, mode }, withKey(key));
  return decodeResponse(r.data, object<ConsultRouteResult>({
    result: nullable(object<{ duration_minutes: number | null; distance_km: number | null }>({
      duration_minutes: nullable(num), distance_km: nullable(num) })),
    mode: str, usage, attribution: str, retrieved_at: str, notice: str, stub: bool,
  }), 'POST /trip-intents/ai/route');
}

/** 断られた理由の code(画面は理由を出し、AI を使わずに続けられると案内する) */
export function consultErrorCode(error: unknown): string | null {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  const code = (detail as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : null;
}
