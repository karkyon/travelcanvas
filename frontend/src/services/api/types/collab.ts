/**
 * [Gate C1] FR-020 共同編集(同じ旅行を開いている人・編集中・他の人の変更)と FR-023 秘匿プロフィールの型。
 * backend/app/api/v1/presence.py・private_profile.py の応答。
 */
export type PresenceRole = 'owner' | 'editor' | 'viewer';

export interface PresenceEditing {
  kind: 'event';
  id: string;
  label: string;
}

export interface PresenceViewer {
  user_id: string;
  /** 他の人は利用者名(メールアドレスは出さない。ゲストは「ゲスト」)。自分は「あなた」 */
  label: string;
  role: PresenceRole;
  is_self: boolean;
  devices: number;
  seen_at: string;
  editing: PresenceEditing | null;
}

export interface PresenceChangeItem {
  entity_type: string;
  action: string;
  label: string | null;
}

export interface PresenceChange {
  revision: number;
  actor_label: string;
  is_self: boolean;
  source: string;
  undone: boolean;
  count: number;
  items: PresenceChangeItem[];
  at: string | null;
}

export interface PresenceState {
  plan_id: string;
  revision: number;
  viewers: PresenceViewer[];
  /** 送った known_revision より後の変更(古い順) */
  changes: PresenceChange[];
  /** 次に知らせるまでの秒数(他の人がいると短い) */
  poll_seconds: number;
  ttl_seconds: number;
}

export type PrivateProfileKind =
  | 'earliest_start' | 'latest_end' | 'daily_travel_max' | 'meal_interval_max' | 'trip_budget_max'
  | 'avoid_text' | 'avoid_transport';

export interface PrivateProfileItem {
  id: string;
  kind: PrivateProfileKind;
  label: string;
  hardness: 'hard' | 'soft';
  value: string | number;
  unit: string | null;
}

export interface PrivateProfileItemInput {
  id?: string;
  kind: PrivateProfileKind;
  label: string;
  hardness: 'hard' | 'soft';
  value: string | number;
  unit?: string | null;
}

export interface PrivateProfileKindInfo {
  kind: PrivateProfileKind;
  label: string;
  value_type: 'time' | 'number' | 'text';
  units: string[];
}

export interface PrivateProfile {
  revision: number;
  items: PrivateProfileItem[];
  /** false = 保存済みの内容を復号できない(暗号鍵の問題) */
  readable: boolean;
  kinds: PrivateProfileKindInfo[];
  max_items: number;
  applied_plans: { plan_id: string; title: string | null }[];
}

export interface PlanPrivateProfile {
  plan_id: string;
  applied: boolean;
  profile_items: number;
  applied_constraints: number;
  profile_revision: number;
}
