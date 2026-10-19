/**
 * 任意の位置軌跡(FR-038)APIの型
 *
 * [Gate P13] backend/app/api/v1/location_tracks.py に対応する。
 * 軌跡は記録した本人だけのもの(旅行の所有者を含む他の人には返らない)。記録には位置情報の利用への同意が必要。
 * mode: device_only=座標をサーバーへ送らず端末だけに保存 / synced=暗号化してサーバーへ保存。
 */
// [Gate L5] areas_only = 生の座標は端末だけ。集計した訪問地域(0.1度の区画)と滞在時間だけを同期する(CA-013)
export type TrackMode = 'device_only' | 'areas_only' | 'synced';
/** [Gate L5] 旅行ごとの位置の扱い。off = 記録しない */
export type TripLocationMode = 'off' | TrackMode;
export type TrackPrecision = 'high' | 'standard' | 'low';
export type TrackStatus = 'recording' | 'paused' | 'stopped';
export type TrackStoppedReason = 'user' | 'trip_ended' | 'consent_withdrawn' | 'mode_off';

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
  /** [Gate L5] 端末の記録の観測値(電池・欠測率。座標を含まない)。未報告は null */
  sampling: TrackSampling | null;
  created_at: string | null;
  updated_at: string | null;
}

export type SamplingTier = 'moving_fast' | 'moving' | 'stationary' | 'low_power';

/** [Gate L5] FR-056 端末の記録の観測値(送る側) */
export interface TrackSamplingInput {
  battery_start?: number;
  battery_end?: number;
  charging_seen?: boolean;
  expected_samples: number;
  kept_samples: number;
  missed_samples: number;
  manual_points: number;
  max_gap_seconds: number;
  tier_seconds: Partial<Record<SamplingTier, number>>;
}

/** [Gate L5] サーバーが計算した値(欠測率・電池の消費)を含む観測値 */
export interface TrackSampling extends TrackSamplingInput {
  missed_ratio: number | null;
  battery_used: number | null;
  reported_at: string;
}

/** [Gate L5] 「訪問地域だけ同期」の区画(0.1度の格子の南西の角の印) */
export interface AreaCellInput {
  key: string;
  first_at: string;
  last_at: string;
  dwell_seconds: number;
  samples: number;
}

export interface AreaCell extends AreaCellInput {
  state: 'STAYED' | 'VISITED' | 'PASS_THROUGH';
}

export interface AreaCellsUploadResult {
  added: number;
  updated: number;
  rejected: Partial<Record<'invalid' | 'outside_period', number>>;
  cell_count: number;
  status: TrackStatus;
}

export interface LocationSettings {
  mode: TripLocationMode | null;
  revision: number;
  updated_at: string | null;
  stopped_tracks?: number;
}

export interface LocationTrackList {
  tracks: LocationTrack[];
  location_consent: boolean;
  trip_period: { start: string; end: string } | null;
  in_trip_period: boolean;
  active_track_id: string | null;
  can_start: boolean;
  max_points_per_request: number;
  /** [Gate L5] この旅行の位置の扱い(null = まだ選んでいない) */
  trip_mode: TripLocationMode | null;
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
  /** [Gate L5] areas_only の区画(それ以外は空) */
  cells: AreaCell[];
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
