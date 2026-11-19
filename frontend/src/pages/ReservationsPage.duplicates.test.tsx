/**
 * [Gate② FC-042] 予約の一覧: 同じ予約かもしれない相手を示し、自動では消さない。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Reservation } from '@/services/api/types/reservations';

const base = {
  plan_id: 'p1', event_id: null, place_id: null, status: 'confirmed', confirmation_number_masked: null, has_pin: false,
  holder_name: null, guest_count: null, end_at: null, timezone_id: 'Asia/Tokyo', total_amount: null, currency: null,
  payment_status: null, cancellation_deadline: null, contact_phone: null, contact_url: null, notes: null, revision: 1,
  created_at: '2026-11-19T00:00:00Z', updated_at: null,
};
const rows: Reservation[] = [
  { ...base, id: 'r1', type: 'accommodation', provider_name: '伊勢の宿', start_at: '2026-11-28T06:00:00Z',
    duplicate_candidates: [{ reservation_id: 'r2', reason: 'same_confirmation_number' }] },
  { ...base, id: 'r2', type: 'accommodation', provider_name: 'Ise Inn', start_at: '2026-11-28T06:00:00Z',
    duplicate_candidates: [{ reservation_id: 'r1', reason: 'same_confirmation_number' }] },
  { ...base, id: 'r3', type: 'restaurant', provider_name: 'すし伊勢', start_at: '2026-11-28T09:00:00Z' },
];
const m = vi.hoisted(() => ({ getReservations: vi.fn(), deleteReservation: vi.fn() }));
vi.mock('@/services/api', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const empty = () => Promise.resolve([]);
  return {
    ...real,
    default: { getPlanDetail: () => Promise.resolve({ data: { days: [] } }) },
    getReservations: m.getReservations,
    deleteReservation: m.deleteReservation,
    getReservationParticipants: empty, getReservationEventLinks: empty, getTickets: empty,
  };
});

vi.mock('@/hooks/useTripContext', () => ({
  useTripContext: () => ({ title: '伊勢', destination: '伊勢', startDate: '2026-11-28', endDate: '2026-11-29' }),
}));

import ReservationsPage from './ReservationsPage';

describe('予約の一覧の重複の候補 (FC-042)', () => {
  it('同じ予約かもしれない相手と理由を出し、候補でない予約には出さない。自動では消さない', async () => {
    m.getReservations.mockResolvedValue(rows);
    render(
      <MemoryRouter initialEntries={['/planner/p1/reservations']}>
        <Routes><Route path="/planner/:planId/reservations" element={<ReservationsPage />} /></Routes>
      </MemoryRouter>,
    );
    const r1 = await screen.findByTestId('reservation-dup-r1');
    expect(r1).toHaveTextContent('同じ予約かもしれません: Ise Inn(予約番号が同じ)');
    expect(r1).toHaveTextContent('自動では消しません');
    expect(screen.getByTestId('reservation-dup-r2')).toHaveTextContent('伊勢の宿(予約番号が同じ)');
    expect(screen.queryByTestId('reservation-dup-r3')).not.toBeInTheDocument();
    expect(m.deleteReservation).not.toHaveBeenCalled();
  });
});
