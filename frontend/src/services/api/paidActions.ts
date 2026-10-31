/**
 * [Gate ProviderConnect] 旅行の中で有料の提供元を使う、利用者の明示の操作(backend/app/api/v1/paid_actions.py)。
 * 押した時だけ送る。Idempotency-Key は押した1回ごとに1つ(二重押しで二度送らない)。結果は旅行に保存しない。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, nullable, num, object, oneOf, record, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface PaidPlace {
  provider: string; place_id: string; name: string; address: string | null; latitude: number | null;
  longitude: number | null; maps_uri: string | null;
}
export interface PaidAiResult { result: { text: string; model: string }; usage: Record<string, unknown>; saved: boolean; notice: string }
export interface PaidPlacesResult { results: PaidPlace[]; usage: Record<string, unknown>; saved: boolean; attribution: string; notice: string }
export interface PaidRouteResult {
  result: { duration_minutes: number | null; distance_km: number | null } | null; mode: string;
  usage: Record<string, unknown>; saved: boolean; attribution: string; notice: string;
}
export type PaidRouteMode = 'driving' | 'walking' | 'bicycling' | 'transit';

const place: Decoder<PaidPlace> = object<PaidPlace>({
  provider: str, place_id: str, name: str, address: nullable(str), latitude: nullable(num), longitude: nullable(num),
  maps_uri: nullable(str),
});

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

const headers = (key: string): AxiosRequestConfig => ({ ...SILENT, headers: { 'Idempotency-Key': key } });

export async function paidAiSuggest(planId: string, prompt: string, key: string): Promise<PaidAiResult> {
  const r = await api.post(`/plans/${encodeURIComponent(planId)}/paid/ai-suggest`, { prompt }, headers(key));
  return decodeResponse(r.data, object<PaidAiResult>({
    result: object<{ text: string; model: string }>({ text: str, model: str }), usage: record, saved: bool, notice: str,
  }), 'POST /plans/{id}/paid/ai-suggest');
}

export async function paidPlacesSearch(planId: string, query: string, key: string): Promise<PaidPlacesResult> {
  const r = await api.post(`/plans/${encodeURIComponent(planId)}/paid/places-search`, { query }, headers(key));
  return decodeResponse(r.data, object<PaidPlacesResult>({
    results: arrayOf(place), usage: record, saved: bool, attribution: str, notice: str,
  }), 'POST /plans/{id}/paid/places-search');
}

export async function paidRoute(planId: string, fromEventId: string, toEventId: string, mode: PaidRouteMode,
  key: string): Promise<PaidRouteResult> {
  const r = await api.post(`/plans/${encodeURIComponent(planId)}/paid/route`,
    { from_event_id: fromEventId, to_event_id: toEventId, mode }, headers(key));
  return decodeResponse(r.data, object<PaidRouteResult>({
    result: nullable(object<{ duration_minutes: number | null; distance_km: number | null }>({
      duration_minutes: nullable(num), distance_km: nullable(num) })),
    mode: oneOf('driving', 'walking', 'bicycling', 'transit'), usage: record, saved: bool, attribution: str, notice: str,
  }), 'POST /plans/{id}/paid/route');
}

/** 断られた理由(サーバーの code)。画面は理由を出し、手で続けられることを案内する */
export function paidErrorCode(error: unknown): string | null {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  const code = (detail as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

