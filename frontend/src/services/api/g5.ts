/**
 * [Gate G5] FIN-01・FIN-02・BILL-02・ORG-01 の API。
 *
 * 最初に読む JS を小さく保つため(scripts/ci/check_bundle_budget.py)、CompleteTravelAPI には足さず、使う画面
 * (どれも後から読む塊)がここを直接 import する(g4.ts と同じ形)。画面の中で失敗を案内するため、共通のエラーの
 * toast は出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { decodeG5 } from './decodersG5';
import type {
  BudgetVersion, BudgetVersionKind, ExpenseFlags, FinanceSettingsG5, FxRate, OrgBranding, OrgDomain, OrgSeats,
  RemainderTo, RoundingMode, UsageMetric, UsageSummary,
} from './types/g5';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const ifMatch = (revision: number, extra: Record<string, string> = {}): AxiosRequestConfig =>
  ({ ...SILENT, headers: { 'If-Match': String(revision), ...extra } });

// ===== FIN-01・FIN-02
export async function getFinanceSettingsG5(planId: string): Promise<FinanceSettingsG5> {
  return decodeG5('financeSettings', (await api.get(`/plans/${planId}/finance-settings`, SILENT)).data);
}

export async function putRoundingPolicy(planId: string, input: { rounding_mode: RoundingMode; remainder_to: RemainderTo },
  revision: number): Promise<FinanceSettingsG5> {
  return decodeG5('financeSettings', (await api.put(`/plans/${planId}/finance-settings`, input, ifMatch(revision))).data);
}

export async function lockFinance(planId: string): Promise<FinanceSettingsG5> {
  return decodeG5('financeSettings', (await api.post(`/plans/${planId}/finance-lock`, null, SILENT)).data);
}

export async function unlockFinance(planId: string, reason: string): Promise<FinanceSettingsG5> {
  return decodeG5('financeSettings', (await api.delete(`/plans/${planId}/finance-lock`, { ...SILENT, data: { reason } })).data);
}

export async function getFxRates(planId: string): Promise<FxRate[]> {
  return decodeG5('fxRates', (await api.get(`/plans/${planId}/fx-rates`, SILENT)).data);
}

export async function createFxRate(planId: string, input: { currency: string; rate: string; rate_date: string; source: string }):
  Promise<FxRate> {
  return decodeG5('fxRate', (await api.post(`/plans/${planId}/fx-rates`, input, SILENT)).data);
}

export async function getBudgetVersions(planId: string): Promise<BudgetVersion[]> {
  return decodeG5('budgetVersions', (await api.get(`/plans/${planId}/budget-versions`, SILENT)).data);
}

export async function createBudgetVersion(planId: string, input: { kind: BudgetVersionKind; label?: string; note?: string }):
  Promise<BudgetVersion> {
  return decodeG5('budgetVersion', (await api.post(`/plans/${planId}/budget-versions`, input, SILENT)).data);
}

export async function getExpenseFlags(planId: string): Promise<ExpenseFlags[]> {
  return decodeG5('expenseFlagsList', (await api.get(`/plans/${planId}/expenses`, SILENT)).data);
}

export async function voidExpense(planId: string, expenseId: string, reason: string, revision: number): Promise<ExpenseFlags> {
  const r = await api.post(`/plans/${planId}/expenses/${expenseId}/void`, { reason }, ifMatch(revision));
  return decodeG5('expenseFlags', r.data);
}

/** 精算の記録。同じ記録の送り直し(通信の失敗の後など)は同じ Idempotency-Key で二重にならない。 */
export async function recordSettlement(planId: string, input: { from_user_id: string; to_user_id: string; amount: string },
  idempotencyKey: string): Promise<void> {
  await api.post(`/plans/${planId}/settlements`, input, { ...SILENT, headers: { 'Idempotency-Key': idempotencyKey } });
}

// ===== BILL-02
export async function getMyUsage(): Promise<UsageSummary> {
  return decodeG5('usage', (await api.get('/usage', SILENT)).data);
}

export async function getOrgUsage(orgId: string): Promise<UsageSummary> {
  return decodeG5('usage', (await api.get(`/organizations/${orgId}/usage`, SILENT)).data);
}

export async function adminGetUsage(subjectType: 'user' | 'org', subjectId: string): Promise<UsageSummary> {
  const q = `subject_type=${subjectType}&subject_id=${encodeURIComponent(subjectId)}`;
  return decodeG5('usage', (await api.get(`/admin/usage?${q}`, SILENT)).data);
}

export async function adminOverrideUsage(input: {
  subject_type: 'user' | 'org'; subject_id: string; metric: UsageMetric; limit: number | null; reason?: string;
}): Promise<UsageSummary> {
  return decodeG5('usage', (await api.put('/admin/usage/override', input, SILENT)).data);
}

// ===== ORG-01
export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  return decodeG5('orgBranding', (await api.get(`/organizations/${orgId}`, SILENT)).data);
}

export async function getOrgLogoUrl(orgId: string): Promise<string> {
  const r = await api.get(`/organizations/${orgId}/logo`, { ...SILENT, responseType: 'blob' });
  return URL.createObjectURL(r.data as Blob);
}

export async function uploadOrgLogo(orgId: string, file: File): Promise<OrgBranding> {
  const form = new FormData();
  form.append('file', file);
  // Content-Type は axios に boundary つきで付けさせる(documents.ts と同じ)
  const r = await api.put(`/organizations/${orgId}/logo`, form, { ...SILENT, headers: { 'Content-Type': undefined } });
  return decodeG5('orgBranding', r.data);
}

export async function deleteOrgLogo(orgId: string): Promise<OrgBranding> {
  return decodeG5('orgBranding', (await api.delete(`/organizations/${orgId}/logo`, SILENT)).data);
}

export async function getOrgSeats(orgId: string): Promise<OrgSeats> {
  return decodeG5('orgSeats', (await api.get(`/organizations/${orgId}/seats`, SILENT)).data);
}

export async function putSeatLimit(orgId: string, seatLimit: number | null): Promise<OrgBranding> {
  return decodeG5('orgBranding', (await api.put(`/organizations/${orgId}/seat-limit`, { seat_limit: seatLimit }, SILENT)).data);
}

export async function getOrgDomains(orgId: string): Promise<OrgDomain[]> {
  return decodeG5('orgDomains', (await api.get(`/organizations/${orgId}/domains`, SILENT)).data);
}

export async function addOrgDomain(orgId: string, domain: string): Promise<OrgDomain> {
  return decodeG5('orgDomain', (await api.post(`/organizations/${orgId}/domains`, { domain }, SILENT)).data);
}

export async function verifyOrgDomain(orgId: string, domainId: string): Promise<OrgDomain> {
  return decodeG5('orgDomain', (await api.post(`/organizations/${orgId}/domains/${domainId}/verify`, null, SILENT)).data);
}

export async function revokeOrgDomain(orgId: string, domainId: string): Promise<OrgDomain> {
  return decodeG5('orgDomain', (await api.delete(`/organizations/${orgId}/domains/${domainId}`, SILENT)).data);
}
