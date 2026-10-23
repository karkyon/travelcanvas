/**
 * [Gate G5] FIN-01 為替の記録・予算の版 / FIN-02 取消・端数の規則・締め / BILL-02 使用量 / ORG-01 ロゴ・ドメイン・席 の型。
 */
export type RoundingMode = 'half_up' | 'down' | 'up';
export type RemainderTo = 'largest' | 'payer' | 'first';
export type BudgetVersionKind = 'initial' | 'revised' | 'committed' | 'actual';

export interface FinanceSettingsG5 {
  plan_id: string;
  base_currency: string;
  revision: number;
  is_default: boolean;
  rounding_mode: RoundingMode;
  remainder_to: RemainderTo;
  locked_at: string | null;
  locked_by_user_id: string | null;
}

export interface FxRate {
  id: string;
  plan_id: string;
  currency: string;
  base_currency: string;
  rate: string;
  rate_date: string;
  source: string;
  retrieved_at: string | null;
  created_at: string | null;
}

export interface BudgetVersionLine {
  key: string;
  label: string;
  amount: string | null;
}

export interface BudgetVersion {
  id: string;
  plan_id: string;
  kind: BudgetVersionKind;
  label: string;
  base_currency: string;
  total_amount: string | null;
  lines: BudgetVersionLine[];
  unconverted: Record<string, unknown>;
  note: string | null;
  created_by_user_id: string | null;
  created_at: string | null;
}

/** 支出の G5 の項目(一覧の応答に含まれる)。 */
export interface ExpenseFlags {
  id: string;
  fx_rate_id: string | null;
  is_voided: boolean;
  voided_at: string | null;
  void_reason: string | null;
}

export type UsageMetric = 'upload_bytes' | 'imports' | 'route_requests' | 'share_links' | 'distributions';

export interface UsageRow {
  metric: UsageMetric;
  label: string;
  used: number;
  limit: number;
  soft_limit: number;
  remaining: number;
  warning: boolean;
  exceeded: boolean;
  overridden: boolean;
  override_reason: string | null;
}

export interface UsageSummary {
  subject_type: 'user' | 'org';
  subject_id: string;
  period: string;
  metrics: UsageRow[];
}

export type DomainStatus = 'pending' | 'verified' | 'failed' | 'revoked';

export interface OrgDomain {
  id: string;
  domain: string;
  status: DomainStatus;
  txt_name: string;
  txt_value: string;
  verified_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string | null;
}

export interface OrgBranding {
  id: string;
  has_logo: boolean;
  logo_version: string | null;
  seat_limit: number | null;
  verified_domains: string[];
}

export interface OrgSeats {
  seat_limit: number | null;
  seats_used: number;
  seats_remaining: number | null;
  events: { event: 'join' | 'leave' | 'limit'; seats_after: number; created_at: string | null }[];
}
