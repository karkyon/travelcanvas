/**
 * 制約(FR-016)APIの型
 *
 * [Gate L2] backend/app/api/v1/constraints.py に対応する。DOC-05 §7.3 constraints。
 * 他のメンバーの秘匿(private)制約は visibility='masked' で返り、題名・種類・値・
 * 理由などは null になる(存在とhard/softの別だけが分かる)。
 */
export type ConstraintType =
  | 'reservation' | 'opening_hours' | 'last_transport' | 'meeting' | 'budget_limit' | 'forbidden'
  | 'preference' | 'fatigue' | 'scenery' | 'meal_interval' | 'avoid_transport' | 'priority';

export type ConstraintOperator =
  | 'before' | 'after' | 'between' | 'max' | 'min' | 'equals' | 'not_equals' | 'avoid' | 'prefer';

export type ConstraintHardness = 'hard' | 'soft';
export type ConstraintScopeType = 'plan' | 'day' | 'event' | 'member';
export type ConstraintPrivacyLevel = 'shared' | 'private';
/** full=詳細を閲覧可 / masked=他人の秘匿制約 / unavailable=本人の秘匿制約だが復号できない */
export type ConstraintVisibility = 'full' | 'masked' | 'unavailable';

export interface ConstraintValue {
  value: string | number | null;
  value_to: string | null;
  unit: string | null;
}

export interface PlanConstraint {
  id: string;
  plan_id: string;
  visibility: ConstraintVisibility;
  is_mine: boolean;
  hardness: ConstraintHardness;
  privacy_level: ConstraintPrivacyLevel;
  scope_type: ConstraintScopeType;
  is_active: boolean;
  created_at: string | null;
  title: string | null;
  constraint_type: ConstraintType | null;
  operator: ConstraintOperator | null;
  value: ConstraintValue | null;
  weight: number | null;
  scope_id: string | null;
  scope_label: string | null;
  scope_missing: boolean;
  active_from: string | null;
  active_to: string | null;
  reason: string | null;
  has_reason: boolean;
  revision: number | null;
  updated_at: string | null;
}

export interface ConstraintValueInput {
  value: string | number;
  value_to?: string;
  unit?: string;
}

export interface ConstraintCreateData {
  title: string;
  constraint_type: ConstraintType;
  hardness: ConstraintHardness;
  operator: ConstraintOperator;
  value: ConstraintValueInput;
  weight?: number;
  scope_type?: ConstraintScopeType;
  scope_id?: string;
  privacy_level?: ConstraintPrivacyLevel;
  is_active?: boolean;
  active_from?: string;
  active_to?: string;
  reason?: string;
}

export type ConstraintUpdateData = Partial<Omit<ConstraintCreateData, 'reason' | 'scope_id'>> & {
  reason?: string | null;
  scope_id?: string | null;
};
