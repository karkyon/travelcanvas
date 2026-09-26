/**
 * 実行可能性検証(FR-017)APIの型
 *
 * [Gate L3] backend/app/api/v1/validation.py に対応する。
 * kind='unverified' は「情報が足りず検証できなかった」項目で、問題なしとは別に数える。
 * 他のメンバーの秘匿制約に関する問題は is_masked=true で、題名・根拠・修正候補が null になる。
 */
export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';
export type ValidationIssueKind = 'violation' | 'unverified';
export type ValidationRunStatus = 'completed' | 'failed';
/** not_applicable=適用対象の予定が無い(満たすとも満たさないとも言えない) */
export type ConstraintCheckStatus = 'satisfied' | 'violated' | 'unverified' | 'not_applicable';

export interface ValidationCounts {
  error: number;
  warning: number;
  info: number;
  unverified: number;
}

export interface ValidationRunSummary {
  id: string;
  plan_id: string;
  status: ValidationRunStatus;
  algorithm_version: string;
  input_revision: number;
  /** 検証後に旅程・制約・予約・区間のいずれかが変わった */
  is_stale: boolean;
  started_at: string;
  finished_at: string | null;
  created_by_me: boolean;
  counts: ValidationCounts;
}

export interface ValidationIssue {
  id: string;
  code: string;
  kind: ValidationIssueKind;
  severity: ValidationSeverity;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  day_id: string | null;
  constraint_id: string | null;
  constraint_title: string | null;
  is_private_constraint: boolean;
  is_masked: boolean;
  evidence: Record<string, unknown> | null;
  suggestion: Record<string, unknown> | null;
}

export interface ConstraintCheckResult {
  constraint_id: string;
  status: ConstraintCheckStatus;
  is_private: boolean;
  is_mine: boolean;
  constraint_title: string | null;
}

export interface ValidationRunDetail extends ValidationRunSummary {
  /** 検証できなかった件数の内訳(例: event_time_unknown, opening_hours_unknown) */
  unchecked: Record<string, unknown>;
  constraint_results: ConstraintCheckResult[];
  issues: ValidationIssue[];
}
