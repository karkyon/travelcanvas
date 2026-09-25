/**
 * 移動区間(FR-014)APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// [Gate M2] FR-014移動区間(TravelSegment)。backend/app/api/v1/segments.py
// (Gate M1)に対応するfrontend型。DOC-05 §7.1参照。
export type SegmentMode =
  | 'walking' | 'driving' | 'train' | 'bus' | 'ferry' | 'flight' | 'bicycle' | 'taxi' | 'mixed';

export type SegmentStatus = 'planned' | 'confirmed' | 'cancelled';

export interface TravelSegment {
  id: string;
  plan_id: string;
  from_event_id: string | null;
  from_place_id: string | null;
  to_event_id: string | null;
  to_place_id: string | null;
  mode: SegmentMode;
  status: SegmentStatus;
  planned_departure_at: string | null;
  planned_arrival_at: string | null;
  distance_km: number | null;
  duration_minutes: number | null;
  cost: string | null; // Decimalはstringとしてやり取りする(精度保持のため)
  currency: string | null;
  preparation_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  transport_number: string | null;
  platform: string | null;
  transfer_count: number | null;
  luggage_note: string | null;
  reservation_id: string | null;
  is_estimate: boolean;
  provider: string;
  algorithm_version: string;
  computed_at: string;
  recommended_departure_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string | null;
}

export interface SegmentCreateData {
  from_event_id?: string;
  from_place_id?: string;
  to_event_id?: string;
  to_place_id?: string;
  mode: SegmentMode;
  status?: SegmentStatus;
  planned_departure_at?: string;
  planned_arrival_at?: string;
  distance_km?: number;
  duration_minutes?: number;
  cost?: string;
  currency?: string;
  preparation_minutes?: number;
  buffer_before_minutes?: number;
  buffer_after_minutes?: number;
  transport_number?: string;
  platform?: string;
  transfer_count?: number;
  luggage_note?: string;
  reservation_id?: string;
}

export type SegmentUpdateData = Partial<SegmentCreateData>;
