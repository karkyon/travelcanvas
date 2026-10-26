/**
 * [Gate G7] MOVE-03 移動・滞在の既定・MOVE-04 目的の内訳と部分の採用・FR-019 比較・FR-005 影響のプレビュー・
 * MEM-03 同行者の属性と移動手段の傾向・FR-039 猶予つきの削除 の型(backend の応答と同じ名前)。
 */
import type { OptimizationCandidate, OptimizationCandidates, OptimizationMetrics } from './optimization';

export type MovementPace = 'relaxed' | 'normal' | 'active';
export type MovementEventType =
  | 'sightseeing' | 'activity' | 'dining' | 'shopping' | 'accommodation' | 'transportation' | 'other';

export interface MovementSettingsValue {
  enabled: boolean;
  pace: MovementPace;
  stay_minutes: Partial<Record<MovementEventType, number | null>>;
  break_minutes: number;
  max_continuous_minutes: number | null;
  max_day_minutes: number | null;
  short_stay_ratio: number;
  last_transport_margin_minutes: number;
  party: { with_children: boolean; with_seniors: boolean; size: number | null };
}

export interface MovementEffective {
  stay_minutes: Partial<Record<MovementEventType, number | null>>;
  break_minutes: number;
  max_continuous_minutes: number;
  max_day_minutes: number;
  short_stay_ratio: number;
  last_transport_margin_minutes: number;
  pace: MovementPace;
  with_children: boolean;
  with_seniors: boolean;
  notes: string[];
}

export interface MovementSettings {
  plan_id: string;
  algorithm_version: string;
  settings: MovementSettingsValue;
  revision: number;
  is_default: boolean;
  effective: MovementEffective | null;
  event_types: Array<{ key: MovementEventType; label: string; default_minutes: number | null; estimated: boolean }>;
  paces: Array<{ key: MovementPace; label: string; stay_factor: number; max_continuous: number; max_day: number }>;
  can_edit: boolean;
}

export type FatigueLevel = 'light' | 'normal' | 'heavy';

export interface DayMetric {
  day_id: string;
  local_date: string;
  events: number;
  active_minutes: number;
  walking_minutes: number;
  ride_minutes: number;
  longest_continuous_minutes: number;
  span_minutes: number;
  fatigue_percent: number;
  level: FatigueLevel;
  estimated: boolean;
  incomplete: boolean;
}

export interface RunMovement {
  day_metrics: DayMetric[];
  movement: MovementEffective | null;
}

export interface ImpactIssue {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  entity_label: string | null;
  estimated: boolean;
  is_private_constraint: boolean;
}

export interface Counts { error: number; warning: number; info: number; unverified: number }

export interface ImpactPreview {
  event_id: string;
  plan_revision: number;
  algorithm_version: string;
  before: Counts;
  after: Counts;
  new_issues: ImpactIssue[];
  resolved_issues: ImpactIssue[];
  related: { segments: number; reservations: number };
  end_day_offset: number | null;
  summary: string[];
}

export interface ImpactInput {
  local_start_time?: string | null;
  local_end_time?: string | null;
  end_day_offset?: number | null;
  day_id?: string;
  delete?: boolean;
}

// ===== MOVE-04
export type WeightKey = 'distance' | 'constraints' | 'fatigue' | 'fairness';
export type Weights = Record<WeightKey, number>;

export interface ObjectiveTerm {
  key: WeightKey;
  label: string;
  value: number | null;
  unit: string;
  score: number;
  rule: string;
  weight: number;
  weighted: number;
}

export interface Objective { terms: ObjectiveTerm[]; total: number; weights: Weights }

export interface MovementMetrics {
  fatigue_percent: number | null;
  longest_continuous_minutes: number | null;
  fairness_spread_percent: number | null;
}

export type G7Candidate = Omit<OptimizationCandidate, 'kinds' | 'metrics'> & {
  kinds: Array<'shortest' | 'constraints' | 'balanced'>;
  metrics: OptimizationCandidate['metrics'] & MovementMetrics;
  objective: Objective;
};

export type G7Candidates = Omit<OptimizationCandidates, 'candidates' | 'current'> & {
  candidates: G7Candidate[];
  current: { order: string[]; metrics: OptimizationMetrics & MovementMetrics; objective: Objective };
  weights: Weights;
  weights_given: boolean;
  weight_labels: Record<WeightKey, string>;
  movement_applied: boolean;
};

export interface PartialPreview {
  candidate_id: string;
  event_ids: string[];
  order: string[];
  changes: G7Candidate['changes'];
  metrics: G7Candidate['metrics'];
  objective: Objective;
  new_issues: G7Candidate['new_issues'];
  resolved_issues: G7Candidate['resolved_issues'];
  explanations: string[];
  can_apply: boolean;
}

// ===== FR-019
export interface Money { currency: string; amount: string }

export interface CompareColumn {
  counts: Counts;
  constraints_violated: number;
  constraints_satisfied: number;
  travel: { minutes: number; km: number; legs: number; unknown_legs: number; is_estimate: boolean };
  max_fatigue_percent: number | null;
  heavy_days: number;
  costs: { total: Money[]; removed: Money[] } | null;
}

export interface CompareBranch extends CompareColumn {
  id: string;
  title: string;
  scenario_type: string;
  state: string;
  summary: { added: number; removed: number; updated: number; time_changed: number };
  conflicts: number;
  new_issues: ImpactIssue[];
  resolved_issues: ImpactIssue[];
  affected_reservations: Array<{ id: string; label: string; status: string }> | null;
  budget_target: Array<{ currency: string; target: string; branch: string; met: boolean }> | null;
}

export interface BranchComparison {
  plan_id: string;
  plan_revision: number;
  algorithm_version: string;
  validation_algorithm_version: string;
  movement_applied: boolean;
  plan: CompareColumn & { title: string };
  branches: CompareBranch[];
  costs_hidden: boolean;
  reservations_hidden: boolean;
  can_adopt: boolean;
}

// ===== MEM-03
export interface PartyInfo { with_children: boolean; with_seniors: boolean; size: number; group: 'solo' | 'group' }

export interface G7Insight {
  kind: 'stay_longer' | 'stay_shorter' | 'late_arrival' | 'often_skipped' | 'slow_transport';
  event_type: string | null;
  minutes: number | null;
  samples: number;
  skipped?: number;
  plans: string[];
  examples: string[];
  applicable: boolean;
  basis: 'same_party' | 'all';
  party_label?: string;
  mode?: string;
  mode_label?: string;
}

export interface G7EventChange { event_id: string; title: string; day_id: string; from: string; to: string }
export interface G7SegmentChange { segment_id: string; label: string; from: number; to: number }

export interface G7Proposal {
  id: string;
  kind: 'stay_longer' | 'slow_transport';
  event_type: string | null;
  minutes: number;
  mode?: string;
  target?: 'segment';
  changes: Array<G7EventChange | G7SegmentChange>;
  kept: Array<{ event_id: string; title: string; reason: 'locked' | 'has_reservation' | 'next_day' }>;
}

export interface G7MemoryReplan {
  plan_id: string;
  plan_revision: number;
  insights: G7Insight[];
  proposals: G7Proposal[];
  input_fingerprint: string;
  sample_count: number;
  transport_sample_count: number;
  party: PartyInfo;
  party_label: string;
  algorithm_version: string;
  can_apply: boolean;
}

// ===== FR-039
export interface DeletionSchedule { requested_at: string | null; due_at: string }
export interface DeletionScheduleResult {
  scheduled: DeletionSchedule | null;
  account_delete_grace_days?: number;
  due_at?: string;
}
export interface DeletionExtras {
  account_delete_grace_days: number;
  can_schedule: boolean;
  scheduled: DeletionSchedule | null;
}
