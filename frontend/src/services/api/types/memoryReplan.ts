/**
 * Memory Replan(FR-057)APIの型
 *
 * [Gate P17] backend/app/api/v1/memory_replan.py・app/services/memory_replan.py に対応する。
 * 参加している「ほかの旅行」の予定と実績から傾向(根拠つき)を出し、この旅行への提案を返す。提案は適用するまで旅程を変えない。
 */
export type ReplanInsightKind = 'stay_longer' | 'stay_shorter' | 'late_arrival' | 'often_skipped';

export interface ReplanInsight {
  kind: ReplanInsightKind;
  event_type: string | null;
  minutes: number | null;
  samples: number;
  skipped?: number;
  plans: string[];
  examples: string[];
  applicable: boolean;
}

export interface MemoryReplanProposal {
  id: string;
  kind: 'stay_longer';
  event_type: string;
  minutes: number;
  changes: Array<{ event_id: string; title: string; day_id: string; from: string; to: string }>;
  kept: Array<{ event_id: string; title: string; reason: 'locked' | 'has_reservation' | 'next_day' }>;
}

export interface MemoryReplanResult {
  plan_id: string;
  plan_revision: number;
  insights: ReplanInsight[];
  proposals: MemoryReplanProposal[];
  input_fingerprint: string;
  sample_count: number;
  algorithm_version: string;
  can_apply: boolean;
}

export interface MemoryReplanApplyResult {
  plan_id: string;
  plan_revision: number;
  applied: number;
  proposal_id: string;
}
