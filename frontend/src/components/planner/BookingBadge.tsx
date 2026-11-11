/**
 * [Gate BookingBadge] 予定のカードの予約の札(宿・食事・体験と、予約が結び付いた予定)。
 * - 予約済み: 予約の中身(日時・人数)と「予約を見る」(旅行箱の予約の詳細へ)
 * - 予約済み・要確認: 日付・チェックインの時刻・施設の名前・人数・取り消しの食い違いを文で
 * - 予約あり(まだつないでいない): 合いそうな予約と「この予定につなぐ」
 * - 未予約: 「予約を取り込む」(予約の取り込み)・「予約を登録」(旅行箱)。予約の手配まではしない
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BookingReservation, EventBooking } from '@/services/api/bookingStatus';

interface Props {
  planId: string;
  eventId: string;
  /** 予約を登録する時に入れておく名前と種類(予定の題名・種類) */
  title?: string;
  category?: string;
  booking: EventBooking;
  canEdit: boolean;
  onLink?: (reservationId: string) => Promise<void> | void;
}

const resText = (r: BookingReservation) => [
  r.provider_name ?? r.type_label,
  r.start ? `${r.start.slice(5, 10).replace('-', '/')} ${r.start.slice(11)}${r.end ? `〜${r.end.slice(0, 10) !== r.start.slice(0, 10) ? `${r.end.slice(5, 10).replace('-', '/')} ` : ''}${r.end.slice(11)}` : ''}` : null,
  r.guest_count ? `${r.guest_count}名` : null,
  r.status === 'candidate' ? '仮' : null,
].filter(Boolean).join(' · ');

const RES_TYPE: Record<string, string> = { accommodation: 'accommodation', dining: 'restaurant', activity: 'activity' };

const BookingBadge: React.FC<Props> = ({ planId, eventId, title, category, booking, canEdit, onLink }) => {
  const [busy, setBusy] = useState(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (booking.state === 'booked' || booking.state === 'issue') {
    const r = booking.reservations[0]!;
    return (
      <div className={`tc-booking is-${booking.state}`} data-testid={`booking-${eventId}`} onClick={stop}>
        <span className="tc-booking-tag">{booking.state === 'booked' ? '✓ 予約済み' : '⚠ 予約済み・要確認'}</span>
        <span className="tc-booking-text">{resText(r)}</span>
        <Link to={`/planner/${planId}/reservations?open=${encodeURIComponent(r.id)}`} className="tc-focus-ring tc-mini-link"
          data-testid={`booking-open-${eventId}`}>予約を見る</Link>
        {booking.issues.length > 0 && (
          <ul className="tc-booking-issues" data-testid={`booking-issues-${eventId}`}>
            {booking.issues.map((t) => <li key={t}>{t}</li>)}
          </ul>
        )}
      </div>
    );
  }
  if (booking.state === 'suggest') {
    const r = booking.suggestions[0]!;
    return (
      <div className="tc-booking is-suggest" data-testid={`booking-${eventId}`} onClick={stop}>
        <span className="tc-booking-tag">予約あり・まだつないでいません</span>
        <span className="tc-booking-text">{resText(r)}</span>
        {canEdit && onLink && (
          <button type="button" className="tc-focus-ring tc-mini-link" disabled={busy} data-testid={`booking-link-${eventId}`}
            onClick={async () => { setBusy(true); try { await onLink(r.id); } finally { setBusy(false); } }}>
            この予定につなぐ
          </button>
        )}
        <Link to={`/planner/${planId}/reservations?open=${encodeURIComponent(r.id)}`} className="tc-focus-ring tc-mini-link">予約を見る</Link>
      </div>
    );
  }
  return (
    <div className="tc-booking is-none" data-testid={`booking-${eventId}`} onClick={stop}>
      <span className="tc-booking-tag">未予約</span>
      <Link to={`/planner/${planId}/imports`} className="tc-focus-ring tc-mini-link" data-testid={`booking-import-${eventId}`}>予約を取り込む</Link>
      <Link to={`/planner/${planId}/reservations?new=1&event=${encodeURIComponent(eventId)}&type=${RES_TYPE[category ?? ''] ?? 'other'}&name=${encodeURIComponent(title ?? '')}`}
        className="tc-focus-ring tc-mini-link" data-testid={`booking-new-${eventId}`}>予約を登録</Link>
    </div>
  );
};

export default BookingBadge;
