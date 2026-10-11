/**
 * [Gate P2] 予算・費用画面(FR-027 / FR-028)の表示整形と入力変換。
 *
 * 画面(ExpensesPage)から分離した純粋関数。backend(app/api/v1/finance.py)の規則に合わせる:
 *   - 金額は文字列(Decimal)で送受信する。通貨ごとの小数桁(JPY=0、USD=2等)を超えたら入力エラー
 *   - 基準通貨以外の支出は換算レート(1 外貨 = レート 基準通貨)を入れると集計に含まれる。
 *     入れなければ「換算できない支出」として集計・精算から除外される(画面で件数を示す)
 *   - 分担: 均等・比率・金額指定・負担なし(支払者だけ)。金額指定は合計が支出額と一致する必要がある
 */
import type {
  BudgetKind, Expense, ExpenseCategory, ExpenseCreateData, ExpenseParticipantInput, FinanceSummary, PlanMember,
  SplitMethod,
} from '@/services/api';

export const CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] = [
  { value: 'lodging', label: '宿泊' },
  { value: 'transport', label: '交通' },
  { value: 'food', label: '食事' },
  { value: 'activity', label: '観光・体験' },
  { value: 'shopping', label: '買い物' },
  { value: 'fee', label: '手数料' },
  { value: 'cancellation', label: '取消料' },
  { value: 'other', label: 'その他' },
];

export const SPLIT_OPTIONS: { value: SplitMethod; label: string }[] = [
  { value: 'equal', label: '均等に分ける' },
  { value: 'ratio', label: '比率で分ける' },
  { value: 'amount', label: '金額を指定する' },
  { value: 'none', label: '分けない(支払った人が負担)' },
];

export const BUDGET_KIND_LABEL: Record<BudgetKind, string> = {
  total: '旅行全体', category: 'カテゴリ別', day: '日別', member: '自分の予算(自分だけに表示)',
};

export const CURRENCY_OPTIONS = ['JPY', 'USD', 'EUR', 'KRW', 'TWD', 'CNY', 'GBP', 'THB', 'AUD', 'SGD', 'HKD', 'VND'];

const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.value, o.label])) as Record<ExpenseCategory, string>;
export const categoryLabel = (c: ExpenseCategory): string => CATEGORY_LABEL[c] ?? c;

export const minorDigits = (currency: string): number => (ZERO_DECIMAL.has(currency) ? 0 : 2);

/** "1234.5" + "USD" → "1,234.50 USD"。金額文字列をそのまま桁区切りする(浮動小数点に変換しない)。 */
export function formatMoney(amount: string | null | undefined, currency: string): string {
  if (amount == null) return '—';
  const negative = amount.startsWith('-');
  const [intPart = '0', frac = ''] = amount.replace('-', '').split('.');
  const digits = minorDigits(currency);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracPart = digits > 0 ? `.${(frac + '0'.repeat(digits)).slice(0, digits)}` : '';
  const symbol = currency === 'JPY' ? '円' : ` ${currency}`;
  return `${negative ? '-' : ''}${grouped}${fracPart}${symbol}`;
}

/** 通貨の小数桁に合う0以上の金額文字列か */
export function isValidAmount(value: string, currency: string, allowZero = true): boolean {
  const digits = minorDigits(currency);
  const re = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);
  if (!re.test(value.trim())) return false;
  return allowZero || Number(value) > 0;
}

/** 精算の差額の説明。正=受け取る、負=支払う */
export function describeNet(net: string, currency: string): string {
  if (/^-?0(\.0+)?$/.test(net)) return '精算済み';
  return net.startsWith('-')
    ? `${formatMoney(net.slice(1), currency)} 支払う`
    : `${formatMoney(net, currency)} 受け取る`;
}

export function summaryNotices(s: FinanceSummary | null): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.unconverted_expenses > 0) {
    out.push(`換算レートが未入力の外貨の支出が${s.unconverted_expenses}件あり、合計・精算に含まれていません。`);
  }
  if (s.reserved.unconverted > 0) {
    out.push(`基準通貨以外(または通貨未入力)の予約${s.reserved.unconverted}件は予約額に含まれていません。`);
  }
  return out;
}

export interface ExpenseForm {
  title: string;
  category: ExpenseCategory;
  local_date: string;
  amount: string;
  currency: string;
  fx_rate: string;
  tax_amount: string;
  fee_amount: string;
  paid_by_user_id: string;
  split_method: SplitMethod;
  /** user_id → 参加するか・比率・金額 */
  participants: Record<string, { selected: boolean; weight: string; amount: string }>;
  note: string;
}

export function emptyExpenseForm(members: PlanMember[], baseCurrency: string): ExpenseForm {
  const me = members.find((m) => m.is_me);
  return {
    title: '', category: 'food', local_date: '', amount: '', currency: baseCurrency, fx_rate: '', tax_amount: '',
    fee_amount: '', paid_by_user_id: me?.user_id ?? members[0]?.user_id ?? '', split_method: 'equal',
    participants: Object.fromEntries(members.map((m) => [m.user_id, { selected: true, weight: '1', amount: '' }])),
    note: '',
  };
}

export function expenseFormFromExpense(e: Expense, members: PlanMember[]): ExpenseForm {
  const shares = new Map(e.shares.map((s) => [s.user_id, s]));
  const ids = new Set([...members.map((m) => m.user_id), ...e.shares.map((s) => s.user_id)]);
  return {
    title: e.title, category: e.category, local_date: e.local_date ?? '', amount: e.amount, currency: e.currency,
    fx_rate: e.currency !== e.base_currency ? e.fx_rate ?? '' : '', tax_amount: e.tax_amount ?? '',
    fee_amount: e.fee_amount ?? '', paid_by_user_id: e.paid_by_user_id, split_method: e.split_method,
    participants: Object.fromEntries([...ids].map((id) => {
      const s = shares.get(id);
      return [id, { selected: e.split_method === 'none' ? true : !!s, weight: s?.weight ?? '1', amount: s?.share_amount ?? '' }];
    })),
    note: e.note ?? '',
  };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function expenseFormToPayload(form: ExpenseForm, baseCurrency: string): Result<ExpenseCreateData> {
  const title = form.title.trim();
  if (!title) return { ok: false, error: '内容を入力してください' };
  if (!isValidAmount(form.amount, form.currency)) {
    return { ok: false, error: `金額は0以上で、${form.currency}は小数${minorDigits(form.currency)}桁までで入力してください` };
  }
  const data: ExpenseCreateData = {
    title, category: form.category, amount: form.amount.trim(), currency: form.currency,
    paid_by_user_id: form.paid_by_user_id, split_method: form.split_method,
  };
  if (form.local_date) data.local_date = form.local_date;
  for (const key of ['tax_amount', 'fee_amount'] as const) {
    const v = form[key].trim();
    if (v) {
      if (!isValidAmount(v, form.currency)) return { ok: false, error: '税・手数料は0以上の金額で入力してください' };
      if (Number(v) > Number(data.amount)) return { ok: false, error: '税・手数料は金額以下にしてください' };
      data[key] = v;
    }
  }
  if (form.currency !== baseCurrency && form.fx_rate.trim()) {
    if (!/^\d+(\.\d+)?$/.test(form.fx_rate.trim()) || Number(form.fx_rate) <= 0) {
      return { ok: false, error: '換算レートは0より大きい数で入力してください' };
    }
    data.fx_rate = form.fx_rate.trim();
  }
  if (form.split_method !== 'none') {
    const selected = Object.entries(form.participants).filter(([, p]) => p.selected);
    if (selected.length === 0) return { ok: false, error: '負担する人を1人以上選んでください' };
    const participants: ExpenseParticipantInput[] = [];
    for (const [userId, p] of selected) {
      if (form.split_method === 'ratio') {
        if (!/^\d+(\.\d+)?$/.test(p.weight.trim()) || Number(p.weight) <= 0) {
          return { ok: false, error: '比率は0より大きい数で入力してください' };
        }
        participants.push({ user_id: userId, weight: p.weight.trim() });
      } else if (form.split_method === 'amount') {
        if (!isValidAmount(p.amount, form.currency)) return { ok: false, error: '負担額を正しく入力してください' };
        participants.push({ user_id: userId, amount: p.amount.trim() });
      } else {
        participants.push({ user_id: userId });
      }
    }
    if (form.split_method === 'amount') {
      const scale = 10 ** minorDigits(form.currency);
      const sum = participants.reduce((acc, p) => acc + Math.round(Number(p.amount) * scale), 0);
      if (sum !== Math.round(Number(data.amount) * scale)) {
        return { ok: false, error: '負担額の合計が金額と一致しません' };
      }
    }
    data.participants = participants;
  }
  const note = form.note.trim();
  if (note) data.note = note;
  return { ok: true, data };
}

/** 支出の負担者の要約("Aさん 334円・Bさん 333円…") */
export function describeShares(e: Expense): string {
  return e.shares.map((s) => `${s.name}${s.is_member ? '' : '(メンバー外)'} ${formatMoney(s.share_amount, e.currency)}`).join('・');
}
