/**
 * 予算・費用(FR-027)・立替・精算(FR-028)APIの型
 *
 * [Gate P2] backend/app/api/v1/finance.py に対応する。DOC-05 §8.6。
 * 金額は全て文字列(Decimal)。換算レートの無い外貨の支出は base_amount が null になり、
 * 集計・精算から除外される(件数は FinanceSummary.unconverted_expenses)。
 */
export type ExpenseCategory =
  | 'lodging' | 'transport' | 'food' | 'activity' | 'shopping' | 'fee' | 'cancellation' | 'other';
export type SplitMethod = 'equal' | 'ratio' | 'amount' | 'none';
export type BudgetKind = 'total' | 'category' | 'day' | 'member';

export interface FinanceSettings {
  plan_id: string;
  base_currency: string;
  /** 0は未設定(既定のJPY)。PUTのIf-Matchに使う */
  revision: number;
  is_default: boolean;
}

export interface Budget {
  id: string;
  plan_id: string;
  kind: BudgetKind;
  category: ExpenseCategory | null;
  local_date: string | null;
  /** 個人の予算(本人にだけ返る) */
  is_private: boolean;
  amount: string | null;
  currency: string;
  visibility: 'full' | 'unavailable';
  note: string | null;
  revision: number;
  updated_at: string | null;
}

export interface BudgetCreateData {
  kind: BudgetKind;
  amount: string;
  category?: ExpenseCategory;
  local_date?: string;
  note?: string;
}

export interface ExpenseShare {
  user_id: string;
  name: string;
  is_member: boolean;
  weight: string | null;
  share_amount: string;
  base_share_amount: string | null;
  /** 端数として上乗せした額(合計を支出額に一致させるため) */
  rounding_adjustment: string;
}

export interface Expense {
  id: string;
  plan_id: string;
  kind: 'expense' | 'refund';
  refund_of_expense_id: string | null;
  title: string;
  category: ExpenseCategory;
  local_date: string | null;
  amount: string;
  currency: string;
  tax_amount: string | null;
  fee_amount: string | null;
  fx_rate: string | null;
  fx_source: string | null;
  fx_date: string | null;
  base_amount: string | null;
  base_currency: string;
  is_converted: boolean;
  /** 支出に対する返金の合計(返金自体はnull) */
  refunded_amount: string | null;
  paid_by_user_id: string;
  paid_by_name: string;
  paid_by_is_member: boolean;
  split_method: SplitMethod;
  shares: ExpenseShare[];
  related_type: 'event' | 'reservation' | 'segment' | null;
  related_id: string | null;
  related_label: string | null;
  related_missing: boolean;
  receipt_document_id: string | null;
  receipt_missing: boolean;
  note: string | null;
  revision: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ExpenseParticipantInput {
  user_id: string;
  weight?: string;
  amount?: string;
}

export interface ExpenseCreateData {
  title: string;
  category?: ExpenseCategory;
  local_date?: string;
  amount: string;
  currency?: string;
  tax_amount?: string;
  fee_amount?: string;
  fx_rate?: string;
  fx_source?: string;
  fx_date?: string;
  paid_by_user_id?: string;
  split_method?: SplitMethod;
  participants?: ExpenseParticipantInput[];
  note?: string;
  kind?: 'expense' | 'refund';
  refund_of_expense_id?: string;
}

/** 変更する項目だけを送る。nullは値を消す(税・手数料・換算レート・日付・メモ・負担者=全員均等)。 */
export type ExpenseUpdateData = {
  [K in keyof Omit<ExpenseCreateData, 'kind' | 'refund_of_expense_id'>]?: ExpenseCreateData[K] | null;
};

export interface Settlement {
  id: string;
  plan_id: string;
  from_user_id: string;
  from_name: string;
  to_user_id: string;
  to_name: string;
  amount: string;
  currency: string;
  settled_on: string | null;
  note: string | null;
  revision: number;
  created_at: string | null;
}

export interface SettlementCreateData {
  from_user_id: string;
  to_user_id: string;
  amount: string;
  settled_on?: string;
  note?: string;
}

export interface BudgetDiff {
  budget: string | null;
  actual: string;
  remaining: string | null;
  over: boolean;
}

export interface FinanceMemberBalance {
  user_id: string;
  name: string;
  is_member: boolean;
  is_me: boolean;
  paid: string;
  owed: string;
  settled_out: string;
  settled_in: string;
  /** 受け取るべき額(正)/支払うべき額(負) */
  net: string;
}

export interface FinanceTransfer {
  from_user_id: string;
  from_name: string;
  to_user_id: string;
  to_name: string;
  amount: string;
}

export interface FinanceSummary {
  plan_id: string;
  algorithm_version: string;
  base_currency: string;
  total: BudgetDiff;
  tax_total: string;
  fee_total: string;
  refund_total: string;
  reserved: { total: string; unconverted: number };
  by_category: Array<BudgetDiff & { category: ExpenseCategory }>;
  by_day: Array<BudgetDiff & { local_date: string }>;
  undated_actual: string;
  my_budget: (BudgetDiff & { id: string; visibility: 'full' | 'unavailable' }) | null;
  unconverted_expenses: number;
  members: FinanceMemberBalance[];
  transfers: FinanceTransfer[];
  is_settled: boolean;
}
