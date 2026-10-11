/**
 * ExpensesPage - 予算・費用と立替・精算(SC-23)。
 *
 * [Gate P2] backend/app/api/v1/finance.py の画面。3つのタブで構成する:
 *   - 概要(FR-027): 旅行全体・カテゴリ別・日別・自分の予算と実績の差異、予約額(参考)
 *   - 支出(FR-027/028): 支出・返金の登録。外貨は換算レート、分担は均等・比率・金額・負担なし
 *   - 精算(FR-028): メンバーごとの差額、送金回数の少ない精算案、精算の記録・取消
 * 変更のたびに全てを読み直す(集計・差額は支出・予算・精算から算出されるため)。
 * 権限はbackendが判定し、拒否された場合は理由を表示する。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  createBudget, createExpense, createSettlement, deleteBudget, deleteExpense, deleteSettlement,
  extractApiErrorDetailMessage, getBudgets, getExpenses, getFinanceSettings, getFinanceSummary, getPlanMembers,
  getSettlements, updateBudget, updateExpense, updateFinanceSettings,
} from '@/services/api';
import type {
  Budget, BudgetKind, Expense, ExpenseCategory, FinanceSettings, FinanceSummary, FinanceTransfer, PlanMember,
  Settlement,
} from '@/services/api';
import SummaryPanel from './expenses/SummaryPanel';
import { ExpenseListPanel, SettlementPanel } from './expenses/ExpensePanels';
import {
  BUDGET_KIND_LABEL, CATEGORY_OPTIONS, CURRENCY_OPTIONS, SPLIT_OPTIONS, emptyExpenseForm, expenseFormFromExpense,
  expenseFormToPayload, isValidAmount, minorDigits, type ExpenseForm,
} from './expenses/financeModel';

type Tab = 'summary' | 'expenses' | 'settlement';
const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: '概要' },
  { id: 'expenses', label: '支出' },
  { id: 'settlement', label: '精算' },
];

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return extractApiErrorDetailMessage(detail) ?? fallback;
}

const inputClass = 'w-full border rounded-lg px-3 py-2';

interface BudgetForm {
  kind: BudgetKind;
  category: ExpenseCategory;
  local_date: string;
  amount: string;
  existing: Budget | null;
}

type ExpenseMode = { mode: 'create' } | { mode: 'edit'; expense: Expense } | { mode: 'refund'; of: Expense };

const ExpensesPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('summary');
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [budgetForm, setBudgetForm] = useState<BudgetForm | null>(null);
  const [expenseMode, setExpenseMode] = useState<ExpenseMode | null>(null);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const me = useMemo(() => members.find((m) => m.is_me) ?? null, [members]);
  const canEdit = me?.role === 'owner' || me?.role === 'editor';
  const base = settings?.base_currency ?? 'JPY';
  const currencyLocked = expenses.length > 0 || budgets.length > 0 || settlements.length > 0;

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [m, st, sm, b, e, s] = await Promise.all([
        getPlanMembers(planId), getFinanceSettings(planId), getFinanceSummary(planId), getBudgets(planId),
        getExpenses(planId), getSettlements(planId),
      ]);
      setMembers(m);
      setSettings(st);
      setSummary(sm);
      setBudgets(b);
      setExpenses(e);
      setSettlements(s);
    } catch (e) {
      setError(errorMessage(e, '費用の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e, fallback));
    }
    await load();
  };

  // ----- 基準通貨
  const changeCurrency = (next: string) => {
    if (!planId || !settings || next === settings.base_currency) return;
    void run(() => updateFinanceSettings(planId, next, settings.revision), '基準通貨の変更に失敗しました');
  };

  // ----- 予算
  const openBudget = (preset: { kind: BudgetKind; category?: string; local_date?: string }, existing?: Budget) => {
    setFormError(null);
    setBudgetForm({
      kind: preset.kind,
      category: (existing?.category ?? preset.category ?? 'food') as ExpenseCategory,
      local_date: existing?.local_date ?? preset.local_date ?? '',
      amount: existing?.amount ?? '',
      existing: existing ?? null,
    });
  };

  const submitBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !budgetForm) return;
    if (!isValidAmount(budgetForm.amount, base)) {
      setFormError(`予算は0以上で、${base}は小数${minorDigits(base)}桁までで入力してください`);
      return;
    }
    if (budgetForm.kind === 'day' && !budgetForm.local_date) {
      setFormError('日付を入力してください');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      const existing = budgetForm.existing
        ?? budgets.find((b) => b.kind === budgetForm.kind
          && (budgetForm.kind !== 'category' || b.category === budgetForm.category)
          && (budgetForm.kind !== 'day' || b.local_date === budgetForm.local_date));
      if (existing) {
        await updateBudget(planId, existing.id, { amount: budgetForm.amount.trim() }, existing.revision);
      } else {
        await createBudget(planId, {
          kind: budgetForm.kind,
          amount: budgetForm.amount.trim(),
          ...(budgetForm.kind === 'category' ? { category: budgetForm.category } : {}),
          ...(budgetForm.kind === 'day' ? { local_date: budgetForm.local_date } : {}),
        });
      }
      setBudgetForm(null);
      await load();
    } catch (err) {
      setFormError(errorMessage(err, '予算の保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  const removeBudget = async () => {
    if (!planId || !budgetForm?.existing) return;
    const target = budgetForm.existing;
    setBudgetForm(null);
    await run(() => deleteBudget(planId, target.id, target.revision), '予算の削除に失敗しました');
  };

  // ----- 支出
  const openExpense = (mode: ExpenseMode) => {
    setFormError(null);
    setExpenseMode(mode);
    if (mode.mode === 'edit') {
      setExpenseForm(expenseFormFromExpense(mode.expense, members));
    } else if (mode.mode === 'refund') {
      const f = expenseFormFromExpense(mode.of, members);
      setExpenseForm({ ...f, title: `${mode.of.title}の返金`, amount: '', tax_amount: '', fee_amount: '', note: '' });
    } else {
      setExpenseForm(emptyExpenseForm(members, base));
    }
  };

  const submitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !expenseForm || !expenseMode) return;
    const result = expenseFormToPayload(expenseForm, base);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      if (expenseMode.mode === 'edit') {
        const d = result.data;
        // 空欄にした項目はnullで送って消す(送らないと以前の値が残る)
        await updateExpense(planId, expenseMode.expense.id, {
          ...d,
          participants: d.participants ?? null,
          tax_amount: d.tax_amount ?? null,
          fee_amount: d.fee_amount ?? null,
          fx_rate: d.fx_rate ?? null,
          local_date: d.local_date ?? null,
          note: d.note ?? null,
        }, expenseMode.expense.revision);
      } else if (expenseMode.mode === 'refund') {
        await createExpense(planId, { ...result.data, kind: 'refund', refund_of_expense_id: expenseMode.of.id });
      } else {
        await createExpense(planId, result.data);
      }
      setExpenseMode(null);
      await load();
    } catch (err) {
      setFormError(errorMessage(err, '支出の保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  const removeExpense = (x: Expense) => {
    if (!planId) return;
    if (!window.confirm(`「${x.title}」を削除しますか?`)) return;
    void run(() => deleteExpense(planId, x.id, x.revision), '支出の削除に失敗しました');
  };

  // ----- 精算
  const recordTransfer = (t: FinanceTransfer) => {
    if (!planId) return;
    if (!window.confirm(`${t.from_name}さんから${t.to_name}さんへの支払いを記録しますか?`)) return;
    void run(() => createSettlement(planId, { from_user_id: t.from_user_id, to_user_id: t.to_user_id, amount: t.amount }),
      '精算の記録に失敗しました');
  };

  const undoSettlement = (s: Settlement) => {
    if (!planId) return;
    if (!window.confirm('この精算の記録を取り消しますか?')) return;
    void run(() => deleteSettlement(planId, s.id, s.revision), '精算の取消に失敗しました');
  };

  if (!planId) {
    return (
      <div className="p-8 text-center text-gray-700">
        プランが選択されていません。
        <div className="mt-4"><Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button></div>
      </div>
    );
  }

  const updateExp = <K extends keyof ExpenseForm>(key: K, value: ExpenseForm[K]) =>
    setExpenseForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  const updateParticipant = (userId: string, patch: Partial<ExpenseForm['participants'][string]>) =>
    setExpenseForm((prev) => prev ? {
      ...prev,
      participants: { ...prev.participants, [userId]: { ...prev.participants[userId]!, ...patch } },
    } : prev);
  const nameOf = (userId: string) =>
    members.find((m) => m.user_id === userId)?.name
    ?? expenses.flatMap((x) => x.shares).find((s) => s.user_id === userId)?.name ?? 'メンバー外';

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
          <h1 className="text-2xl font-bold text-gray-900">予算・費用</h1>
          <p className="text-sm text-gray-700 mt-1">予算と実績、立替の精算をまとめて管理します。</p>
        </div>
        <div>
          <label htmlFor="finance-base-currency" className="block text-sm font-medium text-gray-800 mb-1">基準通貨</label>
          <select id="finance-base-currency" className="border rounded-lg px-3 py-2" value={base}
            disabled={!canEdit || currencyLocked} onChange={(e) => changeCurrency(e.target.value)}>
            {[...new Set([base, ...CURRENCY_OPTIONS])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div role="tablist" aria-label="予算・費用の表示切替" className="flex gap-2 mb-4 border-b">
        {TABS.map((t) => (
          <button key={t.id} id={`fin-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id}
            aria-controls={`fin-panel-${t.id}`} onClick={() => setTab(t.id)}
            className={`px-4 py-2 -mb-px border-b-2 font-medium ${tab === t.id ? 'border-blue-600 text-blue-800' : 'border-transparent text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

      {isLoading || !summary ? (
        isLoading ? <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div> : null
      ) : (
        <div role="tabpanel" id={`fin-panel-${tab}`} aria-labelledby={`fin-tab-${tab}`}>
          {tab === 'summary' && <SummaryPanel summary={summary} budgets={budgets} canEdit={canEdit} onEditBudget={openBudget} />}
          {tab === 'expenses' && (
            <ExpenseListPanel expenses={expenses} canEdit={canEdit} onAdd={() => openExpense({ mode: 'create' })}
              onEdit={(x) => openExpense({ mode: 'edit', expense: x })} onDelete={removeExpense}
              onRefund={(x) => openExpense({ mode: 'refund', of: x })} />
          )}
          {tab === 'settlement' && (
            <SettlementPanel summary={summary} settlements={settlements} onRecord={recordTransfer} onUndo={undoSettlement} />
          )}
        </div>
      )}

      <Modal isOpen={budgetForm !== null} onClose={() => setBudgetForm(null)} title="予算の設定" size="md">
        {budgetForm && (
          <form onSubmit={submitBudget} noValidate>
            <Modal.Body>
              <div className="space-y-4">
                {formError && <div className="p-2 rounded bg-red-50 text-red-800 text-sm" role="alert">{formError}</div>}
                <p className="text-sm text-gray-800">{BUDGET_KIND_LABEL[budgetForm.kind]}</p>
                {budgetForm.kind === 'category' && (
                  <div>
                    <label htmlFor="budget-category" className="block text-sm font-medium text-gray-800 mb-1">カテゴリ</label>
                    <select id="budget-category" className={inputClass} value={budgetForm.category} disabled={!!budgetForm.existing}
                      onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value as ExpenseCategory })}>
                      {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}
                {budgetForm.kind === 'day' && (
                  <div>
                    <label htmlFor="budget-date" className="block text-sm font-medium text-gray-800 mb-1">日付</label>
                    <input id="budget-date" type="date" className={inputClass} value={budgetForm.local_date} disabled={!!budgetForm.existing}
                      onChange={(e) => setBudgetForm({ ...budgetForm, local_date: e.target.value })} />
                  </div>
                )}
                <div>
                  <label htmlFor="budget-amount" className="block text-sm font-medium text-gray-800 mb-1">金額({base})</label>
                  <input id="budget-amount" inputMode="decimal" className={inputClass} value={budgetForm.amount}
                    onChange={(e) => setBudgetForm({ ...budgetForm, amount: e.target.value })} />
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              {budgetForm.existing && <Button variant="ghost" type="button" onClick={removeBudget}>削除</Button>}
              <Button variant="ghost" type="button" onClick={() => setBudgetForm(null)}>キャンセル</Button>
              <Button variant="primary" type="submit" loading={isSaving}>保存</Button>
            </Modal.Footer>
          </form>
        )}
      </Modal>

      <Modal isOpen={expenseMode !== null} onClose={() => setExpenseMode(null)}
        title={expenseMode?.mode === 'edit' ? '支出の編集' : expenseMode?.mode === 'refund' ? '返金の登録' : '支出の追加'} size="lg">
        {expenseForm && expenseMode && (
          <form onSubmit={submitExpense} noValidate>
            <Modal.Body>
              <div className="space-y-4">
                {formError && <div className="p-2 rounded bg-red-50 text-red-800 text-sm" role="alert">{formError}</div>}
                <div>
                  <label htmlFor="expense-title" className="block text-sm font-medium text-gray-800 mb-1">内容</label>
                  <input id="expense-title" className={inputClass} maxLength={200} value={expenseForm.title}
                    onChange={(e) => updateExp('title', e.target.value)} placeholder="例: 夕食" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="expense-amount" className="block text-sm font-medium text-gray-800 mb-1">金額</label>
                    <input id="expense-amount" inputMode="decimal" className={inputClass} value={expenseForm.amount}
                      onChange={(e) => updateExp('amount', e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="expense-currency" className="block text-sm font-medium text-gray-800 mb-1">通貨</label>
                    <select id="expense-currency" className={inputClass} value={expenseForm.currency}
                      disabled={expenseMode.mode === 'refund'} onChange={(e) => updateExp('currency', e.target.value)}>
                      {[...new Set([base, expenseForm.currency, ...CURRENCY_OPTIONS])].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="expense-category" className="block text-sm font-medium text-gray-800 mb-1">カテゴリ</label>
                    <select id="expense-category" className={inputClass} value={expenseForm.category}
                      onChange={(e) => updateExp('category', e.target.value as ExpenseCategory)}>
                      {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
                {expenseForm.currency !== base && (
                  <div>
                    <label htmlFor="expense-rate" className="block text-sm font-medium text-gray-800 mb-1">
                      換算レート(1 {expenseForm.currency} = ? {base})
                    </label>
                    <input id="expense-rate" inputMode="decimal" className={inputClass} value={expenseForm.fx_rate}
                      onChange={(e) => updateExp('fx_rate', e.target.value)} />
                    <p className="text-xs text-gray-700 mt-1">空欄のままだと、この支出は合計・精算に含まれません(後で入力できます)。</p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="expense-date" className="block text-sm font-medium text-gray-800 mb-1">日付(任意)</label>
                    <input id="expense-date" type="date" className={inputClass} value={expenseForm.local_date}
                      onChange={(e) => updateExp('local_date', e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="expense-tax" className="block text-sm font-medium text-gray-800 mb-1">うち税(任意)</label>
                    <input id="expense-tax" inputMode="decimal" className={inputClass} value={expenseForm.tax_amount}
                      onChange={(e) => updateExp('tax_amount', e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="expense-fee" className="block text-sm font-medium text-gray-800 mb-1">うち手数料(任意)</label>
                    <input id="expense-fee" inputMode="decimal" className={inputClass} value={expenseForm.fee_amount}
                      onChange={(e) => updateExp('fee_amount', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label htmlFor="expense-payer" className="block text-sm font-medium text-gray-800 mb-1">
                    {expenseMode.mode === 'refund' ? '返金を受け取った人' : '支払った人'}
                  </label>
                  <select id="expense-payer" className={inputClass} value={expenseForm.paid_by_user_id}
                    onChange={(e) => updateExp('paid_by_user_id', e.target.value)}>
                    {Object.keys(expenseForm.participants).map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
                  </select>
                </div>
                <fieldset>
                  <legend className="block text-sm font-medium text-gray-800 mb-1">分け方</legend>
                  <div className="flex flex-wrap gap-4 text-sm">
                    {SPLIT_OPTIONS.map((o) => (
                      <label key={o.value} className="flex items-center gap-1">
                        <input type="radio" name="split-method" checked={expenseForm.split_method === o.value}
                          onChange={() => updateExp('split_method', o.value)} />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {expenseForm.split_method !== 'none' && (
                  <fieldset>
                    <legend className="block text-sm font-medium text-gray-800 mb-1">負担する人</legend>
                    <div className="space-y-2">
                      {Object.entries(expenseForm.participants).map(([id, p]) => (
                        <div key={id} className="flex flex-wrap items-center gap-2 text-sm">
                          <label className="flex items-center gap-1 min-w-[10rem]">
                            <input type="checkbox" checked={p.selected} onChange={(e) => updateParticipant(id, { selected: e.target.checked })} />
                            {nameOf(id)}
                          </label>
                          {expenseForm.split_method === 'ratio' && p.selected && (
                            <input aria-label={`${nameOf(id)}の比率`} inputMode="decimal" className="border rounded px-2 py-1 w-24"
                              value={p.weight} onChange={(e) => updateParticipant(id, { weight: e.target.value })} />
                          )}
                          {expenseForm.split_method === 'amount' && p.selected && (
                            <input aria-label={`${nameOf(id)}の負担額`} inputMode="decimal" className="border rounded px-2 py-1 w-32"
                              value={p.amount} onChange={(e) => updateParticipant(id, { amount: e.target.value })} />
                          )}
                        </div>
                      ))}
                    </div>
                  </fieldset>
                )}
                <div>
                  <label htmlFor="expense-note" className="block text-sm font-medium text-gray-800 mb-1">メモ(任意)</label>
                  <input id="expense-note" className={inputClass} maxLength={500} value={expenseForm.note}
                    onChange={(e) => updateExp('note', e.target.value)} />
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" type="button" onClick={() => setExpenseMode(null)}>キャンセル</Button>
              <Button variant="primary" type="submit" loading={isSaving}>保存</Button>
            </Modal.Footer>
          </form>
        )}
      </Modal>
    </div>
  );
};

export default ExpensesPage;
