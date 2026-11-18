/**
 * [Gate SpotMode] FR-060 スポットモードの API(backend/app/api/v1/spot_areas.py)。
 * 最初に読む JS を小さく保つため、使う画面(後から読む塊)がここを直接 import する(g4.ts と同じ方針)。
 * 画面の中で失敗を案内するため、共通のエラーの toast は出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, nullable, num, object, oneOf, record, str, type Decoder } from './decode';
import type {
  NearbyKind, NearbyResponse, NearbyResult, SpotArea, SpotAreaInput, SpotAreaItemInput, SpotAreaList, SpotItem,
  SpotSuggestion,
} from './types/spotAreas';
import type { DayHours } from './types/candidates';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const genre = oneOf('food', 'cafe', 'gift', 'sight', 'rest', 'other');
// 営業時間は表示にだけ使うので、形を確かめてそのまま渡す
const hours: Decoder<DayHours | null> = nullable((v, path) => record(v, path) as unknown as DayHours);

const item: Decoder<SpotItem> = object<SpotItem>({
  id: str, candidate_id: str, title: str, note: nullable(str), category: nullable(str), address: nullable(str),
  latitude: nullable(num), longitude: nullable(num), place_id: nullable(str), genre, genre_label: str,
  priority: oneOf('want', 'maybe'), stay_minutes: num, sort_order: num, visited_at: nullable(str),
  visited_by: nullable(str), skipped: bool, wanted_by: arrayOf(str), wanted_by_me: bool, fit: str, seats: bool,
  hours_today: hours,
});

export const spotArea: Decoder<SpotArea> = object<SpotArea>({
  id: str, title: str, day_id: nullable(str), local_date: nullable(str), timezone_id: nullable(str),
  start_time: nullable(str), end_time: nullable(str), meet_label: nullable(str), meet_time: nullable(str),
  meet_latitude: nullable(num), meet_longitude: nullable(num), center_latitude: nullable(num),
  center_longitude: nullable(num), radius_m: num, suggest_on_approach: bool, revision: num, items: arrayOf(item),
  can_edit: bool,
  splits: (v, path) => (v === undefined ? [] : arrayOf(object({
    name: str, is_me: bool, meet_label: nullable(str), meet_time: str, note: nullable(str), since: nullable(str),
  }))(v, path)),
});

const areaList: Decoder<SpotAreaList> = object<SpotAreaList>({
  areas: arrayOf(spotArea), can_edit: bool,
  genres: (v, path) => record(v, path) as Record<string, string>,
});

const suggestion: Decoder<SpotSuggestion> = object<SpotSuggestion>({
  title: str, center_latitude: num, center_longitude: num, radius_m: num,
  candidates: arrayOf(object({ candidate_id: str, title: str, genre })),
});

const nearbyResult: Decoder<NearbyResult> = object<NearbyResult>({
  name: str, address: nullable(str), latitude: num, longitude: num, distance_m: num, walk_minutes: num, genre,
  genre_label: str, category: nullable(str), fit: str, provider: nullable(str), url: nullable(str), in_area: bool,
});

const nearbyResponse: Decoder<NearbyResponse> = object<NearbyResponse>({
  kind: oneOf('all', 'toilet', 'rest', 'cafe', 'sweets', 'food', 'souvenir', 'sight', 'locker'),
  results: arrayOf(nearbyResult), sources: arrayOf(str), failed_providers: arrayOf(str), message: nullable(str),
});

export async function listSpotAreas(planId: string): Promise<SpotAreaList> {
  const r = await api.get(`/plans/${planId}/spot-areas`, SILENT);
  return decodeResponse(r.data, areaList, 'GET /plans/{plan_id}/spot-areas');
}

export async function suggestSpotAreas(planId: string): Promise<SpotSuggestion[]> {
  const r = await api.get(`/plans/${planId}/spot-areas/suggest`, SILENT);
  return decodeResponse(r.data, object({ suggestions: arrayOf(suggestion), within_m: num }),
    'GET /plans/{plan_id}/spot-areas/suggest').suggestions;
}

export async function createSpotArea(planId: string, input: SpotAreaInput): Promise<SpotArea> {
  const r = await api.post(`/plans/${planId}/spot-areas`, input, SILENT);
  return decodeResponse(r.data, spotArea, 'POST /plans/{plan_id}/spot-areas');
}

export async function updateSpotArea(planId: string, areaId: string, input: SpotAreaInput, revision: number): Promise<SpotArea> {
  const r = await api.put(`/plans/${planId}/spot-areas/${areaId}`, input, { ...SILENT, headers: { 'If-Match': String(revision) } });
  return decodeResponse(r.data, spotArea, 'PUT /plans/{plan_id}/spot-areas/{area_id}');
}

export async function deleteSpotArea(planId: string, areaId: string, revision: number): Promise<void> {
  await api.delete(`/plans/${planId}/spot-areas/${areaId}`, { ...SILENT, headers: { 'If-Match': String(revision) } });
}

export async function addSpotItem(planId: string, areaId: string, input: SpotAreaItemInput): Promise<SpotArea> {
  const r = await api.post(`/plans/${planId}/spot-areas/${areaId}/items`, input, SILENT);
  return decodeResponse(r.data, spotArea, 'POST /plans/{plan_id}/spot-areas/{area_id}/items');
}

export async function markSpotVisit(planId: string, areaId: string, itemId: string, skipped = false): Promise<SpotArea> {
  const r = await api.post(`/plans/${planId}/spot-areas/${areaId}/items/${itemId}/visit`, { skipped }, SILENT);
  return decodeResponse(r.data, spotArea, 'POST /plans/{plan_id}/spot-areas/{area_id}/items/{item_id}/visit');
}

export async function clearSpotVisit(planId: string, areaId: string, itemId: string): Promise<SpotArea> {
  const r = await api.delete(`/plans/${planId}/spot-areas/${areaId}/items/${itemId}/visit`, SILENT);
  return decodeResponse(r.data, spotArea, 'DELETE /plans/{plan_id}/spot-areas/{area_id}/items/{item_id}/visit');
}

export async function setSpotWant(planId: string, areaId: string, itemId: string, on: boolean): Promise<SpotArea> {
  const r = on ? await api.put(`/plans/${planId}/spot-areas/${areaId}/items/${itemId}/want`, {}, SILENT)
    : await api.delete(`/plans/${planId}/spot-areas/${areaId}/items/${itemId}/want`, SILENT);
  return decodeResponse(r.data, spotArea, `${on ? 'PUT' : 'DELETE'} /plans/{plan_id}/spot-areas/{area_id}/items/{item_id}/want`);
}

export async function searchNearby(planId: string, areaId: string, input: {
  latitude: number; longitude: number; radius_m: number; within_area: boolean; kind: NearbyKind; query?: string;
}): Promise<NearbyResponse> {
  const r = await api.post(`/plans/${planId}/spot-areas/${areaId}/nearby`, input, SILENT);
  return decodeResponse(r.data, nearbyResponse, 'POST /plans/{plan_id}/spot-areas/{area_id}/nearby');
}

/** [Gate SpotMode-2] 別行動にする(集合の場所・時刻を省くとエリアの集合)。今いる場所は送らない */
export async function splitOff(planId: string, areaId: string, input: { meet_label?: string; meet_time?: string; note?: string }): Promise<SpotArea> {
  const r = await api.put(`/plans/${planId}/spot-areas/${areaId}/split`, input, SILENT);
  return decodeResponse(r.data, spotArea, 'PUT /plans/{plan_id}/spot-areas/{area_id}/split');
}

/** [Gate SpotMode-2] 合流した */
export async function rejoin(planId: string, areaId: string): Promise<SpotArea> {
  const r = await api.delete(`/plans/${planId}/spot-areas/${areaId}/split`, SILENT);
  return decodeResponse(r.data, spotArea, 'DELETE /plans/{plan_id}/spot-areas/{area_id}/split');
}
