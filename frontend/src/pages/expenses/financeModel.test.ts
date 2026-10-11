/**
 * [Gate P2] 予算・費用画面の表示整形・入力変換(financeModel)の単体テスト。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { Expense, FinanceSummary, PlanMember } from '@/services/api';
import {
  describeNet, emptyExpenseForm, expenseFormFromExpense, expenseFormToPayload, formatMoney, isValidAmount, summaryNotices,
} from './financeModel';

const members: PlanMember[] = [
  { user_id: 'u1', name: 'あ', role: 'owner', is_me: true },
  { user_id: 'u2', name: 'い', role: 'editor', is_me: false },
];

describe('financeModel (Gate P2)', () => {
  it('金額の表示は文字列のまま桁区切りし、通貨の小数桁に合わせる', () => {
    expect(formatMoney('1234567', 'JPY')).toBe('1,234,567円');
    expect(formatMoney('12.5', 'USD')).toBe('12.50 USD');
    expect(formatMoney('-5500', 'JPY')).toBe('-5,500円');
    expect(formatMoney(null, 'JPY')).toBe('—');
  });

  it('金額の入力検証は通貨ごとの小数桁に従う', () => {
    expect(isValidAmount('1000', 'JPY')).toBe(true);
    expect(isValidAmount('10.5', 'JPY')).toBe(false);
    expect(isValidAmount('10.55', 'USD')).toBe(true);
    expect(isValidAmount('10.555', 'USD')).toBe(false);
    expect(isValidAmount('-1', 'USD')).toBe(false);
    expect(isValidAmount('0', 'JPY', false)).toBe(false);
  });

  it('差額の説明と、集計に含まれない項目の注意', () => {
    expect(describeNet('4749', 'JPY')).toBe('4,749円 受け取る');
    expect(describeNet('-1749', 'JPY')).toBe('1,749円 支払う');
    expect(describeNet('0', 'JPY')).toBe('精算済み');
    expect(summaryNotices(fx.finance_summary as FinanceSummary)).toEqual([
      '換算レートが未入力の外貨の支出が1件あり、合計・精算に含まれていません。',
    ]);
    expect(summaryNotices(fx.finance_summary_empty as FinanceSummary)).toEqual([]);
  });

  it('支出フォーム: 既定は全員で均等、外貨のレート、比率・金額指定の検証', () => {
    const form = { ...emptyExpenseForm(members, 'JPY'), title: '夕食', amount: '1000' };
    expect(form.paid_by_user_id).toBe('u1');
    expect(expenseFormToPayload(form, 'JPY')).toEqual({ ok: true, data: {
      title: '夕食', category: 'food', amount: '1000', currency: 'JPY', paid_by_user_id: 'u1', split_method: 'equal',
      participants: [{ user_id: 'u1' }, { user_id: 'u2' }],
    } });
    const usd = expenseFormToPayload({ ...form, currency: 'USD', amount: '12.50', fx_rate: '150.25' }, 'JPY');
    expect(usd.ok && usd.data.fx_rate).toBe('150.25');
    expect(expenseFormToPayload({ ...form, currency: 'USD', amount: '12.50', fx_rate: '0' }, 'JPY').ok).toBe(false);
    expect(expenseFormToPayload({ ...form, amount: '10.5' }, 'JPY').ok).toBe(false);
    expect(expenseFormToPayload({ ...form, tax_amount: '2000' }, 'JPY')).toEqual({ ok: false, error: '税・手数料は金額以下にしてください' });
    const amountSplit = { ...form, split_method: 'amount' as const, participants: {
      u1: { selected: true, weight: '1', amount: '600' }, u2: { selected: true, weight: '1', amount: '300' } } };
    expect(expenseFormToPayload(amountSplit, 'JPY')).toEqual({ ok: false, error: '負担額の合計が金額と一致しません' });
    const none = expenseFormToPayload({ ...form, split_method: 'none' }, 'JPY');
    expect(none.ok && 'participants' in none.data).toBe(false);
    const nobody = { ...form, participants: { u1: { selected: false, weight: '1', amount: '' } } };
    expect(expenseFormToPayload(nobody, 'JPY').ok).toBe(false);
  });

  it('既存の支出からフォームを復元する(メンバー外の負担者も残す)', () => {
    const e = fx.expense_foreign as Expense;
    const f = expenseFormFromExpense(e, members);
    expect(f.amount).toBe('12.50');
    expect(f.fx_rate).toBe('150.25');
    expect(f.split_method).toBe('ratio');
    for (const s of e.shares) expect(f.participants[s.user_id]?.selected).toBe(true);
    expect(f.participants.u1?.selected).toBe(false);
  });
});
