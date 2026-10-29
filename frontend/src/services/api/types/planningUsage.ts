/**
 * [FR059-B] 旅程相談の外部 API の利用枠の型(docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §8)。
 * 金額は "12.0000" の文字列(円・小数 4 桁)。表示は *_yen_ceil(円の切り上げ)を使う。
 */
export type UsageClass = 'guest' | 'free' | 'trip_pass' | 'plus' | 'family' | 'pro';
export type PlanningUsageState =
  | 'ok' | 'warning' | 'limit_reached' | 'monthly_limit_reached' | 'monthly_plans_reached' | 'guest';

export interface PlanningCallQuota {
  operation: string;
  label: string;
  feature: string;
  limit: number;
  used: number;
  remaining: number;
}

export interface PlanningUsage {
  plan_id: string;
  class: UsageClass;
  class_label: string;
  class_source: string;
  policy_version: string;
  currency: 'JPY';
  plan_cap_jpy: string;
  plan_used_jpy: string;
  plan_reserved_jpy: string;
  plan_remaining_jpy: string;
  plan_used_yen_ceil: number;
  plan_cap_yen: number;
  warn_at_jpy: string;
  state: PlanningUsageState;
  monthly_cap_jpy: string | null;
  monthly_used_jpy: string | null;
  plans_per_month: number | null;
  plans_used_this_month: number;
  counted_this_month: boolean;
  reset_at: string | null;
  calls: PlanningCallQuota[];
  connected_operations: string[];
  providers_connected: boolean;
  fallbacks: string[];
}

export interface EntitlementFeature {
  feature: string;
  quota: number | null;
}

export interface MyEntitlements {
  class: UsageClass;
  class_label: string;
  class_source: string;
  profile_key: string;
  policy_version: string;
  currency: 'JPY';
  plan_cap_jpy: string;
  monthly_cap_jpy: string | null;
  monthly_used_jpy: string;
  plans_per_month: number | null;
  plans_used_this_month: number;
  reset_at: string;
  features: EntitlementFeature[];
  providers_connected: boolean;
  as_of: string;
}

export interface EntitlementGrant {
  id: string;
  subject_type: 'user' | 'plan' | 'organization';
  subject_id: string;
  feature_key: string;
  status: 'pending' | 'active' | 'revoked';
  quota: number | null;
  source: string;
  reason: string | null;
  starts_at: string | null;
  ends_at: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export interface AdminEntitlements {
  grants: EntitlementGrant[];
  effective?: MyEntitlements;
  usage?: Record<string, unknown>;
}
