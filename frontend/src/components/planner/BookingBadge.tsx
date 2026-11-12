/**
 * [Gate BookingBadge] 予定のカードの予約の札(宿・食事・体験と、予約が結び付いた予定)。
 * [Gate TimelineRedesign] 札(part="status")と操作(part="action")に分けて、カードの別の場所に出す。
 * - 札(カードの中の段): 予約済み(日時・人数)・予約済み・要確認(食い違いを文で)・予約あり・未接続・未予約
 * - 操作(カードの上の段の右): 普段は小さなカレンダーのアイコンだけ。
 *   - 予約済み・要確認: チェック付きのカレンダー。押すと予約の詳細へ
 *   - 未予約: カレンダー＋。押すと「予約情報を取り込む」「予約を手動登録する」が横にスライドして出る
 *   - 予約あり・未接続: 印付きのカレンダー＋。押すと「この予定につなぐ」「予約を見る」が出る
 *   予約の手配まではしない
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, Download, Link2, PenLine, X, CalendarSearch } from 'lucide-react';
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
  /** status: 札だけ / action: 操作だけ / both: 両方(既定) */
  part?: 'status' | 'action' | 'both';
}

const resText = (r: BookingReservation) => [
  r.provider_name ?? r.type_label,
  r.start ? `${r.start.slice(5, 10).replace('-', '/')} ${r.start.slice(11)}${r.end ? `〜${r.end.slice(0, 10) !== r.start.slice(0, 10) ? `${r.end.slice(5, 10).replace('-', '/')} ` : ''}${r.end.slice(11)}` : ''}` : null,
  r.guest_count ? `${r.guest_count}名` : null,
  r.status === 'candidate' ? '仮' : null,
].filter(Boolean).join(' · ');

const RES_TYPE: Record<string, string> = { accommodation: 'accommodation', dining: 'restaurant', activity: 'activity' };

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const BookingStatus: React.FC<Props> = ({ eventId, booking }) => {
  if (booking.state === 'booked' || booking.state === 'issue') {
    const r = booking.reservations[0]!;
    return (
      <div className={`tc-booking is-${booking.state}`} data-testid={`booking-${eventId}`} onClick={stop}>
        <span className="tc-booking-tag">{booking.state === 'booked' ? '✓ 予約済み' : '⚠ 予約済み・要確認'}</span>
        <span className="tc-booking-text">{resText(r)}</span>
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
        <span className="tc-booking-tag">予約あり・未接続</span>
        <span className="tc-booking-text">{resText(r)}</span>
      </div>
    );
  }
  return (
    <div className="tc-booking is-none" data-testid={`booking-${eventId}`} onClick={stop}>
      <span className="tc-booking-tag">未予約</span>
    </div>
  );
};

const BookingAction: React.FC<Props> = ({ planId, eventId, title, category, booking, canEdit, onLink }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (booking.state === 'booked' || booking.state === 'issue') {
    const r = booking.reservations[0]!;
    return (
      <span className="tc-bk" onClick={stop}>
        <Link to={`/planner/${planId}/reservations?open=${encodeURIComponent(r.id)}`}
          className={`tc-focus-ring tc-bk-btn is-${booking.state}`} data-testid={`booking-open-${eventId}`}
          title="予約を見る" aria-label={booking.state === 'booked' ? '予約を見る(予約済み)' : '予約を見る(予約済み・要確認)'}>
          <CalendarCheck size={18} aria-hidden="true" />
        </Link>
      </span>
    );
  }
  const suggest = booking.state === 'suggest' ? booking.suggestions[0]! : null;
  return (
    <span className="tc-bk" onClick={stop}>
      {open && (
        <span className="tc-bk-slide" data-testid={`booking-actions-${eventId}`}>
          {suggest ? (
            <>
              {canEdit && onLink && (
                <button type="button" className="tc-focus-ring tc-bk-act is-primary" disabled={busy} data-testid={`booking-link-${eventId}`}
                  onClick={async () => { setBusy(true); try { await onLink(suggest.id); setOpen(false); } finally { setBusy(false); } }}>
                  <Link2 size={14} aria-hidden="true" />この予定につなぐ
                </button>
              )}
              <Link to={`/planner/${planId}/reservations?open=${encodeURIComponent(suggest.id)}`} className="tc-focus-ring tc-bk-act">
                <CalendarSearch size={14} aria-hidden="true" />予約を見る
              </Link>
            </>
          ) : (
            <>
              <Link to={`/planner/${planId}/imports`} className="tc-focus-ring tc-bk-act" data-testid={`booking-import-${eventId}`}>
                <Download size={14} aria-hidden="true" />予約情報を取り込む
              </Link>
              <Link to={`/planner/${planId}/reservations?new=1&event=${encodeURIComponent(eventId)}&type=${RES_TYPE[category ?? ''] ?? 'other'}&name=${encodeURIComponent(title ?? '')}`}
                className="tc-focus-ring tc-bk-act" data-testid={`booking-new-${eventId}`}>
                <PenLine size={14} aria-hidden="true" />予約を手動登録する
              </Link>
            </>
          )}
        </span>
      )}
      <button type="button" className={`tc-focus-ring tc-bk-btn${suggest ? ' is-suggest' : ''}`} aria-expanded={open}
        data-testid={`booking-toggle-${eventId}`} title="予約"
        aria-label={open ? '予約の操作を閉じる' : `予約の操作(${suggest ? '予約あり・まだつないでいません' : '未予約'})`}
        onClick={() => setOpen((v) => !v)}>
        {open ? <X size={18} aria-hidden="true" /> : <CalendarPlus size={18} aria-hidden="true" />}
      </button>
    </span>
  );
};

const BookingBadge: React.FC<Props> = (props) => {
  const part = props.part ?? 'both';
  return (
    <>
      {part !== 'action' && <BookingStatus {...props} />}
      {part !== 'status' && <BookingAction {...props} />}
    </>
  );
};

export default BookingBadge;
