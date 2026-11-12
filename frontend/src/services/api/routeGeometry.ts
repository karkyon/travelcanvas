/**
 * [Gate RoadRoute] 地図に引く「道に沿った経路」(backend の POST /plans/{plan_id}/route-geometry。OSRM)。
 * 失敗しても画面全体の知らせは出さない(地図は直線の点線のまま)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, int, nullable, num, object, optional, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface RouteGeometryLegIn {
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  mode: string;
}

export interface RouteGeometryLeg {
  index: number;
  mode: string;
  kind: 'road' | 'straight' | string;
  profile?: string | null;
  coordinates: number[][];
  distance_km?: number | null;
  duration_minutes?: number | null;
}

export interface RouteGeometry {
  legs: RouteGeometryLeg[];
  provider: string;
  available: boolean;
}

export const routeGeometryDecoder: Decoder<RouteGeometry> = object<RouteGeometry>({
  legs: arrayOf(object<RouteGeometryLeg>({
    index: int,
    mode: str,
    kind: str,
    profile: optional(nullable(str)),
    coordinates: arrayOf(arrayOf(num)),
    distance_km: optional(nullable(num)),
    duration_minutes: optional(nullable(num)),
  })),
  provider: str,
  available: bool,
});

export async function getRouteGeometry(planId: string, legs: RouteGeometryLegIn[]): Promise<RouteGeometry> {
  const r = await api.post(`/plans/${planId}/route-geometry`, { legs }, SILENT);
  return decodeResponse(r.data, routeGeometryDecoder, 'POST /plans/{plan_id}/route-geometry');
}
