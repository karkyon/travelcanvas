/**
 * [Gate Remaining-4] FR-058 料金・お支払い(Stripe のテストモード)の画面。
 * - 決済の設定が無い時は案内して買えない。購読中は 2 つ目を選べない
 * - 購読の購入は Stripe の画面へ移る。戻ってきた時(?session=)は結果を問い合わせる
 * - 期間の終わりで止める・続ける。支払いの記録(返金)と領収書
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const m = vi.hoisted(() => ({
  getBillingProducts: vi.fn(), getBillingMe: vi.fn(), startCheckout: vi.fn(), syncCheckout: vi.fn(),
  cancelSubscription: vi.fn(), resumeSubscription: vi.fn(), getPlans: vi.fn(),
}));
vi.mock('@/services/api/billing', () => m);
vi.mock('@/services/api', () => ({ default: { getPlans: m.getPlans } }));

import BillingPage from './BillingPage';

const journey = { id: 'pj', code: 'journey_month', kind: 'subscription', tier_key: 'journey', name: 'Journey(月額)',
  description: '仮の価格', price_jpy: 680, interval: 'month', active: true, revision: 1, updated_at: null };
const pass = { ...journey, id: 'pp', code: 'trip_pass', kind: 'trip_pass', tier_key: 'trip_pass', name: 'Trip Pass(1 旅行)',
  price_jpy: 500, interval: null };
const meFree = { class: 'free', class_label: 'Free', class_source: 'default', subscriptions: [], payments: [], trip_passes: [],
  configured: true };

function renderAt(path = '/settings/billing') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/settings/billing" element={<BillingPage />} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getPlans.mockResolvedValue({ success: true, data: [{ id: 'plan-1', title: '京都' }] });
});

describe('BillingPage', () => {
  it('設定が無い時は案内して買えない', async () => {
    m.getBillingProducts.mockResolvedValue({ configured: false, test_mode: true, products: [journey], note: '仮の価格です' });
    m.getBillingMe.mockResolvedValue({ ...meFree, configured: false });
    renderAt();
    expect(await screen.findByText(/決済を使えません/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '購読する' })).toBeDisabled();
  });

  it('Trip Pass は旅行を選んで Stripe の画面へ', async () => {
    m.getBillingProducts.mockResolvedValue({ configured: true, test_mode: true, products: [journey, pass], note: 'n' });
    m.getBillingMe.mockResolvedValue(meFree);
    m.startCheckout.mockRejectedValue({ response: { data: { detail: { message: 'この旅行には Trip Pass があります' } } } });
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'この旅行に買う' }));
    await waitFor(() => expect(m.startCheckout).toHaveBeenCalledWith('pp', 'plan-1'));
    expect(await screen.findByText('この旅行には Trip Pass があります')).toBeInTheDocument();
  });

  it('戻ってきた時は結果を問い合わせ、購読を止める・続ける・記録を出す', async () => {
    m.getBillingProducts.mockResolvedValue({ configured: true, test_mode: true, products: [journey], note: 'n' });
    const sub = { id: 's1', product: journey, status: 'active', cancel_at_period_end: false,
      current_period_end: '2026-12-13T00:00:00+00:00', price_jpy: 680, usable: true, created_at: null };
    const paid = { id: 'x1', kind: 'subscription', status: 'partially_refunded', amount_jpy: 680, refunded_jpy: 100,
      product_name: 'Journey(月額)', plan_id: null, plan_title: null, receipt_url: 'https://invoice.stripe.com/i/x',
      paid_at: '2026-11-13T00:00:00+00:00', created_at: null, user_id: 'u', refund_reason: null };
    m.getBillingMe.mockResolvedValue({ ...meFree, class: 'journey', class_label: 'Journey', class_source: 'subscription',
      subscriptions: [sub], payments: [paid] });
    m.syncCheckout.mockResolvedValue({ result: 'subscription_started', payment: { ...paid, status: 'paid' } });
    m.cancelSubscription.mockResolvedValue({ ...sub, cancel_at_period_end: true });
    renderAt('/settings/billing?session=cs_test_1');
    expect(await screen.findByText(/お支払いが済みました/)).toBeInTheDocument();
    expect(m.syncCheckout).toHaveBeenCalledWith('cs_test_1');
    expect(screen.getByTestId('billing-class')).toHaveTextContent('Journey(購読)');
    expect(screen.getByRole('button', { name: '購読する' })).toBeDisabled();
    expect(screen.getByRole('table', { name: '支払いの記録' })).toHaveTextContent('680円(返金 100円)');
    expect(screen.getByRole('link', { name: '開く' })).toHaveAttribute('href', 'https://invoice.stripe.com/i/x');
    fireEvent.click(screen.getByRole('button', { name: '期間の終わりで止める' }));
    await waitFor(() => expect(m.cancelSubscription).toHaveBeenCalledWith('s1', true));
  });
});
