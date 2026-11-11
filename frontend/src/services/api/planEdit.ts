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
  keepSlots = true, extra?: { parents?: Record<string, string | null>; times?: Record<string, { start: string; end?: string | null }> },
): Promise<DayReorderResult> {
  // [Gate AreaDrag] エリアの出し入れ・時刻の付け直しは並びと一緒に送る(1 回の「元に戻す」で全部戻る)
  const body = { order, keep_slots: keepSlots, ...(extra?.parents ? { parents: extra.parents } : {}),
    ...(extra?.times && Object.keys(extra.times).length ? { times: extra.times } : {}) };
  const response = await api.post(`/plans/${planId}/days/${dayId}/reorder`, body,
    { ...SILENT, headers: { 'If-Match': String(ifMatch) } });
  return decodeResponse(response.data, dayReorderResult, 'POST /plans/{plan_id}/days/{day_id}/reorder');
}

import type { DiningInfo } from '@/components/dining/diningModel';
import type { ExternalImage } from './types/g11discover';

export interface PlaceInfoCandidate {
  name: string | null; address: string | null; phone: string | null; website: string | null;
  category: 'sightseeing' | 'activity' | 'dining' | 'shopping' | 'accommodation' | 'transportation' | null;
  osm_type: string | null; latitude: number | null; longitude: number | null; source_url: string | null;
  /** [Gate SpotInfo] 食事の情報(OpenStreetMap のタグから読めた分)と、写真の手がかり */
  dining?: DiningInfo | null; photo_file?: string | null; wikidata?: string | null;
  /** [Gate PlaceLookupJP] 予約・紹介のページ(楽天トラベル・ホットペッパー)・メモに足す情報(チェックイン/アウト・駐車場など)・使った提供元 */
  links?: { url: string; label: string | null }[]; notes?: string[]; providers?: string[];
  /** [Gate PlaceTripArea] 選ぶ手がかり: 近くの位置(予定・旅行先)からの距離・名前の合い方(0〜1)・住所の細かさ(1 市区町村・2 町名・3 番地) */
  distance_km?: number | null; name_match?: number | null; address_level?: number | null;
}
/** [Gate PlaceLookupJP] 提供元の出典(各提供元の規約のクレジット) */
export interface PlaceSource { provider: string; label: string; credit: string; url: string }
export interface PlaceInfoResult {
  provider: string; attribution: string; license: string; license_url: string;
  candidates: PlaceInfoCandidate[]; cached: boolean; unavailable: boolean; error_code: string | null;
  sources?: PlaceSource[]; keyed_providers?: string[];
  /** [Gate PlaceTripArea] 旅行の目的地を手がかりにした時の目的地 */
  area?: { label: string | null; prefecture: string | null } | null;
}

export async function getPlaceInfo(input: { name?: string | null; latitude?: number | null; longitude?: number | null;
  address?: string | null; plan_id?: string | null }): Promise<PlaceInfoResult> {
  const body = {
    name: input.name?.trim() || null,
    // [Gate PlaceLookupAccuracy] 入っている住所(都道府県の違う候補を外す・名前で見つからない時に位置を出す)
    ...(input.address?.trim() ? { address: input.address.trim().slice(0, 1000) } : {}),
    latitude: typeof input.latitude === 'number' ? input.latitude : null,
    longitude: typeof input.longitude === 'number' ? input.longitude : null,
    // [Gate PlaceTripArea] 旅程の画面の旅行(目的地を、位置・住所の無い予定の手がかりにする)
    ...(input.plan_id ? { plan_id: input.plan_id } : {}),
  };
  return (await api.post('/spots/place-info', body, SILENT)).data as PlaceInfoResult;
}

/** [Gate PlaceLookupJP] 住所から地図の位置の候補(Yahoo!ジオコーダ・国土地理院・OpenStreetMap の順に見つかるまで) */
export interface GeocodeCandidate { address: string | null; latitude: number; longitude: number; provider: string; level: string | null }
export interface GeocodeResult { candidates: GeocodeCandidate[]; sources: PlaceSource[]; unavailable: boolean }
export async function geocodeAddress(query: string,
  near?: { latitude?: number | null; longitude?: number | null; plan_id?: string | null }): Promise<GeocodeResult> {
  const body = { query: query.trim(), latitude: typeof near?.latitude === 'number' ? near.latitude : null,
    longitude: typeof near?.longitude === 'number' ? near.longitude : null, ...(near?.plan_id ? { plan_id: near.plan_id } : {}) };
  return (await api.post('/spots/geocode', body, SILENT)).data as GeocodeResult;
}

/** [Gate SpotInfo] 場所に結び付いた写真(OpenStreetMap の wikimedia_commons・wikidata のタグから)。無ければ null */
export async function getPlacePhoto(input: { photo_file?: string | null; wikidata?: string | null }): Promise<ExternalImage | null> {
  const params: Record<string, string> = {};
  if (input.photo_file) params.file = input.photo_file;
  if (input.wikidata) params.wikidata = input.wikidata;
  if (!params.file && !params.wikidata) return null;
  return ((await api.get('/media-providers/images/for-place', { ...SILENT, params })).data as { image: ExternalImage | null }).image;
}
