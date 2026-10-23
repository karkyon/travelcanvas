/**
 * [Gate G5] ExpensesPage の FIN-01・FIN-02: 支出の取消(理由つき)・記録した為替での換算・領収書の選択・締めの表示、
 * 記録タブ(LedgerPanel)の為替の記録・予算の版・端数の規則・締め/解除。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { Expense, FinanceSummary, PlanMember } from '@/services/api';
import type { FinanceSettingsG5, FxRate } from '@/services/api/types/g5';

const m = vi.hoisted(() => ({
  getPlanMembers: vi.fn(), getFinanceSettings: vi.fn(), getFinanceSummary: vi.fn(), getBudgets: vi.fn(),
  getExpenses: vi.fn(), getSettlements: vi.fn(), updateFinanceSettings: vi.fn(), createBudget: vi.fn(),
  updateBudget: vi.fn(), deleteBudget: vi.fn(), createExpense: vi.fn(), updateExpense: vi.fn(), deleteExpense: vi.fn(),
  deleteSettlement: vi.fn(), getDocuments: vi.fn(),
}));
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { extractApiErrorDetailMessage: actual.extractApiErrorDetailMessage, ...m };
});
const g5 = vi.hoisted(() => ({
  getExpenseFlags: vi.fn(), getFxRates: vi.fn(), recordSettlement: vi.fn(), voidExpense: vi.fn(),
  getFinanceSettingsG5: vi.fn(), getBudgetVersions: vi.fn(), createFxRate: vi.fn(), createBudgetVersion: vi.fn(),
  lockFinance: vi.fn(), unlockFinance: vi.fn(), putRoundingPolicy: vi.fn(),
}));
vi.mock('@/services/api/g5', () => ({ ...g5 }));

import ExpensesPage from './ExpensesPage';

const summary = fx.finance_summary as FinanceSummary;
const expenses = fx.expense_list as Expense[];
const dinner = expenses.find((e) => e.title === '夕食')!;
const members: PlanMember[] = summary.members.map((x) => ({
  user_id: x.user_id, name: x.name, role: x.is_me ? 'owner' : 'editor', is_me: x.is_me,
}));
const settingsG5: FinanceSettingsG5 = {
  plan_id: 'p1', base_currency: 'JPY', revision: 1, is_default: false, rounding_mode: 'half_up',
  remainder_to: 'largest', locked_at: null, locked_by_user_id: null,
};
const usdRate: FxRate = {
  id: 'r1', plan_id: 'p1', currency: 'USD', base_currency: 'JPY', rate: '150.25', rate_date: '2026-10-01',
  source: '銀行の公示', retrieved_at: '2026-10-01T00:00:00+00:00', created_at: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/expenses']}>
      <Routes><Route path="/planner/:planId/expenses" element={<ExpensesPage />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of [...Object.values(m), ...Object.values(g5)]) fn.mockReset();
  m.getPlanMembers.mockResolvedValue(members);
  m.getFinanceSettings.mockResolvedValue(fx.finance_settings_updated);
  m.getFinanceSummary.mockResolvedValue(summary);
  m.getBudgets.mockResolvedValue(fx.budget_list);
  m.getExpenses.mockResolvedValue(expenses);
  m.getSettlements.mockResolvedValue([]);
  m.getDocuments.mockResolvedValue([{ id: 'd1', original_filename: 'receipt.pdf', document_type: 'receipt' }]);
  g5.getExpenseFlags.mockResolvedValue([]);
  g5.getFxRates.mockResolvedValue([usdRate]);
  g5.getFinanceSettingsG5.mockResolvedValue(settingsG5);
  g5.getBudgetVersions.mockResolvedValue([]);
  window.confirm = vi.fn(() => true);
});

describe('ExpensesPage (Gate G5)', () => {
  it('支出の取消: 理由を入れて取り消し、取消済みは印を付けて操作を出さない', async () => {
    g5.voidExpense.mockResolvedValue({ id: dinner.id, fx_rate_id: null, is_voided: true, voided_at: 'x', void_reason: '二重' });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '支出' }));
    fireEvent.click(await screen.findByRole('button', { name: '夕食を取り消す' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: '取り消す' });
    expect(submit).toBeDisabled();
    g5.getExpenseFlags.mockResolvedValue([{ id: dinner.id, fx_rate_id: null, is_voided: true, voided_at: 'x', void_reason: '二重に登録した' }]);
    fireEvent.change(within(dialog).getByLabelText('取り消す理由'), { target: { value: '二重に登録した' } });
    fireEvent.click(submit);
    await waitFor(() => expect(g5.voidExpense).toHaveBeenCalledWith('p1', dinner.id, '二重に登録した', dinner.revision));
    expect(await screen.findByText('取消済み(集計に含まれません)')).toBeInTheDocument();
    expect(screen.getByText('取り消した理由: 二重に登録した')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '夕食を取り消す' })).not.toBeInTheDocument();
  });

  it('記録した為替と領収書を選んで支出を登録する(レートは送らない)', async () => {
    m.createExpense.mockResolvedValue(fx.expense_foreign);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '支出' }));
    fireEvent.click(await screen.findByRole('button', { name: '支出を追加' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('内容'), { target: { value: 'タクシー' } });
    fireEvent.change(within(dialog).getByLabelText('金額'), { target: { value: '30.00' } });
    fireEvent.change(within(dialog).getByLabelText('通貨'), { target: { value: 'USD' } });
    fireEvent.change(within(dialog).getByLabelText('記録した為替'), { target: { value: 'r1' } });
    expect(within(dialog).queryByLabelText(/換算レート/)).not.toBeInTheDocument();
    await within(dialog).findByRole('option', { name: 'receipt.pdf' });
    fireEvent.change(within(dialog).getByLabelText('領収書(任意)'), { target: { value: 'd1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.createExpense).toHaveBeenCalled());
    const [, payload] = m.createExpense.mock.calls[0]!;
    expect(payload).toMatchObject({ title: 'タクシー', currency: 'USD', fx_rate_id: 'r1', receipt_document_id: 'd1' });
    expect(payload).not.toHaveProperty('fx_rate');
  });

  it('締めている時は支出の追加・取消を出さず、案内を出す', async () => {
    m.getFinanceSettings.mockResolvedValue({ ...fx.finance_settings_updated, locked_at: '2026-10-22T00:00:00+00:00' });
    renderPage();
    expect(await screen.findByText(/精算を締めています。支出・精算を変えるには/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '支出' }));
    await screen.findByText('夕食');
    expect(screen.queryByRole('button', { name: '支出を追加' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '夕食を取り消す' })).not.toBeInTheDocument();
  });

  it('記録タブ: 為替の記録・予算の版・端数の規則・締めと解除', async () => {
    g5.createFxRate.mockResolvedValue(usdRate);
    g5.createBudgetVersion.mockResolvedValue({});
    g5.putRoundingPolicy.mockResolvedValue(settingsG5);
    g5.lockFinance.mockResolvedValue({ ...settingsG5, locked_at: 'x' });
    g5.getBudgetVersions.mockResolvedValue([{
      id: 'v1', plan_id: 'p1', kind: 'initial', label: '当初の予算', base_currency: 'JPY', total_amount: '50000',
      lines: [], unconverted: { EUR: '10' }, note: null, created_by_user_id: null, created_at: '2026-10-01T00:00:00+00:00',
    }]);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '記録' }));
    const rates = await screen.findByRole('list', { name: '為替の記録' });
    expect(rates).toHaveTextContent('1 USD = 150.25 JPY(基準日 2026-10-01・出典 銀行の公示)');
    const versions = screen.getByRole('list', { name: '予算の版' });
    expect(versions).toHaveTextContent('当初: 当初の予算');
    expect(versions).toHaveTextContent('換算できない分: EUR 10');
    // 当初は1つだけなので、当初のボタンは出さない
    expect(screen.queryByRole('button', { name: '「当初」の版を残す' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '「実績」の版を残す' }));
    await waitFor(() => expect(g5.createBudgetVersion).toHaveBeenCalledWith('p1', { kind: 'actual' }));

    fireEvent.change(screen.getByLabelText('通貨', { selector: '#fx-currency' }), { target: { value: 'EUR' } });
    fireEvent.change(screen.getByLabelText(/1 単位 = \? JPY/), { target: { value: '162.5' } });
    fireEvent.change(screen.getByLabelText('基準日'), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByRole('button', { name: '為替を記録' }));
    await waitFor(() => expect(g5.createFxRate).toHaveBeenCalledWith('p1', {
      currency: 'EUR', rate: '162.5', rate_date: '2026-10-20', source: '手入力',
    }));

    fireEvent.change(screen.getByLabelText('割り切れない端数'), { target: { value: 'payer' } });
    fireEvent.click(screen.getByRole('button', { name: '端数の規則を保存' }));
    await waitFor(() => expect(g5.putRoundingPolicy).toHaveBeenCalledWith('p1',
      { rounding_mode: 'half_up', remainder_to: 'payer' }, 1));

    g5.getFinanceSettingsG5.mockResolvedValue({ ...settingsG5, locked_at: '2026-10-22T00:00:00+00:00', revision: 2 });
    fireEvent.click(screen.getByRole('button', { name: '精算を締める' }));
    await waitFor(() => expect(g5.lockFinance).toHaveBeenCalledWith('p1'));
    const reason = await screen.findByLabelText('解除する理由');
    const unlock = screen.getByRole('button', { name: '締めを解除する' });
    expect(unlock).toBeDisabled();
    g5.unlockFinance.mockResolvedValue(settingsG5);
    fireEvent.change(reason, { target: { value: '金額の訂正' } });
    fireEvent.click(unlock);
    await waitFor(() => expect(g5.unlockFinance).toHaveBeenCalledWith('p1', '金額の訂正'));
  });

  it('記録タブ: 取得に失敗したら理由を出す', async () => {
    g5.getFinanceSettingsG5.mockRejectedValue({ response: { data: { detail: { code: 'x', message: '費用の機能は見せない設定です' } } } });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '記録' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('費用の機能は見せない設定です');
  });
});
