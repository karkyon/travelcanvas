/**
 * 旅の振り返り(FR-054 Plan-to-Memory・FR-053 旅の達成指標)APIの型
 *
 * [Gate P14] backend/app/api/v1/journey.py・app/services/journey.py に対応する。
 * 予定(travel_events)は実績で上書きせず、行った/行かなかった・実際の到着と出発を別に持つ。
 */
export type ActualStatus = 'visited' | 'skipped';

export interface EventActualRecord {
  status: ActualStatus;
  actual_start_at: string | null;
  actual_end_at: string | null;
  source: 'manual' | 'suggested';
  note: string | null;
  revision: number;
  updated_at: string | null;
}

export interface ActualSuggestion {
  actual_start_at: string;
  actual_end_at: string;
  /** track=本人の位置の軌跡、memory=予定に紐付けた記録の日時 */
  basis: 'track' | 'memory';
  points: number;
}

export interface JourneyEvent {
  event_id: string;
  title: string;
  planned_time: string | null;
  planned_start_at: string | null;
  has_location: boolean;
  actual: EventActualRecord | null;
  memory_count: number;
  photo_count: number;
  suggestion: ActualSuggestion | null;
  start_diff_minutes: number | null;
  /** [Gate PlanB-P7] 途中で切り替えた日の、元の案で済んだ予定 */
  from_variant?: boolean;
  /** [Gate PlanB-P7] 切り替えで合流点より前にあったため、とばした予定(達成指標に数えない) */
  skipped_by_switch?: boolean;
}

/** [Gate PlanB-P7] その日の切り替え(最後の 1 回) */
export interface JourneySwitch {
  from_label: string | null; from_name: string | null; to_label: string | null; to_name: string | null;
  phase: 'planning' | 'during' | 'after'; reason: string | null; reason_label: string | null; place_label: string | null;
  switched_at: string | null;
}

export interface JourneyMetrics {
  planned_events: number;
  visited: number;
  skipped: number;
  unrecorded: number;
  plan_achievement_rate: number | null;
  visit_rate: number | null;
  photo_visit_rate: number | null;
  record_completion_rate: number | null;
  memory_events: number;
  stay_minutes: number | null;
  timed_visits: number;
  track_distance_m: number | null;
  algorithm_version: string;
}

export interface JourneyReview {
  plan_id: string;
  title: string;
  days: Array<{
    day_id: string; date: string; title: string | null; timezone_id: string; events: JourneyEvent[];
    /** [Gate PlanB-P7] 回った案(今の案)と、切り替えの点 */
    variant?: { label: string; name: string }; switch?: JourneySwitch | null;
  }>;
  metrics: JourneyMetrics;
  can_edit: boolean;
}

export interface ActualInput {
  status: ActualStatus;
  actual_start_at?: string | null;
  actual_end_at?: string | null;
  source?: 'manual' | 'suggested';
  note?: string | null;
}

export interface ActualPutResult {
  event_id: string;
  actual: EventActualRecord;
}

export interface CarryOverResult {
  event_id: string;
  target_plan_id: string;
  target_day_id: string;
  target_revision: number;
}
