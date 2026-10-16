/**
 * 任意の位置軌跡(FR-038)APIの型
 *
 * [Gate P13] backend/app/api/v1/location_tracks.py に対応する。
 * 軌跡は記録した本人だけのもの(旅行の所有者を含む他の人には返らない)。記録には位置情報の利用への同意が必要。
 * mode: device_only=座標をサーバーへ送らず端末だけに保存 / synced=暗号化してサーバーへ保存。
 */
export type TrackMode = 'device_only' | 'synced';
export type TrackPrecision = 'high' | 'standard' | 'low';
export type TrackStatus = 'recording' | 'paused' | 'stopped';
export type TrackStoppedReason = 'user' | 'trip_ended' | 'consent_withdrawn';

export interface LocationTrack {
  id: string;
  plan_id: string;
  mode: TrackMode;
  precision: TrackPrecision;
  status: TrackStatus;
  stopped_reason: TrackStoppedReason | null;
  started_at: string;
  auto_stop_at: string;
  stopped_at: string | null;
  point_count: number;
  revision: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface LocationTrackList {
  tracks: LocationTrack[];
  location_consent: boolean;
  trip_period: { start: string; end: string } | null;
  in_trip_period: boolean;
  active_track_id: string | null;
  can_start: boolean;
  max_points_per_request: number;
}

export interface TrackPoint {
  recorded_at: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
}

export interface LocationTrackDetail extends LocationTrack {
  distance_m: number;
  points: TrackPoint[];
}

export interface TrackPointsUploadResult {
  accepted: number;
  rejected: Partial<Record<'invalid' | 'low_accuracy' | 'outside_period', number>>;
  point_count: number;
  replayed: boolean;
  status: TrackStatus;
}

export interface TrackPointsDeleteResult {
  removed: number;
  point_count: number;
  revision: number;
}
