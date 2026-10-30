/**
 * [Gate OpsCMS] 運用コンソール(backend/app/api/v1/admin_ops.py)。管理者だけ。鍵の値は受け取らない(設定の有無だけ)。
 * 画面の中で失敗を案内するため、共通のエラーの toast は出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, int, nullable, object, oneOf, optional, record, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface OpsUsageTotal { events: number; estimated_jpy: string; actual_jpy: string }
export interface OpsOverview {
  as_of: string; environment: string; policy_version: string; month: string;
  thresholds: { user_warning_jpy: string; ops_alert_jpy: string; hard_cap_jpy: string };
  fake_usage: OpsUsageTotal & { label: string };
  live_usage: { providers: Record<string, unknown>; estimated_jpy: string; label: string };
  connected_paid_providers: string[];
  suspended_providers: Record<string, unknown>;
  plan_accounts: { total: number; by_state: Record<string, unknown> };
  open_reservations: number;
  cloud_billing: { status: string; message: string };
}
export type OpsSecretState = 'configured' | 'missing' | 'not_defined' | 'not_needed';
export interface OpsProvider {
  name: string; label: string; purpose: string; operations: string[]; kind: 'fake' | 'paid';
  registered: boolean; suspended: boolean; suspended_reason: string | null;
  contract: 'not_billable' | 'unverified'; secret: OpsSecretState; secret_setting: string | null;
  price_profile: 'known' | 'partial' | 'unavailable'; policy_version: string | null;
  live_calls: 'test_only' | 'ready' | 'disabled'; month_usage: OpsUsageTotal | null; notes: string;
}
export interface OpsProviders { as_of: string; providers: OpsProvider[]; rule: string }
export interface OpsLedgerRow {
  plan_ref: string; plan_id: string; class: string; policy_version: string; cap_jpy: string; settled_jpy: string;
  reserved_jpy: string; max_total_jpy: string; remaining_jpy: string; state: string; counts: Record<string, unknown>;
  providers: Record<string, unknown>; settled_events: number; released_events: number; fake_only: boolean;
  updated_at: string | null;
}
export interface OpsLedger { as_of: string; rows: OpsLedgerRow[]; note: string }
export interface OpsCloudItem { key: string; label: string; value: string | null; source: string; status: 'known' | 'unavailable' }
export interface OpsCloud {
  as_of: string; items: OpsCloudItem[]; unavailable: Array<{ key: string; label: string; reason: string }>; note: string;
}
export interface OpsRunStep {
  n: number; operation: string; label: string; units: Record<string, unknown>; result: 'settled' | 'denied';
  reason?: string; max_cost_jpy?: string; plan_total_jpy: string; state: string;
}
export interface OpsRunSummary {
  plan_id: string; class: string; policy_version: string; plan_cap_jpy: string; final_total_jpy: string;
  never_over_cap: boolean; first_user_warning_step: number | null; first_ops_alert_step: number | null;
  first_denial: { n: number; reason: string } | null; settled_steps: number; denied_steps: number;
  idempotency_replay: Record<string, unknown>; provider: string; external_calls: number;
}
export interface OpsFamilyRun {
  as_of: string; case: Record<string, unknown>; summary: OpsRunSummary; steps: OpsRunStep[]; note: string;
}

const total: Decoder<OpsUsageTotal> = object<OpsUsageTotal>({ events: int, estimated_jpy: str, actual_jpy: str });

const overview: Decoder<OpsOverview> = object<OpsOverview>({
  as_of: str, environment: str, policy_version: str, month: str,
  thresholds: object({ user_warning_jpy: str, ops_alert_jpy: str, hard_cap_jpy: str }),
  fake_usage: object<OpsUsageTotal & { label: string }>({ events: int, estimated_jpy: str, actual_jpy: str, label: str }),
  live_usage: object({ providers: record, estimated_jpy: str, label: str }),
  connected_paid_providers: arrayOf(str), suspended_providers: record,
  plan_accounts: object({ total: int, by_state: record }), open_reservations: int,
  cloud_billing: object({ status: str, message: str }),
});

const provider: Decoder<OpsProvider> = object<OpsProvider>({
  name: str, label: str, purpose: str, operations: arrayOf(str), kind: oneOf('fake', 'paid'), registered: bool,
  suspended: bool, suspended_reason: nullable(str), contract: oneOf('not_billable', 'unverified'),
  secret: oneOf('configured', 'missing', 'not_defined', 'not_needed'), secret_setting: nullable(str),
  price_profile: oneOf('known', 'partial', 'unavailable'), policy_version: nullable(str),
  live_calls: oneOf('test_only', 'ready', 'disabled'), month_usage: nullable(total), notes: str,
});

const ledgerRow: Decoder<OpsLedgerRow> = object<OpsLedgerRow>({
  plan_ref: str, plan_id: str, class: str, policy_version: str, cap_jpy: str, settled_jpy: str, reserved_jpy: str,
  max_total_jpy: str, remaining_jpy: str, state: str, counts: record, providers: record, settled_events: int,
  released_events: int, fake_only: bool, updated_at: nullable(str),
});

const cloudItem: Decoder<OpsCloudItem> = object<OpsCloudItem>({
  key: str, label: str, value: nullable(str), source: str, status: oneOf('known', 'unavailable'),
});

const step: Decoder<OpsRunStep> = object<OpsRunStep>({
  n: int, operation: str, label: str, units: record, result: oneOf('settled', 'denied'), reason: optional(str),
  max_cost_jpy: optional(str), plan_total_jpy: str, state: str,
});

const summary: Decoder<OpsRunSummary> = object<OpsRunSummary>({
  plan_id: str, class: str, policy_version: str, plan_cap_jpy: str, final_total_jpy: str, never_over_cap: bool,
  first_user_warning_step: nullable(int), first_ops_alert_step: nullable(int),
  first_denial: nullable(object({ n: int, reason: str })), settled_steps: int, denied_steps: int,
  idempotency_replay: record, provider: str, external_calls: int,
});

export async function getOpsOverview(): Promise<OpsOverview> {
  const r = await api.get('/admin/ops/overview', SILENT);
  return decodeResponse(r.data, overview, 'GET /admin/ops/overview');
}

export async function getOpsProviders(): Promise<OpsProviders> {
  const r = await api.get('/admin/ops/providers', SILENT);
  return decodeResponse(r.data, object<OpsProviders>({ as_of: str, providers: arrayOf(provider), rule: str }),
    'GET /admin/ops/providers');
}

export async function setOpsProviderSuspended(name: string, suspend: boolean, reason: string): Promise<void> {
  if (suspend) await api.post(`/admin/ops/providers/${encodeURIComponent(name)}/suspend`, { reason }, SILENT);
  else await api.post(`/admin/ops/providers/${encodeURIComponent(name)}/resume`, { reason }, SILENT);
}

export async function getOpsLedger(): Promise<OpsLedger> {
  const r = await api.get('/admin/ops/ledger', SILENT);
  return decodeResponse(r.data, object<OpsLedger>({ as_of: str, rows: arrayOf(ledgerRow), note: str }),
    'GET /admin/ops/ledger');
}

export async function getOpsCloud(): Promise<OpsCloud> {
  const r = await api.get('/admin/ops/cloud', SILENT);
  return decodeResponse(r.data, object<OpsCloud>({
    as_of: str, items: arrayOf(cloudItem), unavailable: arrayOf(object({ key: str, label: str, reason: str })), note: str,
  }), 'GET /admin/ops/cloud');
}

export async function runOpsFamilyFake(reason: string): Promise<OpsFamilyRun> {
  const r = await api.post('/admin/ops/test-runs/family-fake', { reason }, SILENT);
  return decodeResponse(r.data, object<OpsFamilyRun>({
    as_of: str, case: record, summary, steps: arrayOf(step), note: str,
  }), 'POST /admin/ops/test-runs/family-fake');
}
