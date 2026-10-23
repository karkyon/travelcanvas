/** [Gate G5] 応答の decoder(形が違えば ApiDecodeError)と API の呼び方(URL・ヘッダー)。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('./index', () => ({ api }));

import { decodeG5 } from './decodersG5';
import {
  createFxRate, getMyUsage, recordSettlement, unlockFinance, uploadOrgLogo, voidExpense,
} from './g5';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('decodersG5', () => {
  it('為替・設定・使用量を検証する', () => {
    const rate = { id: 'r', plan_id: 'p', currency: 'USD', base_currency: 'JPY', rate: '150', rate_date: '2026-10-01',
      source: '手入力', retrieved_at: null, created_at: null };
    expect(decodeG5('fxRates', [rate])[0]!.rate).toBe('150');
    expect(() => decodeG5('fxRate', { ...rate, rate: 150 })).toThrow();
    expect(() => decodeG5('financeSettings', { plan_id: 'p', base_currency: 'JPY', revision: 1, is_default: false,
      rounding_mode: 'banker', remainder_to: 'largest', locked_at: null, locked_by_user_id: null })).toThrow();
    expect(() => decodeG5('usage', { subject_type: 'team', subject_id: 'x', period: '2026-10', metrics: [] })).toThrow();
  });
});

describe('g5 API', () => {
  it('取消・解除・為替・精算・ロゴの送り方', async () => {
    api.post.mockResolvedValue({ data: { id: 'e', fx_rate_id: null, is_voided: true, voided_at: 'x', void_reason: 'r' } });
    await voidExpense('p', 'e', '理由', 3);
    expect(api.post).toHaveBeenCalledWith('/plans/p/expenses/e/void', { reason: '理由' },
      expect.objectContaining({ headers: { 'If-Match': '3' } }));
    api.delete.mockResolvedValue({ data: { plan_id: 'p', base_currency: 'JPY', revision: 2, is_default: false,
      rounding_mode: 'half_up', remainder_to: 'largest', locked_at: null, locked_by_user_id: null } });
    await unlockFinance('p', '訂正');
    expect(api.delete).toHaveBeenCalledWith('/plans/p/finance-lock', expect.objectContaining({ data: { reason: '訂正' } }));
    api.post.mockResolvedValue({ data: {} });
    await recordSettlement('p', { from_user_id: 'a', to_user_id: 'b', amount: '1' }, 'k1');
    expect(api.post).toHaveBeenLastCalledWith('/plans/p/settlements', { from_user_id: 'a', to_user_id: 'b', amount: '1' },
      expect.objectContaining({ headers: { 'Idempotency-Key': 'k1' } }));
    api.post.mockResolvedValue({ data: { id: 'r', plan_id: 'p', currency: 'USD', base_currency: 'JPY', rate: '1',
      rate_date: '2026-10-01', source: 's', retrieved_at: null, created_at: null } });
    expect((await createFxRate('p', { currency: 'USD', rate: '1', rate_date: '2026-10-01', source: 's' })).id).toBe('r');
    api.put.mockResolvedValue({ data: { id: 'o', has_logo: true, logo_version: 'v', seat_limit: null, verified_domains: [] } });
    const file = new File(['x'], 'l.png', { type: 'image/png' });
    expect((await uploadOrgLogo('o', file)).has_logo).toBe(true);
    const [url, body, cfg] = api.put.mock.calls[0]!;
    expect(url).toBe('/organizations/o/logo');
    expect(body).toBeInstanceOf(FormData);
    expect(cfg.headers).toEqual({ 'Content-Type': undefined });
    api.get.mockResolvedValue({ data: { subject_type: 'user', subject_id: 'u', period: '2026-10', metrics: [] } });
    expect((await getMyUsage()).period).toBe('2026-10');
    expect(api.get).toHaveBeenCalledWith('/usage', expect.anything());
  });
});
