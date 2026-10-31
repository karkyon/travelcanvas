/** [Gate ProviderConnect] 有料の機能の画面: 押した時だけ送る・二重に送らない・結果を保存しない・断られたら理由と手の続け方 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TravelPlan } from '@/types';

const api = vi.hoisted(() => ({
  paidAiSuggest: vi.fn(), paidPlacesSearch: vi.fn(), paidRoute: vi.fn(),
  newIdempotencyKey: vi.fn(),
}));
vi.mock('@/services/api/paidActions', () => api);

import PaidActionsPanel from './PaidActionsPanel';

const plan: TravelPlan = {
  id: 'p1', title: '家族旅行', days: [{ id: 'd1', events: [
    { id: 'e1', title: '枚方', category: 'activity', latitude: 34.8, longitude: 135.6 },
    { id: 'e2', title: '城崎', category: 'activity', latitude: 35.6, longitude: 134.8 },
    { id: 'e3', title: '場所なし', category: 'activity' },
  ] }],
} as unknown as TravelPlan;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  let n = 0;
  api.newIdempotencyKey.mockImplementation(() => `k${(n += 1)}`);
});

describe('PaidActionsPanel', () => {
  it('開いただけでは送らない', () => {
    render(<PaidActionsPanel plan={plan} dayIndex={0} />);
    expect(api.paidAiSuggest).not.toHaveBeenCalled();
    expect(api.paidPlacesSearch).not.toHaveBeenCalled();
    expect(api.paidRoute).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'AI に聞く' })).toBeDisabled();
  });

  it('AI の案は「要確認・保存していません」と出し、送っている間は押せない', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    api.paidAiSuggest.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<PaidActionsPanel plan={plan} dayIndex={0} />);
    fireEvent.change(screen.getByLabelText('AI に案を聞く(条件を書く)'), { target: { value: '大人4人で1泊2日' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI に聞く' }));
    expect(screen.getByRole('button', { name: '聞いています…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '聞いています…' }));
    expect(api.paidAiSuggest).toHaveBeenCalledTimes(1);
    expect(api.paidAiSuggest).toHaveBeenCalledWith('p1', '大人4人で1泊2日', 'k1');
    resolve({ result: { text: '1. 有馬温泉(要確認)', model: 'm' }, usage: {}, saved: false, notice: '旅行には保存していません' });
    expect(await screen.findByTestId('paid-ai-result')).toHaveTextContent('AI の案(要確認・保存していません)');
    expect(screen.getByTestId('paid-ai-result')).toHaveTextContent('有馬温泉');
  });

  it('断られたら理由と、手で続けられることを出す', async () => {
    api.paidPlacesSearch.mockRejectedValue({ response: { status: 403, data: { detail: {
      code: 'tier_operation_excluded', message: 'このクラスには含まれません' } } } });
    render(<PaidActionsPanel plan={plan} dayIndex={0} />);
    fireEvent.change(screen.getByLabelText('Google で場所を探す'), { target: { value: '温泉' } });
    fireEvent.click(screen.getByRole('button', { name: '探す' }));
    expect(await screen.findByTestId('paid-actions-error'))
      .toHaveTextContent('このクラスには含まれません。手で予定を作って続けられます');
  });

  it('経路は場所のある予定だけから選び、Google の帰属を出す', async () => {
    api.paidRoute.mockResolvedValue({ result: { duration_minutes: 90, distance_km: 152.3 }, mode: 'driving', usage: {},
      saved: false, attribution: 'Google', notice: '旅行には保存していません' });
    render(<PaidActionsPanel plan={plan} dayIndex={0} />);
    const boxes = screen.getAllByRole('combobox');
    const from = boxes[0]!;
    const to = boxes[1]!;
    expect(Array.from((from as HTMLSelectElement).options).map((o) => o.text)).toEqual(['選ぶ', '枚方', '城崎']);
    fireEvent.change(from, { target: { value: 'e1' } });
    fireEvent.change(to, { target: { value: 'e2' } });
    fireEvent.click(screen.getByRole('button', { name: '調べる' }));
    await waitFor(() => expect(api.paidRoute).toHaveBeenCalledWith('p1', 'e1', 'e2', 'driving', 'k1'));
    expect(await screen.findByTestId('paid-route-result')).toHaveTextContent('車: 約 90 分 · 152.3 km');
    expect(screen.getByTestId('paid-route-result')).toHaveTextContent('提供: Google');
  });
});
