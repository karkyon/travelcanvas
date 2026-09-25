/**
 * PLAN MAP移動概算・挿入プレビュー・最適化提案APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// [Gate #32] PLAN MAP: route/insertion preview のレスポンス型
export interface LegPreview {
  from_event_id?: string | null;
  to_event_id?: string | null;
  mode: string;
  distance_km?: number | null;
  duration_minutes?: number | null;
  is_estimate: boolean;
  unknown: boolean;
}

export interface RoutePreview {
  day_id: string;
  legs: LegPreview[];
  total_distance_km?: number | null;
  total_duration_minutes?: number | null;
  provider: string;
  algorithm_version: string;
}

export interface InsertionPreview {
  day_id: string;
  before: RoutePreview;
  after: RoutePreview;
  added_distance_km?: number | null;
  added_duration_minutes?: number | null;
  unknown: boolean;
}

// [Gate #33] 説明可能な経路最適化の提案レスポンス型
export interface OptimizationProposal {
  day_id: string;
  base_revision: number;
  algorithm: string;
  algorithm_version: string;
  proposed_order: string[];
  locked_event_ids: string[];
  before_total_distance_km?: number | null;
  after_total_distance_km?: number | null;
  before_total_duration_minutes?: number | null;
  after_total_duration_minutes?: number | null;
  saved_distance_km?: number | null;
  saved_duration_minutes?: number | null;
  warnings: string[];
  has_improvement: boolean;
}
