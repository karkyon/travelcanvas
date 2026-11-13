/**
 * [Gate SegmentBooking] 予定と予定の間の移動の予約(飛行機・新幹線・鉄道・バス・船・タクシー・レンタカー・ヘリ)。
 *
 * - 予約がつながっている移動: カレンダー✓。押すとその予約を開く
 * - まだの移動: 丸い「＋⌄」。押すと小さなメニュー
 *   「予約を取り込む」(メール・画像・PDF から)・「予約を登録する」(この移動につないで登録)・この旅行の移動の予約から「つなぐ」
 * 徒歩・自転車など予約の要らない移動には出さない。予約番号などの秘密の値はここでは扱わない(予約の画面で)
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarDays, ChevronDown, ChevronUp, Link2, Plus } from 'lucide-react';
import { getReservations, updateSegment } from '@/services/api';
import type { Reservation } from '@/services/api';
import type { TravelSegment } from '@/services/api/types/segments';
import { transportMode } from '@/utils/transportModes';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

/** 移動手段 → 予約の種類(予約の要らない手段は無し) */
const SEGMENT_RES_TYPE: Record<string, string> = {
  flight: 'flight', shinkansen: 'train', train: 'train', express_bus: 'bus', bus: 'bus', ferry: 'ferry',
  driving: 'rental_car', taxi: 'other', helicopter: 'other',
};
const MOVE_TYPES = new Set(['flight', 'train', 'bus', 'ferry', 'rental_car', 'other']);

interface Props {
  planId: string;
  revision: number | undefined;
  segment: TravelSegment;
  fromTitle: string;
  toTitle: string;
  canEdit: boolean;
  onSaved: (segment: TravelSegment) => void | Promise<void>;
}

const SegmentBooking: React.FC<Props> = ({ planId, revision, segment, fromTitle, toTitle, canEdit, onSaved }) => {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Reservation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement | null>(null);
  const type = SEGMENT_RES_TYPE[segment.mode];
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  // 開いた時に、この旅行の移動の予約(まだどの移動にもつないでいない候補)を読む
  useEffect(() => {
    if (!open || choices !== null || !canEdit) return;
    let alive = true;
    getReservations(planId)
      .then((rs) => { if (alive) setChoices(rs.filter((r) => MOVE_TYPES.has(r.type) && r.status !== 'cancelled' && !r.event_id)); })
      .catch(() => { if (alive) setChoices([]); });
    return () => { alive = false; };
  }, [open, choices, canEdit, planId]);

  if (!type && !segment.reservation_id) return null;
  const label = transportMode(segment.mode).label;
  if (segment.reservation_id) {
    return (
      <Link to={`/planner/${planId}/reservations?open=${encodeURIComponent(segment.reservation_id)}`}
        className="tc-focus-ring tc-seg-iconbtn tc-seg-booked" data-testid={`segment-booking-open-${segment.id}`}
        title="この移動の予約を見る" aria-label={`「${fromTitle}」→「${toTitle}」の${label}の予約を見る(予約済み)`}>
        <CalendarCheck size={14} aria-hidden="true" />
      </Link>
    );
  }
  if (!canEdit) return null;
  const name = `${label}: ${fromTitle} → ${toTitle}`.slice(0, 80);
  const link = async (r: Reservation) => {
    if (revision === undefined) { setError('旅程の版を読み込めていません。再読み込みしてください'); return; }
    setBusy(true);
    setError(null);
    try {
      const saved = await updateSegment(planId, segment.id, { reservation_id: r.id }, revision);
      await onSaved(saved);
      setOpen(false);
    } catch (e) {
      setError(errorDetailMessage(e, '予約をつなげませんでした'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="tc-bk tc-bk--menu" ref={box}>
      <button type="button" className="tc-focus-ring tc-bk-plus tc-bk-plus--sm" aria-expanded={open} aria-haspopup="true"
        data-testid={`segment-booking-toggle-${segment.id}`} title="この移動の予約"
        aria-label={open ? '移動の予約の操作を閉じる' : `「${fromTitle}」→「${toTitle}」の${label}の予約(未予約)`}
        onClick={() => setOpen((v) => !v)}>
        <Plus size={13} strokeWidth={2.6} aria-hidden="true" />
        {open ? <ChevronUp size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
      </button>
      {open && (
        <span className="tc-bk-menu tc-bk-menu--left" data-testid={`segment-booking-menu-${segment.id}`}>
          <Link to={`/planner/${planId}/imports`} className="tc-focus-ring tc-bk-act" data-testid={`segment-booking-import-${segment.id}`}>
            <CalendarDays size={16} aria-hidden="true" />予約を取り込む
          </Link>
          <Link to={`/planner/${planId}/reservations?new=1&segment=${encodeURIComponent(segment.id)}&type=${type}&name=${encodeURIComponent(name)}`}
            className="tc-focus-ring tc-bk-act" data-testid={`segment-booking-new-${segment.id}`}>
            <Plus size={16} aria-hidden="true" />予約を登録する
          </Link>
          {(choices ?? []).slice(0, 5).map((r) => (
            <button key={r.id} type="button" className="tc-focus-ring tc-bk-act" disabled={busy}
              data-testid={`segment-booking-link-${segment.id}-${r.id}`} onClick={() => void link(r)}
              title="この移動につなぐ">
              <Link2 size={16} aria-hidden="true" />
              <span className="truncate">{`つなぐ: ${r.provider_name || r.type}`}</span>
            </button>
          ))}
          {error && <span role="alert" className="px-2 py-1 text-xs text-danger">{error}</span>}
        </span>
      )}
    </span>
  );
};

export default SegmentBooking;
