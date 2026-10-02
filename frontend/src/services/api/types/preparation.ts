/**
 * 持ち物(FR-025)・準備タスク・レディネス(FR-026)APIの型
 *
 * [Gate P1] backend/app/api/v1/preparation.py に対応する。DOC-05 §8.5 packing_items / preparation_tasks。
 * 個人の持ち物(scope='personal')は作成者本人にだけ返る(他のメンバーの一覧・件数には出ない)。
 */
export type PackingCategory =
  | 'clothing' | 'toiletries' | 'health' | 'documents' | 'electronics' | 'money' | 'gear' | 'other';
/** to_prepare=未準備 / to_buy=要購入 / packed=梱包済み / after_use=使用後・片付け済み */
export type PackingStatus = 'to_prepare' | 'to_buy' | 'packed' | 'after_use';
export type PackingScope = 'shared' | 'personal';
export type PlanMemberRole = 'owner' | 'editor' | 'viewer';

export interface PlanMember {
  user_id: string;
  name: string;
  role: PlanMemberRole;
  is_me: boolean;
}

export interface PackingItem {
  id: string;
  plan_id: string;
  scope: PackingScope;
  is_mine: boolean;
  /** full=内容を表示できる / unavailable=本人の個人の持ち物だが復号できない */
  visibility: 'full' | 'unavailable';
  name: string | null;
  note: string | null;
  category: PackingCategory;
  quantity: number;
  is_required: boolean;
  status: PackingStatus;
  source: 'manual' | 'suggested';
  suggestion_key: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  /** 担当者がプランのメンバーから外れている */
  assignee_missing: boolean;
  revision: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface PackingItemCreateData {
  name: string;
  note?: string;
  category?: PackingCategory;
  quantity?: number;
  is_required?: boolean;
  status?: PackingStatus;
  scope?: PackingScope;
  assignee_user_id?: string;
  suggestion_key?: string;
}

export interface PackingItemUpdateData {
  name?: string;
  note?: string | null;
  category?: PackingCategory;
  quantity?: number;
  is_required?: boolean;
  status?: PackingStatus;
  assignee_user_id?: string | null;
}

export interface PackingSuggestionConditions {
  overseas?: boolean;
  laundry?: boolean;
  with_children?: boolean;
  takes_medication?: boolean;
}

export interface PackingSuggestion {
  key: string;
  name: string;
  category: PackingCategory;
  scope: PackingScope;
  is_required: boolean;
  quantity: number;
  reason: string;
}

export interface PackingRemoveSuggestion {
  item_id: string;
  suggestion_key: string;
  name: string | null;
  reason: string;
}

export interface PackingChangeSuggestion {
  item_id: string;
  suggestion_key: string;
  name: string | null;
  current_quantity: number;
  suggested_quantity: number;
  reason: string;
}

export interface PackingSuggestions {
  algorithm_version: string;
  inputs: Record<string, unknown>;
  add: PackingSuggestion[];
  remove: PackingRemoveSuggestion[];
  change: PackingChangeSuggestion[];
  /** 判定していない観点(天候など)。「考慮済み」と誤解させないために表示する */
  unverified: Array<{ code: string; message: string }>;
}

export type TaskStatus = 'open' | 'done';
export type TaskRelatedType = 'event' | 'reservation' | 'segment' | 'document' | 'packing_item';

export interface PreparationTask {
  id: string;
  plan_id: string;
  title: string;
  description: string | null;
  completion_criteria: string | null;
  due_at: string | null;
  is_overdue: boolean;
  status: TaskStatus;
  completed_at: string | null;
  completed_by_name: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  assignee_missing: boolean;
  related_type: TaskRelatedType | null;
  related_id: string | null;
  related_label: string | null;
  related_missing: boolean;
  readiness_key: string | null;
  created_by_name: string | null;
  can_edit: boolean;
  can_complete: boolean;
  revision: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface PreparationTaskCreateData {
  title: string;
  description?: string;
  completion_criteria?: string;
  due_at?: string;
  assignee_user_id?: string;
  related_type?: TaskRelatedType;
  related_id?: string;
  readiness_key?: string;
}

export interface PreparationTaskUpdateData {
  title?: string;
  description?: string | null;
  completion_criteria?: string | null;
  due_at?: string | null;
  assignee_user_id?: string | null;
  status?: TaskStatus;
}

export type ReadinessCategory = 'unreserved' | 'unconfirmed' | 'unpaid' | 'deadline' | 'unassigned' | 'packing';
export type ReadinessSeverity = 'high' | 'medium' | 'low';
export type ReadinessCode =
  | 'unreserved' | 'reservation_unconfirmed' | 'reservation_unpaid' | 'payment_unknown'
  | 'cancellation_deadline_soon' | 'task_overdue' | 'task_unassigned' | 'packing_unassigned' | 'packing_shortage';

export interface ReadinessTaskRef {
  id: string;
  status: TaskStatus;
  assignee_user_id: string | null;
  assignee_name: string | null;
  due_at: string | null;
  revision: number;
}

export interface ReadinessItem {
  key: string;
  code: ReadinessCode;
  category: ReadinessCategory;
  severity: ReadinessSeverity;
  title: string;
  detail: string;
  entity_type: string;
  entity_id: string;
  link: string | null;
  due_at: string | null;
  /** タスクにして(担当・期限・完了条件を付けて)対応済みにできる項目か */
  convertible: boolean;
  task: ReadinessTaskRef | null;
}

export interface Readiness {
  plan_id: string;
  algorithm_version: string;
  checked_at: string;
  is_ready: boolean;
  counts: {
    total: number;
    by_severity: Record<ReadinessSeverity, number>;
    by_category: Record<ReadinessCategory, number>;
  };
  resolved_by_tasks: number;
  tasks: { open: number; done: number };
  packing: { total: number; packed: number; required_total: number; required_ready: number };
  items: ReadinessItem[];
}
