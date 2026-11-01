/**
 * [Gate OpsCMS] 運用コンソール(backend/app/api/v1/admin_ops.py)。管理者だけ。鍵の値は受け取らない(設定の有無だけ)。
 * 画面の中で失敗を案内するため、共通のエラーの toast は出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, int, nullable, object, oneOf, optional, record, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface OpsUsageTotal { events: number; estimated_jpy: string; actual_jpy: string; requests?: number }
export interface OpsFreeUsage { providers: Record<string, unknown>; requests: number; label: string }
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
  free_usage?: OpsFreeUsage;
}
export type OpsSecretState = 'configured' | 'missing' | 'disabled' | 'placeholder' | 'invalid' | 'decrypt_failed' | 'backend_unavailable'
  | 'not_defined' | 'not_needed';
export type OpsSecretKeyStatus = 'configured' | 'missing' | 'disabled' | 'placeholder' | 'invalid' | 'decrypt_failed'
  | 'backend_unavailable';
export const OPS_SECRET_STATES: OpsSecretState[] = ['configured', 'missing', 'disabled', 'placeholder', 'invalid',
  'decrypt_failed', 'backend_unavailable', 'not_defined', 'not_needed'];
export interface OpsProvider {
  name: string; label: string; purpose: string; operations: string[]; kind: 'fake' | 'paid';
  registered: boolean; suspended: boolean; suspended_reason: string | null;
  contract: 'not_billable' | 'unverified'; secret: OpsSecretState; secret_setting: string | null;
  price_profile: 'known' | 'partial' | 'unavailable'; policy_version: string | null;
  live_calls: 'test_only' | 'ready' | 'disabled'; month_usage: OpsUsageTotal | null; notes: string;
  secret_slot?: string | null; secret_source?: 'cms' | 'env' | null; secret_version?: number | null; secret_last4?: string | null;
  secret_storage?: string | null; adapter?: 'fake' | 'implemented' | 'not_implemented';
  secret_verification?: string | null; adapter_operations?: string[];
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
  tier?: string; included_operations?: string[];
  plan_id: string; class: string; policy_version: string; plan_cap_jpy: string; final_total_jpy: string;
  never_over_cap: boolean; first_user_warning_step: number | null; first_ops_alert_step: number | null;
  first_denial: { n: number; reason: string } | null; settled_steps: number; denied_steps: number;
  idempotency_replay: Record<string, unknown>; provider: string; external_calls: number;
}
export interface OpsFamilyRun {
  as_of: string; case: Record<string, unknown>; summary: OpsRunSummary; steps: OpsRunStep[]; note: string;
}

const total: Decoder<OpsUsageTotal> = object<OpsUsageTotal>({ events: int, estimated_jpy: str, actual_jpy: str,
  requests: optional(int) });

const overview: Decoder<OpsOverview> = object<OpsOverview>({
  as_of: str, environment: str, policy_version: str, month: str,
  thresholds: object({ user_warning_jpy: str, ops_alert_jpy: str, hard_cap_jpy: str }),
  fake_usage: object<OpsUsageTotal & { label: string }>({ events: int, estimated_jpy: str, actual_jpy: str,
    requests: optional(int), label: str }),
  live_usage: object({ providers: record, estimated_jpy: str, label: str }),
  connected_paid_providers: arrayOf(str), suspended_providers: record,
  plan_accounts: object({ total: int, by_state: record }), open_reservations: int,
  cloud_billing: object({ status: str, message: str }),
  free_usage: optional(object<OpsFreeUsage>({ providers: record, requests: int, label: str })),
});

const provider: Decoder<OpsProvider> = object<OpsProvider>({
  name: str, label: str, purpose: str, operations: arrayOf(str), kind: oneOf('fake', 'paid'), registered: bool,
  suspended: bool, suspended_reason: nullable(str), contract: oneOf('not_billable', 'unverified'),
  // backend の provider_secrets.state が返す全ての状態(登録済み・無効化・サンプル値・形の誤り・復号不能・保管先が未接続)
  secret: oneOf(...OPS_SECRET_STATES), secret_setting: nullable(str),
  price_profile: oneOf('known', 'partial', 'unavailable'), policy_version: nullable(str),
  live_calls: oneOf('test_only', 'ready', 'disabled'), month_usage: nullable(total), notes: str,
  secret_slot: optional(nullable(str)), secret_source: optional(nullable(oneOf('cms', 'env'))),
  secret_version: optional(nullable(int)), secret_last4: optional(nullable(str)),
  secret_storage: optional(nullable(str)), adapter: optional(oneOf('fake', 'implemented', 'not_implemented')),
  secret_verification: optional(nullable(str)), adapter_operations: optional(arrayOf(str)),
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
  tier: optional(str), included_operations: optional(arrayOf(str)),
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

export async function runOpsFamilyFake(reason: string, tier: OpsTier = 'explorer'): Promise<OpsFamilyRun> {
  const r = await api.post('/admin/ops/test-runs/family-fake', { reason, tier }, SILENT);
  return decodeResponse(r.data, object<OpsFamilyRun>({
    as_of: str, case: record, summary, steps: arrayOf(step), note: str,
  }), 'POST /admin/ops/test-runs/family-fake');
}

// ===================================================================== 鍵の登録(Gate OpsSecrets)。値は送るだけで、受け取らない

export interface OpsSecretHistory {
  version: number; status: 'active' | 'pending' | 'superseded' | 'disabled'; last4: string; reason: string;
  created_at: string | null; disabled_at: string | null;
}
export interface OpsSecretSlot {
  slot: string; label: string; providers: string[]; env: string; hint: string;
  status: OpsSecretKeyStatus; source: 'cms' | 'env' | null; version: number | null; last4: string | null;
  registered_at: string | null; history: OpsSecretHistory[]; in_use?: boolean; in_use_note?: string;
  env_legacy?: OpsSecretEnvLegacy;
  verification?: OpsSecretVerification | null; candidate?: OpsSecretCandidate | null; verify_supported?: boolean;
}
/** [Gate ProviderConnect] 版の有効性の確認(値は含まない)。state は期限・設定の変更も含めた今の判定 */
export type OpsVerifyState = 'unverified' | 'accepted' | 'rejected' | 'inconclusive' | 'expired' | 'stale';
export interface OpsSecretVerification {
  state: OpsVerifyState; provider_auth: string; code: string | null; verified_at: string | null; expires_at: string | null;
  capabilities: Record<string, unknown>;
}
export interface OpsSecretCandidate {
  version: number; last4: string; registered_at: string | null; format: string; verification: OpsSecretVerification;
}
export interface OpsVerifyBudget { cap_jpy: string; used_jpy: string; remaining_jpy: string; day: string; note: string }
export interface OpsVerifyResult {
  slot: string; version: number; provider_auth: string; code: string | null;
  results: { check: string; code: string; label: string }[]; estimated_cost_jpy: string;
}
/** 旧 .env に値があるか(値は受け取らない)。取得元ではなく、明示の取り込みの判断だけに使う */
export interface OpsSecretEnvLegacy { present: boolean; placeholder: boolean; importable: boolean }
export interface OpsSecretStorage {
  location: string; not_secret_manager: string; backup: string; rotation: string; fallback: string;
}
export interface OpsSecrets {
  as_of: string; slots: OpsSecretSlot[]; note: string; storage?: OpsSecretStorage;
  backend?: string; backend_note?: string; verify_budget?: OpsVerifyBudget | null; model?: string;
}
export interface OpsSecretResult {
  candidate?: OpsSecretCandidate | null;
  slot: string; status: OpsSecretKeyStatus; source: 'cms' | 'env' | null; version: number | null;
  last4: string | null; registered_at: string | null;
}

const secretHistory: Decoder<OpsSecretHistory> = object<OpsSecretHistory>({
  version: int, status: oneOf('active', 'pending', 'superseded', 'disabled'), last4: str, reason: str,
  created_at: nullable(str), disabled_at: nullable(str),
});
const VERIFY_STATES: OpsVerifyState[] = ['unverified', 'accepted', 'rejected', 'inconclusive', 'expired', 'stale'];
const verification: Decoder<OpsSecretVerification> = object<OpsSecretVerification>({
  state: oneOf(...VERIFY_STATES), provider_auth: str, code: nullable(str), verified_at: nullable(str),
  expires_at: nullable(str), capabilities: record,
});
const candidate: Decoder<OpsSecretCandidate> = object<OpsSecretCandidate>({
  version: int, last4: str, registered_at: nullable(str), format: str, verification,
});
const verifyBudget: Decoder<OpsVerifyBudget> = object<OpsVerifyBudget>({
  cap_jpy: str, used_jpy: str, remaining_jpy: str, day: str, note: str,
});
const secretSlot: Decoder<OpsSecretSlot> = object<OpsSecretSlot>({
  slot: str, label: str, providers: arrayOf(str), env: str, hint: str, status: oneOf('configured', 'missing', 'disabled', 'placeholder', 'invalid', 'decrypt_failed',
    'backend_unavailable'),
  source: nullable(oneOf('cms', 'env')), version: nullable(int), last4: nullable(str), registered_at: nullable(str),
  history: arrayOf(secretHistory), in_use: optional(bool), in_use_note: optional(str),
  env_legacy: optional(object<OpsSecretEnvLegacy>({ present: bool, placeholder: bool, importable: bool })),
  verification: optional(nullable(verification)), candidate: optional(nullable(candidate)), verify_supported: optional(bool),
});
const secretResult: Decoder<OpsSecretResult> = object<OpsSecretResult>({
  slot: str, status: oneOf('configured', 'missing', 'disabled', 'placeholder', 'invalid', 'decrypt_failed',
    'backend_unavailable'), source: nullable(oneOf('cms', 'env')), version: nullable(int),
  last4: nullable(str), registered_at: nullable(str),
  candidate: optional(nullable(candidate)),
});

export async function getOpsSecrets(): Promise<OpsSecrets> {
  const r = await api.get('/admin/ops/secrets', SILENT);
  return decodeResponse(r.data, object<OpsSecrets>({ as_of: str, slots: arrayOf(secretSlot), note: str,
    backend: optional(str), backend_note: optional(str), verify_budget: optional(nullable(verifyBudget)),
    model: optional(str),
    storage: optional(object<OpsSecretStorage>({ location: str, not_secret_manager: str, backup: str, rotation: str,
      fallback: str })) }), 'GET /admin/ops/secrets');
}

/** 鍵を登録する(新しい版)。応答に鍵の値は含まれない。 */
export async function registerOpsSecret(slot: string, value: string, reason: string): Promise<OpsSecretResult> {
  const r = await api.post(`/admin/ops/secrets/${encodeURIComponent(slot)}`, { value, reason }, SILENT);
  return decodeResponse(r.data, secretResult, 'POST /admin/ops/secrets/{slot}');
}

/** 旧 .env の値を新しい版として取り込む(明示操作)。値は送らず・受け取らない。 */
export async function importOpsSecretFromEnv(slot: string, reason: string): Promise<OpsSecretResult> {
  const r = await api.post(`/admin/ops/secrets/${encodeURIComponent(slot)}/import-env`, { reason }, SILENT);
  return decodeResponse(r.data, secretResult, 'POST /admin/ops/secrets/{slot}/import-env');
}

/** [Gate ProviderConnect] 版の有効性を提供元へ最小の要求で確かめる(費用は管理者の確認の日の枠)。 */
export async function verifyOpsSecret(slot: string, version: number, reason: string): Promise<OpsVerifyResult> {
  const r = await api.post(`/admin/ops/secrets/${encodeURIComponent(slot)}/verify`, { version, reason }, SILENT);
  return decodeResponse(r.data, object<OpsVerifyResult>({
    slot: str, version: int, provider_auth: str, code: nullable(str),
    results: arrayOf(object<{ check: string; code: string; label: string }>({ check: str, code: str, label: str })),
    estimated_cost_jpy: str,
  }), 'POST /admin/ops/secrets/{slot}/verify');
}

/** 確認が通った候補を有効にする(今の有効な版を条件にする) */
export async function activateOpsSecret(slot: string, version: number, expectedActiveVersion: number | null,
  reason: string): Promise<OpsSecretResult> {
  const r = await api.post(`/admin/ops/secrets/${encodeURIComponent(slot)}/activate`,
    { version, expected_active_version: expectedActiveVersion, reason }, SILENT);
  return decodeResponse(r.data, secretResult, 'POST /admin/ops/secrets/{slot}/activate');
}

export async function discardOpsSecret(slot: string, reason: string): Promise<OpsSecretResult> {
  const r = await api.post(`/admin/ops/secrets/${encodeURIComponent(slot)}/discard`, { reason }, SILENT);
  return decodeResponse(r.data, secretResult, 'POST /admin/ops/secrets/{slot}/discard');
}

export async function disableOpsSecret(slot: string, reason: string): Promise<OpsSecretResult> {
  const r = await api.post(`/admin/ops/secrets/${encodeURIComponent(slot)}/disable`, { reason }, SILENT);
  return decodeResponse(r.data, secretResult, 'POST /admin/ops/secrets/{slot}/disable');
}

// ===================================================================== 会員の機能クラス(Gate FR059-Tiers)

export type OpsTier = 'free' | 'trip' | 'journey' | 'explorer';
export const OPS_TIERS: OpsTier[] = ['free', 'trip', 'journey', 'explorer'];
export type OpsMark = '○' | '△' | '—';
export interface OpsTierRow {
  key: OpsTier; label: string; subtitle: string; summary: string; operations: string[]; ai: boolean; paid_api: boolean;
  profile: 'known' | 'unavailable'; policy_version?: string; plan_cap_jpy?: string; monthly_cap_jpy?: string | null;
  plans_per_month?: number | null; quotas?: Record<string, unknown>; worst_case_plan_jpy?: string; fits_plan_cap?: boolean;
}
export interface OpsTierFeature {
  key: string; label: string; free: OpsMark; trip: OpsMark; journey: OpsMark; explorer: OpsMark;
  enforcement: 'server' | 'existing' | 'none'; note: string; operations?: string[];
}
export interface OpsTiers {
  as_of: string; policy_version: string; tiers: OpsTierRow[]; features: OpsTierFeature[];
  legacy: Array<{ legacy: string; rule: string }>;
  thresholds: { user_warning_jpy: string; ops_alert_jpy: string; hard_cap_jpy: string }; rule: string;
  test_switch: { enabled: boolean; hours: number; note: string };
}
export interface OpsTestTierResult {
  user_id: string; requested: OpsTier; before: string; effective: { class: string; class_label: string };
  revoked_test_grants: number; expires_in_hours: number | null; note: string;
}

const tierKey = oneOf<OpsTier>('free', 'trip', 'journey', 'explorer');
const mark = oneOf<OpsMark>('○', '△', '—');
const tierRow: Decoder<OpsTierRow> = object<OpsTierRow>({
  key: tierKey, label: str, subtitle: str, summary: str, operations: arrayOf(str), ai: bool, paid_api: bool,
  profile: oneOf('known', 'unavailable'), policy_version: optional(str), plan_cap_jpy: optional(str),
  monthly_cap_jpy: optional(nullable(str)), plans_per_month: optional(nullable(int)), quotas: optional(record),
  worst_case_plan_jpy: optional(str), fits_plan_cap: optional(bool),
});
const tierFeature: Decoder<OpsTierFeature> = object<OpsTierFeature>({
  key: str, label: str, free: mark, trip: mark, journey: mark, explorer: mark,
  enforcement: oneOf('server', 'existing', 'none'), note: str, operations: optional(arrayOf(str)),
});

export async function getOpsTiers(): Promise<OpsTiers> {
  const r = await api.get('/admin/ops/tiers', SILENT);
  return decodeResponse(r.data, object<OpsTiers>({
    as_of: str, policy_version: str, tiers: arrayOf(tierRow), features: arrayOf(tierFeature),
    legacy: arrayOf(object({ legacy: str, rule: str })),
    thresholds: object({ user_warning_jpy: str, ops_alert_jpy: str, hard_cap_jpy: str }), rule: str,
    test_switch: object({ enabled: bool, hours: int, note: str }),
  }), 'GET /admin/ops/tiers');
}

/** 開発環境だけ: 利用者(既定は自分)のクラスを試験のために切り替える(理由が必須・24時間・監査)。 */
export async function switchOpsTestTier(tier: OpsTier, reason: string, userId?: string): Promise<OpsTestTierResult> {
  const r = await api.post('/admin/ops/test-tier', { tier, reason, ...(userId ? { user_id: userId } : {}) }, SILENT);
  return decodeResponse(r.data, object<OpsTestTierResult>({
    user_id: str, requested: tierKey, before: str,
    effective: object<{ class: string; class_label: string }>({ class: str, class_label: str }),
    revoked_test_grants: int, expires_in_hours: nullable(int), note: str,
  }), 'POST /admin/ops/test-tier');
}
