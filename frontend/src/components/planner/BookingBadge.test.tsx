/** [Gate BookingBadge] 予定のカードの予約の札 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BookingBadge from './BookingBadge';
import type { BookingReservation } from '@/services/api/bookingStatus';

const res = (extra: Partial<BookingReservation> = {}): BookingReservation => ({
  id: 'r1', type: 'accommodation', type_label: '宿', status: 'confirmed', provider_name: '都リゾート 奥志摩', guest_count: 4,
  start: '2026-11-28 15:00', end: '2026-11-29 11:00', ...extra,
});
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('BookingBadge', () => {
  it('予約済み: 予約の中身と「予約を見る」(予約の詳細へ)', () => {
    wrap(<BookingBadge planId="p1" eventId="e1" canEdit booking={{ state: 'booked', issues: [], reservations: [res()], suggestions: [] }} />);
    expect(screen.getByTestId('booking-e1')).toHaveTextContent('✓ 予約済み都リゾート 奥志摩 · 11/28 15:00〜11/29 11:00 · 4名');
    expect(screen.getByTestId('booking-open-e1')).toHaveAttribute('href', '/planner/p1/reservations?open=r1');
  });

  it('要確認: 食い違いを文で並べる', () => {
    wrap(<BookingBadge planId="p1" eventId="e1" canEdit booking={{ state: 'issue', issues: ['チェックインは 15:00 からです(予定は 14:00)'],
      reservations: [res()], suggestions: [] }} />);
    expect(screen.getByTestId('booking-e1')).toHaveTextContent('⚠ 予約済み・要確認');
    expect(screen.getByTestId('booking-issues-e1')).toHaveTextContent('チェックインは 15:00 からです(予定は 14:00)');
  });

  it('合いそうな予約: この予定につなぐ', async () => {
    const onLink = vi.fn().mockResolvedValue(undefined);
    wrap(<BookingBadge planId="p1" eventId="e1" canEdit onLink={onLink}
      booking={{ state: 'suggest', issues: [], reservations: [], suggestions: [res({ id: 'r9', provider_name: 'まるや' })] }} />);
    expect(screen.getByTestId('booking-e1')).toHaveTextContent('予約あり・未接続まるや');
    // 普段はカレンダー＋だけ。押すと「この予定につなぐ」「予約を見る」が出る
    expect(screen.queryByTestId('booking-link-e1')).toBeNull();
    fireEvent.click(screen.getByTestId('booking-toggle-e1'));
    fireEvent.click(screen.getByTestId('booking-link-e1'));
    await waitFor(() => expect(onLink).toHaveBeenCalledWith('r9'));
  });

  it('未予約: 普段はカレンダー＋だけ。押すと「予約情報を取り込む」「予約を手動登録する」が出る', () => {
    wrap(<BookingBadge planId="p1" eventId="e1" title="赤福 本店" category="dining" canEdit
      booking={{ state: 'none', issues: [], reservations: [], suggestions: [] }} />);
    expect(screen.getByTestId('booking-e1')).toHaveTextContent('未予約');
    expect(screen.queryByTestId('booking-import-e1')).toBeNull();
    const toggle = screen.getByTestId('booking-toggle-e1');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('booking-import-e1')).toHaveTextContent('予約情報を取り込む');
    expect(screen.getByTestId('booking-new-e1')).toHaveTextContent('予約を手動登録する');
    expect(screen.getByTestId('booking-import-e1')).toHaveAttribute('href', '/planner/p1/imports');
    expect(screen.getByTestId('booking-new-e1')).toHaveAttribute('href',
      `/planner/p1/reservations?new=1&event=e1&type=restaurant&name=${encodeURIComponent('赤福 本店')}`);
    fireEvent.click(toggle);
    expect(screen.queryByTestId('booking-import-e1')).toBeNull();
  });

  it('[Gate TimelineRedesign] part で札と操作を分けて出せる', () => {
    const b = { state: 'none' as const, issues: [], reservations: [], suggestions: [] };
    const { unmount } = wrap(<BookingBadge part="status" planId="p1" eventId="e1" canEdit booking={b} />);
    expect(screen.getByTestId('booking-e1')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-toggle-e1')).toBeNull();
    unmount();
    wrap(<BookingBadge part="action" planId="p1" eventId="e1" canEdit booking={b} />);
    expect(screen.queryByTestId('booking-e1')).toBeNull();
    expect(screen.getByTestId('booking-toggle-e1')).toBeInTheDocument();
  });
});
