import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const getReservations = vi.fn(async () => [
  { id: 'r1', type: 'other', status: 'confirmed', provider_name: 'Mai Linh タクシー', event_id: null },
  { id: 'r2', type: 'accommodation', status: 'confirmed', provider_name: '宿', event_id: null },
  { id: 'r3', type: 'flight', status: 'cancelled', provider_name: '取消', event_id: null },
]);
const updateSegment = vi.fn(async (_p: string, id: string, data: { reservation_id: string }) => ({ id, reservation_id: data.reservation_id }));
vi.mock('@/services/api', () => ({
  getReservations: () => getReservations(),
  updateSegment: (p: string, id: string, d: { reservation_id: string }) => updateSegment(p, id, d),
}));

import SegmentBooking from './SegmentBooking';

const seg = (mode: string, reservation_id: string | null = null) => ({ id: 's1', mode, reservation_id } as never);
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('[Gate SegmentBooking] 移動の予約', () => {
  it('予約の要る移動は「＋」のメニュー(取り込む・登録する・この旅行の移動の予約をつなぐ)', async () => {
    const onSaved = vi.fn();
    wrap(<SegmentBooking planId="p1" revision={7} segment={seg('taxi')} fromTitle="Azerai" toTitle="ティエンムー寺" canEdit onSaved={onSaved} />);
    fireEvent.click(screen.getByTestId('segment-booking-toggle-s1'));
    expect(screen.getByTestId('segment-booking-import-s1')).toHaveAttribute('href', '/planner/p1/imports');
    expect(screen.getByTestId('segment-booking-new-s1').getAttribute('href'))
      .toBe(`/planner/p1/reservations?new=1&segment=s1&type=other&name=${encodeURIComponent('タクシー: Azerai → ティエンムー寺')}`);
    const linkBtn = await screen.findByTestId('segment-booking-link-s1-r1');
    expect(screen.queryByTestId('segment-booking-link-s1-r2')).toBeNull();
    expect(screen.queryByTestId('segment-booking-link-s1-r3')).toBeNull();
    fireEvent.click(linkBtn);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateSegment).toHaveBeenCalledWith('p1', 's1', { reservation_id: 'r1' });
  });

  it('予約済みの移動はその予約を開く・徒歩には出さない', () => {
    const { unmount } = wrap(<SegmentBooking planId="p1" revision={1} segment={seg('flight', 'r9')} fromTitle="a" toTitle="b" canEdit={false} onSaved={() => undefined} />);
    expect(screen.getByTestId('segment-booking-open-s1')).toHaveAttribute('href', '/planner/p1/reservations?open=r9');
    unmount();
    wrap(<SegmentBooking planId="p1" revision={1} segment={seg('walking')} fromTitle="a" toTitle="b" canEdit onSaved={() => undefined} />);
    expect(screen.queryByTestId('segment-booking-toggle-s1')).toBeNull();
  });
});
