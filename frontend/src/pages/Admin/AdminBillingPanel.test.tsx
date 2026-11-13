/** [Gate Remaining-4] 管理者の料金・決済(仮の価格を変える・販売を止める・返金) */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  adminBillingProducts: vi.fn(), adminBillingPayments: vi.fn(), adminUpdateProduct: vi.fn(), adminRefund: vi.fn(),
}));
vi.mock('@/services/api/billing', () => m);

import AdminBillingPanel from './AdminBillingPanel';

const prod = { id: 'p1', code: 'trip_pass', kind: 'trip_pass', tier_key: 'trip_pass', name: 'Trip Pass', description: null,
  price_jpy: 500, interval: null, active: true, revision: 3, updated_at: null };
const pay = { id: 'x1', kind: 'trip_pass', status: 'paid', amount_jpy: 500, refunded_jpy: 0, product_name: 'Trip Pass',
  plan_id: 'pl', plan_title: '京都', receipt_url: null, paid_at: '2026-11-13T00:00:00Z', created_at: null, user_id: 'u',
  refund_reason: null };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.adminBillingProducts.mockResolvedValue({ configured: true, products: [prod] });
  m.adminBillingPayments.mockResolvedValue({ configured: true, payments: [pay] });
});

describe('AdminBillingPanel', () => {
  it('価格を版つきで保存し、返金する', async () => {
    m.adminUpdateProduct.mockResolvedValue({ ...prod, price_jpy: 800, revision: 4 });
    m.adminRefund.mockResolvedValue({ ...pay, status: 'refunded', refunded_jpy: 500 });
    render(<AdminBillingPanel />);
    const input = await screen.findByLabelText('Trip Passの価格');
    fireEvent.change(input, { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: '価格を保存' }));
    await waitFor(() => expect(m.adminUpdateProduct).toHaveBeenCalledWith('p1', { price_jpy: 800, revision: 3 }));
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce('二重の購入').mockReturnValueOnce('');
    fireEvent.click(screen.getByRole('button', { name: '返金' }));
    await waitFor(() => expect(m.adminRefund).toHaveBeenCalledWith('x1', '二重の購入', undefined));
    prompt.mockRestore();
  });
});
