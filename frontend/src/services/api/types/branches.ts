/**
 * What-if・旅程ブランチ(FR-019)APIの型
 *
 * [Gate P7] backend/app/api/v1/branches.py・app/services/branches.py(branch-v1)に対応する。
 * 分岐案は本案を変えない。採用すると分岐案での変更を本案へ1つの変更セットとして適用する(本案の「元に戻す」で取り消せる)。
 */
export type BranchScenario = 'rain' | 'delay' | 'absence' | 'budget' | 'fatigue' | 'custom';
export type BranchStatus = 'draft' | 'adopted' | 'discarded';
export type BranchState = BranchStatus | 'adopted_undone';

export interface BranchAssumptions {
  note?: string | null;
  day_id?: string;
  after?: string;
  minutes?: number;
  max_events_per_day?: number;
  budget_cut_percent?: number;
  absent_member?: string;
}

export interface BranchEventItem {
  key: string;
  /** 本案の予定から来た場合はその予定のID。分岐案で追加した予定は null */
  source_event_id: string | null;
  day_id: string;
  title: string;
  event_type: string;
  local_start_time: string | null;
  is_all_day: boolean;
  sort_order: number;
  locked: boolean;
  removed: boolean;
  note: string | null;
}

export type BranchEditableField = 'day_id' | 'title' | 'event_type' | 'local_start_time' | 'is_all_day' | 'sort_order';

export interface BranchOp {
  op: 'add' | 'remove' | 'update';
  event_id?: string;
  key?: string;
  title?: string;
  fields?: Partial<Record<BranchEditableField, unknown>>;
  before?: Partial<Record<BranchEditableField, unknown>>;
}

export type BranchConflictReason = 'changed_in_plan' | 'deleted_in_plan' | 'locked' | 'has_relations' | 'day_missing';

export interface BranchConflict {
  op: 'add' | 'remove' | 'update';
  event_id?: string;
  key?: string;
  title?: string;
  reason: BranchConflictReason;
  fields?: string[];
}

export interface BranchSummaryCounts {
  added: number;
  removed: number;
  updated: number;
  time_changed: number;
}

export interface Branch {
  id: string;
  plan_id: string;
  algorithm_version: string;
  title: string;
  scenario_type: BranchScenario;
  assumptions: BranchAssumptions;
  base_revision: number;
  plan_revision: number;
  plan_changed_since_base: boolean;
  status: BranchStatus;
  state: BranchState;
  created_by_name: string;
  adopted_at: string | null;
  adopted_by_name: string | null;
  summary: BranchSummaryCounts;
  can_edit: boolean;
  revision: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface BranchDetail extends Branch {
  days: Array<{ id: string; local_date: string; timezone_id: string; title: string | null }>;
  content: BranchEventItem[];
  ops: BranchOp[];
  conflicts: BranchConflict[];
  day_counts: Array<{ day_id: string; local_date: string; plan: number; branch: number }>;
}

export interface BranchCreateData {
  title: string;
  scenario_type: BranchScenario;
  assumptions?: BranchAssumptions;
}

export type BranchContentInput = Omit<BranchEventItem, 'key' | 'locked'> & { key?: string };

export interface BranchUpdateData {
  title?: string;
  note?: string | null;
  status?: 'draft' | 'discarded';
}
