/**
 * 訪問の地図の層・訪問判定・訂正(FR-049・FR-050・FR-051)APIの型
 *
 * [Gate V2] backend/app/api/v1/visits.py・app/services/visit_assessment.py に対応する。
 * 判定は閲覧者本人だけのもの。根拠(reasons)に軌跡の座標は無い(予定の場所の座標だけ)。
 */
export type VisitState = 'VERIFIED_VISIT' | 'LIKELY_VISIT' | 'PASS_THROUGH' | 'PLANNED_ONLY' | 'MANUAL' | 'REJECTED';
export type VisitLayerState = 'VERIFIED' | 'STAYED' | 'VISITED' | 'PASS_THROUGH' | 'PLANNED' | 'HIDDEN';
export type VisitSource = 'auto' | 'device' | 'user';
export type VisitLevel = 'high' | 'review' | 'candidate';
export type VisitAction = 'confirm' | 'pass_through' | 'reject' | 'hide' | 'unhide' | 'reset';
export type VisitEvidenceKind = 'photo' | 'reservation' | 'manual';

export interface VisitReasons {
  basis?: 'gps' | 'manual' | 'none';
  radius_m?: number;
  points_inside?: number;
  points_valid?: number;
  points_low_accuracy?: number;
  dwell_seconds?: number;
  median_distance_m?: number | null;
  median_accuracy_m?: number | null;
  speed_kmh?: number | null;
  evidence?: VisitEvidenceKind[];
  strong_evidence?: string[];
  stayed?: boolean;
  pass_reason?: 'fast' | 'short';
  auto_source?: 'auto' | 'device';
  scores?: Partial<Record<'distance' | 'dwell' | 'accuracy' | 'evidence', number>>;
}

export interface VisitAssessment {
  state: VisitState;
  auto_state: VisitState | null;
  confidence: number | null;
  level: VisitLevel | null;
  reasons: VisitReasons;
  algorithm_version: string;
  source: VisitSource;
  hidden: boolean;
  assessed_at: string | null;
  corrected_at: string | null;
  revision: number;
  needs_confirmation: boolean;
  differs_from_auto: boolean;
}

export interface VisitItem {
  event_id: string;
  title: string;
  event_type: string;
  day_id: string;
  date: string;
  planned_time: string | null;
  latitude: number;
  longitude: number;
  radius_m: number;
  layer_state: VisitLayerState;
  assessment: VisitAssessment | null;
}

export interface VisitRules {
  algorithm_version: string;
  max_accuracy_m: number;
  visit_min_points: number;
  visit_min_seconds: number;
  stay_min_seconds: number;
  pass_speed_kmh: number;
  high: number;
  review: number;
  default_radius_m: number;
  radius_m: Record<string, number>;
}

export interface VisitsOverview {
  plan_id: string;
  title: string;
  items: VisitItem[];
  counts: Record<VisitLayerState, number>;
  events_without_location: number;
  needs_confirmation: number;
  tracks: { synced: number; device: number };
  rules: VisitRules;
  /** POST /visits/assess・/visits/device-results の時だけ */
  result?: { created: number; changed: number; unchanged: number; skipped: number };
}

export interface VisitCorrectionResult {
  event_id: string;
  assessment: VisitAssessment | null;
  layer_state: VisitLayerState;
}

/** 端末で計算した数値(座標を含まない)。utils/visitMetrics.ts */
export interface DeviceVisitMetrics {
  points_total: number;
  points_valid: number;
  points_inside: number;
  dwell_seconds: number;
  median_distance_m: number | null;
  median_accuracy_m: number | null;
  speed_kmh: number | null;
}
