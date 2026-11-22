/** [FR-061] 日帰り: ルートの計算・比べ・ルートの近くの候補(backend/app/api/v1/day_trip.py) */
import { api } from './index';

const SILENT = { skipGlobalErrorHandler: true };

export type Road = 'highway' | 'local' | 'avoid_tolls' | 'auto';
export const ROADS: [Road, string][] = [['highway', '高速を使う'], ['local', '下道だけ'], ['avoid_tolls', '有料を避ける'], ['auto', 'おまかせ']];
export type AlongOrder = 'personal' | 'route' | 'detour';
export const WIDTHS: [number, string][] = [[300, '300m'], [1000, '1km'], [3000, '3km'], [5000, '5km']];

export interface DayTripPlace { label: string; lat: number; lng: number; spot_id?: string | null }
export interface DayTripLeg {
  leg: 'out' | 'back'; origin: DayTripPlace; destination: DayTripPlace; road: Road; depart_at: string; home_by: string | null;
  polyline: string; distance_m: number | null; duration_s: number | null; toll_jpy: number | null;
  provider: 'google' | 'osrm' | 'straight'; arrive_at: string | null; computed_at: string; revision: number;
}
export interface DayTripView { trip_style: string | null; routes: Partial<Record<'out' | 'back', DayTripLeg>> }
export interface RouteInput { origin: DayTripPlace; destination: DayTripPlace; road: Road; depart_at: string; home_by?: string | null }
export interface CompareOption { road: Road; duration_s: number | null; distance_m: number | null; toll_jpy: number | null;
  polyline: string; provider: string; warnings: string[] }
export interface AlongResult {
  name: string; genre: string | null; genre_label: string | null; lat: number; lng: number; address: string | null;
  off_m: number; at_km: number; detour_min: number | null; exit_unknown: boolean; providers: string[];
  saved_spot_id: string | null; stay_min: number; score: number; reasons: string[];
}
export interface AlongWish { spot_id: string; name: string; lat: number; lng: number; off_m: number; at_km: number; wish_kind: string }
export interface AlongResponse {
  region_label: string; width_m: number; leg: 'out' | 'back'; total_km: number; results: AlongResult[]; wishes_near: AlongWish[];
  profile_line: string | null; personalized: boolean; source: { provider: string; label: string; credit: string; url: string }[];
  keyed_providers: string[]; failed_providers: string[]; straight: boolean; cached: boolean;
}

const idem = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `dt${Date.now()}`);

export const computeDayTripRoute = async (planId: string, input: RouteInput) =>
  (await api.post(`/plans/${planId}/day-trip/route`, input, { ...SILENT, headers: { 'Idempotency-Key': idem() } })).data as
    { routes: DayTripView['routes']; provider: string; warnings: string[] };
export const getDayTrip = async (planId: string): Promise<DayTripView> =>
  (await api.get(`/plans/${planId}/day-trip`, SILENT)).data as DayTripView;
export const compareRoads = async (planId: string, roads: Road[]): Promise<{ options: CompareOption[] }> =>
  (await api.post(`/plans/${planId}/day-trip/compare`, { roads }, { ...SILENT, headers: { 'Idempotency-Key': idem() } })).data as
    { options: CompareOption[] };
export const getAlong = async (planId: string, q: { leg: 'out' | 'back'; genres: string[]; width_m: number; order: AlongOrder }) =>
  (await api.get(`/plans/${planId}/day-trip/along?leg=${q.leg}&genres=${encodeURIComponent(q.genres.join(','))}&width_m=${q.width_m}&order=${q.order}`,
    SILENT)).data as AlongResponse;

/** encoded polyline → [lat, lng][](地図に引く) */
export function decodePolyline(text: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0; let lat = 0; let lng = 0;
  while (i < text.length) {
    const v: number[] = [];
    for (let k = 0; k < 2; k += 1) {
      let shift = 0; let result = 0; let b = 0;
      do {
        if (i >= text.length) return out;
        b = text.charCodeAt(i) - 63; i += 1;
        result |= (b & 0x1f) << shift; shift += 5;
      } while (b >= 0x20);
      v.push(result & 1 ? ~(result >> 1) : result >> 1);
    }
    lat += v[0]!; lng += v[1]!;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
