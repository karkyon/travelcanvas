/**
 * 経路比較(FR-015)APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import type { SegmentMode } from './segments';

// [Gate M4] FR-015複数経路比較(RouteOption/RouteLeg)。
// backend/app/api/v1/route_options.py (Gate M3)に対応するfrontend型。
export type RouteOptionStatus = 'candidate' | 'adopted' | 'discarded';

export type RealtimeStatus = 'unknown' | 'on_time' | 'delayed' | 'cancelled';

export interface RouteLeg {
  id: string;
  route_option_id: string;
  leg_order: number;
  mode: SegmentMode;
  line: string | null;
  operator: string | null;
  platform: string | null;
  from_label: string | null;
  to_label: string | null;
  departure_at: string | null;
  arrival_at: string | null;
  distance_km: number | null;
  duration_minutes: number | null;
  realtime_status: RealtimeStatus;
  created_at: string;
  updated_at: string | null;
}

export interface RouteOption {
  id: string;
  plan_id: string;
  from_event_id: string | null;
  from_place_id: string | null;
  to_event_id: string | null;
  to_place_id: string | null;
  status: RouteOptionStatus;
  total_duration_minutes: number | null;
  total_cost: string | null;
  currency: string | null;
  total_distance_km: number | null;
  walking_minutes: number | null;
  transfer_count: number | null;
  accessibility_score: number | null;
  scenic_score: number | null;
  co2_estimate_kg: number | null;
  duration_estimate_low_minutes: number | null;
  duration_estimate_high_minutes: number | null;
  provider: string;
  retrieved_at: string;
  expires_at: string | null;
  is_estimate: boolean;
  algorithm_version: string;
  revision: number;
  created_at: string;
  updated_at: string | null;
  legs: RouteLeg[];
}

export interface RouteLegCreateData {
  mode: SegmentMode;
  line?: string;
  operator?: string;
  platform?: string;
  from_label?: string;
  to_label?: string;
  departure_at?: string;
  arrival_at?: string;
  distance_km?: number;
  duration_minutes?: number;
}

export type RouteLegUpdateData = Partial<RouteLegCreateData> & { realtime_status?: RealtimeStatus };

export interface RouteOptionCreateData {
  from_event_id?: string;
  from_place_id?: string;
  to_event_id?: string;
  to_place_id?: string;
  total_duration_minutes?: number;
  total_cost?: string;
  currency?: string;
  total_distance_km?: number;
  walking_minutes?: number;
  transfer_count?: number;
  accessibility_score?: number;
  scenic_score?: number;
  co2_estimate_kg?: number;
  duration_estimate_low_minutes?: number;
  duration_estimate_high_minutes?: number;
  legs?: RouteLegCreateData[];
}

export type RouteOptionUpdateData = Partial<Omit<RouteOptionCreateData, 'legs'>> & { status?: RouteOptionStatus };

export interface AdoptRouteOptionResponse {
  revision: number;
  route_option: RouteOption;
  segment_id: string;
}
