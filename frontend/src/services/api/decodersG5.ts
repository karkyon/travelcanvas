/**
 * [Gate G5] 費用の記録・使用量・組織のロゴ等の応答の decoder(使う画面が g5.ts 経由で読む。最初に読む JS に入れない)。
 */
import type {
  BudgetVersion, ExpenseFlags, FinanceSettingsG5, FxRate, OrgBranding, OrgDomain, OrgSeats, UsageSummary,
} from './types/g5';
import { arrayOf, bool, decodeResponse, nullable, num, object, oneOf, record, str, type Decoder } from './decode';

const rounding = oneOf('half_up', 'down', 'up');
const remainder = oneOf('largest', 'payer', 'first');

export const financeSettingsG5: Decoder<FinanceSettingsG5> = object<FinanceSettingsG5>({
  plan_id: str, base_currency: str, revision: num, is_default: bool, rounding_mode: rounding, remainder_to: remainder,
  locked_at: nullable(str), locked_by_user_id: nullable(str),
});

export const fxRate: Decoder<FxRate> = object<FxRate>({
  id: str, plan_id: str, currency: str, base_currency: str, rate: str, rate_date: str, source: str,
  retrieved_at: nullable(str), created_at: nullable(str),
});

export const budgetVersion: Decoder<BudgetVersion> = object<BudgetVersion>({
  id: str, plan_id: str, kind: oneOf('initial', 'revised', 'committed', 'actual'), label: str, base_currency: str,
  total_amount: nullable(str), lines: arrayOf(object({ key: str, label: str, amount: nullable(str) })),
  unconverted: record, note: nullable(str), created_by_user_id: nullable(str), created_at: nullable(str),
});

export const expenseFlags: Decoder<ExpenseFlags> = object<ExpenseFlags>({
  id: str, fx_rate_id: nullable(str), is_voided: bool, voided_at: nullable(str), void_reason: nullable(str),
});

const metric = oneOf('upload_bytes', 'imports', 'route_requests', 'share_links', 'distributions');
export const usageSummary: Decoder<UsageSummary> = object<UsageSummary>({
  subject_type: oneOf('user', 'org'), subject_id: str, period: str,
  metrics: arrayOf(object({
    metric, label: str, used: num, limit: num, soft_limit: num, remaining: num, warning: bool, exceeded: bool,
    overridden: bool, override_reason: nullable(str),
  })),
});

export const orgDomain: Decoder<OrgDomain> = object<OrgDomain>({
  id: str, domain: str, status: oneOf('pending', 'verified', 'failed', 'revoked'), txt_name: str, txt_value: str,
  verified_at: nullable(str), last_checked_at: nullable(str), last_error: nullable(str), created_at: nullable(str),
});

export const orgBranding: Decoder<OrgBranding> = object<OrgBranding>({
  id: str, has_logo: bool, logo_version: nullable(str), seat_limit: nullable(num), verified_domains: arrayOf(str),
});

export const orgSeats: Decoder<OrgSeats> = object<OrgSeats>({
  seat_limit: nullable(num), seats_used: num, seats_remaining: nullable(num),
  events: arrayOf(object({ event: oneOf('join', 'leave', 'limit'), seats_after: num, created_at: nullable(str) })),
});

export interface G5Types {
  financeSettings: FinanceSettingsG5;
  fxRate: FxRate;
  fxRates: FxRate[];
  budgetVersion: BudgetVersion;
  budgetVersions: BudgetVersion[];
  expenseFlags: ExpenseFlags;
  expenseFlagsList: ExpenseFlags[];
  usage: UsageSummary;
  orgDomain: OrgDomain;
  orgDomains: OrgDomain[];
  orgBranding: OrgBranding;
  orgSeats: OrgSeats;
}

const G5: { [K in keyof G5Types]: [Decoder<G5Types[K]>, string] } = {
  financeSettings: [financeSettingsG5, 'GET /plans/{plan_id}/finance-settings'],
  fxRate: [fxRate, 'POST /plans/{plan_id}/fx-rates'],
  fxRates: [arrayOf(fxRate), 'GET /plans/{plan_id}/fx-rates'],
  budgetVersion: [budgetVersion, 'POST /plans/{plan_id}/budget-versions'],
  budgetVersions: [arrayOf(budgetVersion), 'GET /plans/{plan_id}/budget-versions'],
  expenseFlags: [expenseFlags, 'POST /plans/{plan_id}/expenses/{expense_id}/void'],
  expenseFlagsList: [arrayOf(expenseFlags), 'GET /plans/{plan_id}/expenses'],
  usage: [usageSummary, 'GET /usage'],
  orgDomain: [orgDomain, 'POST /organizations/{org_id}/domains'],
  orgDomains: [arrayOf(orgDomain), 'GET /organizations/{org_id}/domains'],
  orgBranding: [orgBranding, 'GET /organizations/{org_id}'],
  orgSeats: [orgSeats, 'GET /organizations/{org_id}/seats'],
};

export function decodeG5<K extends keyof G5Types>(key: K, data: unknown): G5Types[K] {
  const [decoder, label] = G5[key];
  return decodeResponse(data, decoder, label);
}
