/**
 * [Gate P2] ExpensesPage(FR-027 予算・費用 / FR-028 立替・精算)の画面テスト。
 *
 * - 概要: 予算と実績・超過、換算できない支出の注意、自分の予算(本人だけ)
 * - 支出: 未換算の明示、追加フォームの内容がAPIへ正しく渡る、返金はrefund_of_expense_id付き
 * - 精算: 差額の表示、精算案から記録、精算済みの表示
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { Expense, FinanceSummary, PlanMember } from '@/services/api';

const m = vi.hoisted(() => ({
  getPlanMembers: vi.fn(),
  getFinanceSettings: vi.fn(),
  getFinanceSummary: vi.fn(),
  getBudgets: vi.fn(),
  getExpenses: vi.fn(),
  getSettlements: vi.fn(),
  updateFinanceSettings: vi.fn(),
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  deleteBudget: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  createSettlement: vi.fn(),
  deleteSettlement: vi.fn(),
  getDocuments: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { extractApiErrorDetailMessage: actual.extractApiErrorDetailMessage, ...m };
});

// [Gate G5] 取消の状態・為替の記録・精算の記録(Idempotency-Key つき)
const g5 = vi.hoisted(() => ({
  getExpenseFlags: vi.fn(), getFxRates: vi.fn(), recordSettlement: vi.fn(), voidExpense: vi.fn(),
  getFinanceSettingsG5: vi.fn(), getBudgetVersions: vi.fn(), createFxRate: vi.fn(), createBudgetVersion: vi.fn(),
  lockFinance: vi.fn(), unlockFinance: vi.fn(), putRoundingPolicy: vi.fn(),
}));
vi.mock('@/services/api/g5', () => ({ ...g5 }));

import ExpensesPage from './ExpensesPage';

const summary = fx.finance_summary as FinanceSummary;
const expenses = fx.expense_list as Expense[];
const meId = summary.members.find((x) => x.is_me)!.user_id;
const members: PlanMember[] = summary.members.map((x) => ({
  user_id: x.user_id, name: x.name, role: x.is_me ? 'owner' : 'editor', is_me: x.is_me,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/expenses']}>
      <Routes>
        <Route path="/planner/:planId/expenses" element={<ExpensesPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  for (const fn of Object.values(g5)) fn.mockReset();
  g5.getExpenseFlags.mockResolvedValue([]);
  g5.getFxRates.mockResolvedValue([]);
  m.getDocuments.mockResolvedValue([]);
  m.getPlanMembers.mockResolvedValue(members);
  m.getFinanceSettings.mockResolvedValue(fx.finance_settings_updated);
  m.getFinanceSummary.mockResolvedValue(summary);
  m.getBudgets.mockResolvedValue(fx.budget_list);
  m.getExpenses.mockResolvedValue(expenses);
  m.getSettlements.mockResolvedValue([]);
  window.confirm = vi.fn(() => true);
});

describe('ExpensesPage (Gate P2)', () => {
  it('概要: 予算と実績、カテゴリの超過、換算できない支出の注意、自分の予算を表示する', async () => {
    renderPage();
    const total = await screen.findByTestId('finance-total');
    expect(total).toHaveTextContent('50,000円');
    expect(total).toHaveTextContent('14,078円');
    expect(screen.getByTestId('finance-notices')).toHaveTextContent('換算レートが未入力の外貨の支出が1件');
    const table = screen.getByRole('region', { name: 'カテゴリ別' });
    const food = within(table).getByText('食事').closest('tr')!;
    expect(food).toHaveTextContent('超過');
    expect(screen.getByTestId('finance-my-budget')).toHaveTextContent('15,000円');
    // 支出・予算があるため基準通貨は変更できない
    expect(screen.getByLabelText('基準通貨')).toBeDisabled();
  });

  it('支出: 未換算を明示し、追加フォームの内容(外貨・レート・比率)を送る', async () => {
    m.createExpense.mockResolvedValue(fx.expense_foreign);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '支出' }));
    expect(await screen.findByText('未換算(集計に含まれません)')).toBeInTheDocument();
    expect(screen.getAllByText('返金').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '支出を追加' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('内容'), { target: { value: 'タクシー' } });
    fireEvent.change(within(dialog).getByLabelText('金額'), { target: { value: '30.00' } });
    fireEvent.change(within(dialog).getByLabelText('通貨'), { target: { value: 'USD' } });
    fireEvent.change(within(dialog).getByLabelText(/換算レート/), { target: { value: '150' } });
    fireEvent.change(within(dialog).getByLabelText('カテゴリ'), { target: { value: 'transport' } });
    fireEvent.click(within(dialog).getByLabelText('比率で分ける'));
    const other = members.find((x) => !x.is_me)!;
    fireEvent.change(within(dialog).getByLabelText(`${other.name}の比率`), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.createExpense).toHaveBeenCalled());
    const [, payload] = m.createExpense.mock.calls[0]!;
    expect(payload).toMatchObject({
      title: 'タクシー', amount: '30.00', currency: 'USD', fx_rate: '150', category: 'transport',
      split_method: 'ratio', paid_by_user_id: meId,
    });
    expect(payload.participants).toContainEqual({ user_id: other.user_id, weight: '2' });
  });

  it('支出: 返金は元の支出を指定し、同じ通貨で登録する', async () => {
    m.createExpense.mockResolvedValue(fx.expense_refund);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '支出' }));
    const dinner = expenses.find((e) => e.title === '夕食')!;
    fireEvent.click(await screen.findByRole('button', { name: '夕食の返金を登録' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('通貨')).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('金額'), { target: { value: '500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.createExpense).toHaveBeenCalledWith('p1', expect.objectContaining({
      kind: 'refund', refund_of_expense_id: dinner.id, amount: '500', currency: 'JPY', title: '夕食の返金',
    })));
  });

  it('精算: 差額と精算案を示し、案から支払いを記録できる。精算済みなら完了と表示する', async () => {
    g5.recordSettlement.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '精算' }));
    const balances = await screen.findByTestId('finance-balances');
    expect(balances).toHaveTextContent('4,749円 受け取る');
    expect(balances).toHaveTextContent('1,749円 支払う');
    const first = summary.transfers[0]!;
    fireEvent.click(screen.getAllByRole('button', { name: '支払いを記録' })[0]!);
    await waitFor(() => expect(g5.recordSettlement).toHaveBeenCalledWith('p1', {
      from_user_id: first.from_user_id, to_user_id: first.to_user_id, amount: first.amount,
    }, expect.any(String)));
    expect(g5.recordSettlement.mock.calls[0]![2].length).toBeGreaterThan(8);
  });

  it('精算済み・予算の保存エラー表示', async () => {
    m.getFinanceSummary.mockResolvedValue(fx.finance_summary_empty);
    m.getExpenses.mockResolvedValue([]);
    m.getBudgets.mockResolvedValue([]);
    m.createBudget.mockRejectedValue({ response: { data: { detail: '予算を変更する権限がありません' } } });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '精算' }));
    expect(await screen.findByTestId('finance-settled')).toHaveTextContent('精算は完了しています');
    fireEvent.click(screen.getByRole('tab', { name: '概要' }));
    fireEvent.click(await screen.findByRole('button', { name: '自分の予算を設定' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/金額/), { target: { value: '10.5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('小数0桁');
    fireEvent.change(within(dialog).getByLabelText(/金額/), { target: { value: '10000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.createBudget).toHaveBeenCalledWith('p1', { kind: 'member', amount: '10000' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('予算を変更する権限がありません');
  });
});
