/**
 * 説明可能な最適化(FR-018)APIの型
 *
 * [Gate L4] backend/app/api/v1/optimization.py・app/services/optimizer.py(explainable-opt-v1)に対応する。
 * 1日の並べ替え候補を、移動距離・移動時間(内部推定)と実行可能性検証(feasibility-v1、制約を含む)の結果つきで返す。
 * 候補の計算は旅程を変えない。適用は本案のrevision(If-Match)と入力の版(input_fingerprint)で行い、「元に戻す」で取り消せる。
 */
export type OptimizationTravelMode = 'walking' | 'driving' | 'train' | 'bus' | 'bicycle' | 'taxi';
export type OptimizationCandidateKind = 'shortest' | 'constraints';

export interface OptimizationMetrics {
  distance_km: number;
  duration_minutes: number;
  /** 位置が無く距離を計算できない区間の数 */
  unknown_legs: number;
  error: number;
  warning: number;
  info: number;
  unverified: number;
  constraints_satisfied: number;
  constraints_violated: number;
}

export interface OptimizationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  entity_label: string | null;
  is_private_constraint: boolean;
}

export interface OptimizationCandidate {
  /** 並び順と時刻から決まる識別子(同じ入力なら同じ値) */
  id: string;
  kinds: OptimizationCandidateKind[];
  label: string;
  order: string[];
  changes: Array<{
    event_id: string;
    title: string;
    before_index: number;
    after_index: number;
    before_time: string | null;
    after_time: string | null;
  }>;
  metrics: OptimizationMetrics & { saved_distance_km: number; saved_duration_minutes: number };
  new_issues: OptimizationIssue[];
  resolved_issues: OptimizationIssue[];
  explanations: string[];
}

export interface OptimizationCandidates {
  plan_id: string;
  day_id: string;
  local_date: string;
  algorithm_version: string;
  validation_algorithm_version: string;
  travel_mode: OptimizationTravelMode;
  base_revision: number;
  /** 旅程・制約・予約・区間の版。適用時に送り、変わっていれば409 optimization_stale */
  input_fingerprint: string;
  current: { order: string[]; metrics: OptimizationMetrics };
  fixed: Array<{ event_id: string; title: string; reason: string }>;
  movable_count: number;
  candidates: OptimizationCandidate[];
  warnings: string[];
  can_apply: boolean;
}

export interface OptimizationApplyResult {
  plan_revision: number;
  changed: number;
  change_set_id: string | null;
  algorithm_version: string;
}
