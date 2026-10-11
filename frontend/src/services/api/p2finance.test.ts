/**
 * [Gate P2] 予算・費用(FR-027)・立替・精算(FR-028)APIのクライアント。送信内容(URL・メソッド・If-Match)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証(金額は文字列)を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  api, createBudget, createExpense, createSettlement, deleteBudget, deleteExpense, deleteSettlement, getBudgets,
  getExpenses, getFinanceSettings, getFinanceSummary, getSettlements, updateBudget, updateExpense, updateFinanceSettings,
} from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET' || method === 'DELETE') calls.push({ url, method, config: a as AxiosRequestConfig | undefined });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  const client: Partial<MinimalHttpClient> = {
    get: push('GET'), post: push('POST'), put: push('PUT'), patch: push('PATCH'), delete: push('DELETE'),
  };
  api.setHttpClientForTesting(client);
  return calls;
}

describe('予算・費用・精算APIクライアント (Gate P2)', () => {
  it('基準通貨: 取得と、revision(未設定は0)をIf-MatchにしたPUT', async () => {
    let calls = respondWith(fx.finance_settings_default);
    await expect(getFinanceSettings('p1')).resolves.toMatchObject({ base_currency: 'JPY', revision: 0, is_default: true });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/finance-settings', method: 'GET' });
    calls = respondWith(fx.finance_settings_updated);
    await updateFinanceSettings('p1', 'USD', 0);
    expect(calls[0]).toEqual({ url: '/plans/p1/finance-settings', method: 'PUT', data: { base_currency: 'USD' }, config: { headers: { 'If-Match': '0' } } });
  });

  it('予算の一覧・作成・変更・削除', async () => {
    let calls = respondWith(fx.budget_list);
    await expect(getBudgets('p1')).resolves.toEqual(fx.budget_list);
    calls = respondWith(fx.budget_member);
    await createBudget('p1', { kind: 'member', amount: '15000' });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/budgets', method: 'POST', data: { kind: 'member', amount: '15000' } });
    calls = respondWith(fx.budget_updated);
    await updateBudget('p1', 'b1', { amount: '3500' }, 1);
    expect(calls[0]).toEqual({ url: '/plans/p1/budgets/b1', method: 'PATCH', data: { amount: '3500' }, config: { headers: { 'If-Match': '1' } } });
    calls = respondWith(fx.expense_deleted);
    await deleteBudget('p1', 'b1', 2);
    expect(calls[0]).toEqual({ url: '/plans/p1/budgets/b1', method: 'DELETE', config: { headers: { 'If-Match': '2' } } });
  });

  it('支出: 金額・分担は文字列のまま受け取り、合計は支出額と一致する', async () => {
    respondWith(fx.expense_list);
    const list = await getExpenses('p1');
    for (const e of list) {
      const scale = e.currency === 'JPY' ? 1 : 100;
      const sum = e.shares.reduce((acc, s) => acc + Math.round(Number(s.share_amount) * scale), 0);
      expect(sum).toBe(Math.round(Number(e.amount) * scale));
    }
    expect(list.some((e) => !e.is_converted && e.base_amount === null)).toBe(true);
    let calls = respondWith(fx.expense_equal);
    await createExpense('p1', { title: 't', amount: '100' });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/expenses', method: 'POST', data: { title: 't', amount: '100' } });
    calls = respondWith(fx.expense_updated);
    await updateExpense('p1', 'e1', { fx_rate: '160', tax_amount: null }, 1);
    expect(calls[0]).toEqual({ url: '/plans/p1/expenses/e1', method: 'PATCH', data: { fx_rate: '160', tax_amount: null }, config: { headers: { 'If-Match': '1' } } });
    calls = respondWith(fx.expense_deleted);
    await deleteExpense('p1', 'e1', 3);
    expect(calls[0]).toEqual({ url: '/plans/p1/expenses/e1', method: 'DELETE', config: { headers: { 'If-Match': '3' } } });
  });

  it('金額が数値で返る(桁落ちの恐れ)など形式が崩れた応答は拒否する', async () => {
    respondWith([{ ...fx.expense_equal, amount: 10000 }]);
    await expect(getExpenses('p1')).rejects.toThrow(/\$\[0\]\.amount/);
    respondWith({ ...fx.finance_summary, total: { ...fx.finance_summary.total, actual: '1,000' } });
    await expect(getFinanceSummary('p1')).rejects.toThrow(/\$\.total\.actual/);
    respondWith({ ...fx.finance_summary, unconverted_expenses: -1 });
    await expect(getFinanceSummary('p1')).rejects.toThrow(/\$\.unconverted_expenses/);
  });

  it('精算の一覧・記録・取消、閲覧者には他人の個人予算が返らない', async () => {
    let calls = respondWith(fx.settlement_list);
    await expect(getSettlements('p1')).resolves.toEqual(fx.settlement_list);
    calls = respondWith(fx.settlement_created);
    await createSettlement('p1', { from_user_id: 'a', to_user_id: 'b', amount: '100' });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/settlements', method: 'POST' });
    calls = respondWith(fx.settlement_deleted);
    await deleteSettlement('p1', 's1', 1);
    expect(calls[0]).toEqual({ url: '/plans/p1/settlements/s1', method: 'DELETE', config: { headers: { 'If-Match': '1' } } });
    expect(fx.finance_summary_other.my_budget).toBeNull();
    expect(fx.budget_list_other.some((b) => b.kind === 'member')).toBe(false);
    expect(fx.finance_summary_empty.is_settled).toBe(true);
  });
});
