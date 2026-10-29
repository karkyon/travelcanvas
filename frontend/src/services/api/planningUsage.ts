/**
 * [FR059-B] 旅程相談の外部 API の利用枠(backend/app/api/v1/planning_usage.py)。
 * 画面の中で失敗を案内するため、共通のエラーの toast は出さない(SILENT)。上限・クラスは送らない(サーバーが決める)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, int, nullable, object, oneOf, optional, record, str, type Decoder } from './decode';
import type {
  AdminEntitlements, EntitlementFeature, EntitlementGrant, MyEntitlements, PlanningCallQuota, PlanningUsage,
} from './types/planningUsage';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const CLASSES = ['guest', 'free', 'trip_pass', 'plus', 'family', 'pro'] as const;
const STATES = ['ok', 'warning', 'limit_reached', 'monthly_limit_reached', 'monthly_plans_reached', 'guest'] as const;

const call: Decoder<PlanningCallQuota> = object<PlanningCallQuota>({
  operation: str, label: str, feature: str, limit: int, used: int, remaining: int,
});

const planningUsage: Decoder<PlanningUsage> = object<PlanningUsage>({
  plan_id: str, class: oneOf(...CLASSES), class_label: str, class_source: str, policy_version: str,
  currency: oneOf('JPY'), plan_cap_jpy: str, plan_used_jpy: str, plan_reserved_jpy: str, plan_remaining_jpy: str,
  plan_used_yen_ceil: int, plan_cap_yen: int, warn_at_jpy: str, state: oneOf(...STATES),
  monthly_cap_jpy: nullable(str), monthly_used_jpy: nullable(str), plans_per_month: nullable(int),
  plans_used_this_month: int, counted_this_month: bool, reset_at: nullable(str), calls: arrayOf(call),
  connected_operations: arrayOf(str), providers_connected: bool, fallbacks: arrayOf(str),
});

const feature: Decoder<EntitlementFeature> = object<EntitlementFeature>({ feature: str, quota: nullable(int) });

const mine: Decoder<MyEntitlements> = object<MyEntitlements>({
  class: oneOf(...CLASSES), class_label: str, class_source: str, profile_key: str, policy_version: str,
  currency: oneOf('JPY'), plan_cap_jpy: str, monthly_cap_jpy: nullable(str), monthly_used_jpy: str,
  plans_per_month: nullable(int), plans_used_this_month: int, reset_at: str, features: arrayOf(feature),
  providers_connected: bool, as_of: str,
});

const grant: Decoder<EntitlementGrant> = object<EntitlementGrant>({
  id: str, subject_type: oneOf('user', 'plan', 'organization'), subject_id: str, feature_key: str,
  status: oneOf('pending', 'active', 'revoked'), quota: nullable(int), source: str, reason: nullable(str),
  starts_at: nullable(str), ends_at: nullable(str), requested_by: nullable(str), approved_by: nullable(str),
  approved_at: nullable(str),
});

const adminList: Decoder<AdminEntitlements> = object<AdminEntitlements>({
  grants: arrayOf(grant), effective: optional(mine), usage: optional(record),
});

export async function getMyEntitlements(): Promise<MyEntitlements> {
  const r = await api.get('/entitlements', SILENT);
  return decodeResponse(r.data, mine, 'GET /entitlements');
}

export async function getPlanningUsage(planId: string): Promise<PlanningUsage> {
  const r = await api.get(`/plans/${planId}/planning-usage`, SILENT);
  return decodeResponse(r.data, planningUsage, 'GET /plans/{id}/planning-usage');
}

export async function adminListEntitlements(subjectType: 'user' | 'plan', subjectId: string): Promise<AdminEntitlements> {
  const r = await api.get('/admin/entitlements', { ...SILENT, params: { subject_type: subjectType, subject_id: subjectId } });
  return decodeResponse(r.data, adminList, 'GET /admin/entitlements');
}

export async function adminRequestEntitlement(body: {
  subject_type: 'user' | 'plan'; subject_id: string; feature_key: string; reason: string; quota?: number;
}): Promise<EntitlementGrant> {
  const r = await api.post('/admin/entitlements', body, SILENT);
  return decodeResponse(r.data, grant, 'POST /admin/entitlements');
}

export async function adminApproveEntitlement(id: string): Promise<EntitlementGrant> {
  const r = await api.post(`/admin/entitlements/${id}/approve`, {}, SILENT);
  return decodeResponse(r.data, grant, 'POST /admin/entitlements/{id}/approve');
}

export async function adminRevokeEntitlement(id: string, reason: string): Promise<EntitlementGrant> {
  const r = await api.post(`/admin/entitlements/${id}/revoke`, { reason }, SILENT);
  return decodeResponse(r.data, grant, 'POST /admin/entitlements/{id}/revoke');
}
