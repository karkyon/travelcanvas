/**
 * [Gate TripKit] SC-12 チケット・QR を全画面で見せる(改札・受付で係の人に見せる)。
 *
 * - コードは「表示」を押して権限の確認(reveal API)を通った後の値だけを受け取る。この部品は API を呼ばない
 * - 使用済み・期限切れ・取消(revoked)・有効期間の前は、コードの上に大きく文字で出す(色だけで伝えない)
 * - 端末に保存して通信なしで出せるか(offline_allowed)と、有効期間・名義の区分を出す
 * - Escape・閉じるで閉じ、開く前のボタンへフォーカスを戻す。画面を最大の明るさにできないため、案内だけ出す
 */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import TicketCode from './TicketCode';
import type { Ticket } from '@/services/api';
import { ticketWarning } from './ticketState';

function fmt(iso: string | null, tz: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString('ja-JP', { timeZone: tz ?? undefined, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return d.toLocaleString('ja-JP');
  }
}

const TicketFullscreen: React.FC<{
  ticket: Ticket; code: string; reservationTitle: string; timezone: string | null; onClose: () => void;
}> = ({ ticket, code, reservationTitle, timezone, onClose }) => {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const back = useRef<Element | null>(null);
  useEffect(() => {
    back.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (back.current instanceof HTMLElement) back.current.focus();
    };
  }, [onClose]);
  const warn = ticketWarning(ticket, Date.now());
  const from = fmt(ticket.valid_from, timezone);
  const to = fmt(ticket.valid_to, timezone);
  return createPortal(
    <div className="tc-ticket-full" role="dialog" aria-modal="true" aria-labelledby="tc-ticket-full-title" data-testid="ticket-fullscreen">
      <div className="tc-ticket-full__bar">
        <h2 id="tc-ticket-full-title" className="tc-ticket-full__title">{`${reservationTitle} ・ ${ticket.ticket_type}`}</h2>
        <button ref={closeRef} type="button" className="tc-focus-ring tc-ticket-full__close" onClick={onClose} aria-label="全画面のチケットを閉じる">
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      {warn && <p className="tc-ticket-full__warn" role="alert">{warn}</p>}
      <div className="tc-ticket-full__code">
        <TicketCode value={code} format={ticket.barcode_format} size={320} label={`チケット「${ticket.ticket_type}」のコード`} />
      </div>
      <dl className="tc-ticket-full__meta">
        <div><dt>コードの種類</dt><dd>{ticket.barcode_format ?? 'QR'}</dd></div>
        <div><dt>有効期間</dt><dd>{from || to ? `${from ?? '—'} 〜 ${to ?? '—'}${timezone ? `(現地 ${timezone})` : ''}` : '登録されていません'}</dd></div>
        <div><dt>通信が無い時</dt><dd>{ticket.offline_allowed ? '旅行パックに保存すれば通信なしでも表示できます' : 'この券は通信がある時だけ表示します'}</dd></div>
        <div><dt>見せられる人</dt><dd>{ticket.share_policy === 'all_collaborators' ? '旅行のメンバー全員' : '所有者と編集者だけ'}</dd></div>
      </dl>
      <p className="tc-ticket-full__hint">画面を明るくして、係の人に見せてください。画面の写しを他の人へ送らないでください。</p>
    </div>,
    document.body,
  );
};

export default TicketFullscreen;
