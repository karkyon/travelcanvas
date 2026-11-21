/**
 * [Gate② FC-041] 予約番号が同じ 2 件のうち、後から入った方を元の予約の履歴へまとめる(利用者が選んだ時だけ)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Reservation } from '@/services/api/types/reservations';

const base = {
  plan_id: 'p1', event_id: null, place_id: null, status: 'confirmed', confirmation_number_masked: null, has_pin: false,
  holder_name: null, guest_count: null, end_at: null, timezone_id: 'Asia/Tokyo', total_amount: null, currency: null,
  payment_status: null, cancellation_deadline: null, contact_phone: null, contact_url: null, notes: null, revision: 3,
  updated_at: null,
};
const rows: Reservation[] = [
  { ...base, id: 'orig', type: 'accommodation', provider_name: '伊勢の宿', start_at: '2026-11-28T06:00:00Z',
    created_at: '2026-11-01T00:00:00Z', duplicate_candidates: [{ reservation_id: 'mail', reason: 'same_confirmation_number' }] },
  { ...base, id: 'mail', type: 'accommodation', provider_name: '伊勢の宿', start_at: '2026-11-29T06:00:00Z', revision: 1,
    created_at: '2026-11-20T00:00:00Z', duplicate_candidates: [{ reservation_id: 'orig', reason: 'same_confirmation_number' }] },
  { ...base, id: 'near', type: 'restaurant', provider_name: '伊勢の食堂', start_at: '2026-11-28T09:00:00Z',
    created_at: '2026-11-21T00:00:00Z', duplicate_candidates: [{ reservation_id: 'other', reason: 'same_provider_and_date' }] },
];
const m = vi.hoisted(() => ({ getReservations: vi.fn(), absorb: vi.fn(), history: vi.fn() }));
vi.mock('@/services/api', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const empty = () => Promise.resolve([]);
  return {
    ...real,
    default: { getPlanDetail: () => Promise.resolve({ data: { days: [] } }) },
    getReservations: m.getReservations,
    getReservationParticipants: empty, getReservationEventLinks: empty, getTickets: empty,
  };
});
vi.mock('@/services/api/reservationHistory', () => ({ absorbReservation: m.absorb, getReservationHistory: m.history }));
vi.mock('@/hooks/useTripContext', () => ({
  useTripContext: () => ({ title: '伊勢', destination: '伊勢', startDate: '2026-11-28', endDate: '2026-11-29' }),
}));

import ReservationsPage from './ReservationsPage';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/planner/p1/reservations']}>
    <Routes><Route path="/planner/:planId/reservations" element={<ReservationsPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  m.getReservations.mockReset().mockResolvedValue(rows);
  m.absorb.mockReset().mockResolvedValue(undefined);
  m.history.mockReset().mockResolvedValue([]);
});

describe('変更・取消のメールを元の予約へまとめる (FC-041)', () => {
  it('後から入った方にだけ「まとめる」を出す(予約番号が同じ組だけ)。押して確かめた時だけ、元の予約の版で呼ぶ', async () => {
    renderPage();
    await screen.findByTestId('reservation-absorb-mail');
    expect(screen.queryByTestId('reservation-absorb-orig')).toBeNull();  // 元の予約の側には出さない
    expect(screen.queryByTestId('reservation-absorb-near')).toBeNull();  // 予約先と日が同じだけの組には出さない
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId('reservation-absorb-change-mail'));
    expect(m.absorb).not.toHaveBeenCalled();  // 取りやめた時は何もしない
    fireEvent.click(screen.getByTestId('reservation-absorb-cancel-mail'));
    await waitFor(() => expect(m.absorb).toHaveBeenCalledWith('p1', 'orig', 'mail', 'cancel', 3));
    expect(m.getReservations).toHaveBeenCalledTimes(2);  // まとめた後に読み直す
    confirm.mockRestore();
  });

  it('詳細に、まとめた変更・取消の記録を項目の名前だけで出す', async () => {
    m.history.mockResolvedValue([{ id: 'h1', kind: 'change', source_reservation_id: 'mail', fields: ['start_at', 'total_amount', 'status'],
      created_at: '2026-11-20T01:00:00Z' }]);
    renderPage();
    const rowsEls = await screen.findAllByRole('button', { name: /伊勢の宿/ });
    fireEvent.click(rowsEls[0]!);
    const hist = await screen.findByTestId('reservation-history');
    expect(hist).toHaveTextContent('変更のお知らせをまとめた(開始・金額)');
    expect(m.history).toHaveBeenCalledWith('p1', 'orig');
  });
});
