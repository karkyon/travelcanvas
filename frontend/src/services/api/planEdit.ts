/**
 * [Gate PlanSpotEdit] 旅程のスポットの編集で使う API(旅程の画面と一緒に後から読む)。
 * - 1 日の並べ替え(スポットだけを入れ替え、時刻・移動手段は位置に残す。1 回の「元に戻す」で全部戻る)
 * - 場所の情報(住所・電話番号・種類)を OpenStreetMap から読む(保存しない。出典を必ず示す)
 */
import { api } from './index';
import { decodeResponse, int, object } from './decode';
import { normalizedDay } from './decodersCore';
import type { NormalizedDay } from './types/plans';

const SILENT = { skipGlobalErrorHandler: true };

export interface DayReorderResult { revision: number; day: NormalizedDay }

const dayReorderResult = object<DayReorderResult>({ revision: int, day: normalizedDay });

export async function reorderDay(planId: string, dayId: string, order: string[], ifMatch: number,
  keepSlots = true): Promise<DayReorderResult> {
  const response = await api.post(`/plans/${planId}/days/${dayId}/reorder`, { order, keep_slots: keepSlots },
    { ...SILENT, headers: { 'If-Match': String(ifMatch) } });
  return decodeResponse(response.data, dayReorderResult, 'POST /plans/{plan_id}/days/{day_id}/reorder');
}

export interface PlaceInfoCandidate {
  name: string | null; address: string | null; phone: string | null; website: string | null;
  category: 'sightseeing' | 'activity' | 'dining' | 'shopping' | 'accommodation' | 'transportation' | null;
  osm_type: string | null; latitude: number | null; longitude: number | null; source_url: string | null;
}
export interface PlaceInfoResult {
  provider: 'nominatim'; attribution: string; license: string; license_url: string;
  candidates: PlaceInfoCandidate[]; cached: boolean; unavailable: boolean; error_code: string | null;
}

export async function getPlaceInfo(input: { name?: string | null; latitude?: number | null; longitude?: number | null }):
  Promise<PlaceInfoResult> {
  const body = {
    name: input.name?.trim() || null,
    latitude: typeof input.latitude === 'number' ? input.latitude : null,
    longitude: typeof input.longitude === 'number' ? input.longitude : null,
  };
  return (await api.post('/spots/place-info', body, SILENT)).data as PlaceInfoResult;
}
