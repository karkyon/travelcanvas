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
  days: Array<{ day_id: string; date: string; title: string | null; timezone_id: string; events: JourneyEvent[] }>;
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
