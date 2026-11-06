/**
 * [Gate PlanSpotEdit] スポットの編集の画面に、この予定に結び付いた予約と費用を要約して出す(課題 #3-⑧)。
 * ここでは変えられない(読むだけ)。直す時は予約・費用の画面へ移る。予約番号は隠したまま(画面の伏せた値も出さない)。
 * 結び付いた物が無い時・読めない時は何も出さない(値を作らない)。
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getExpenses, getReservations } from '@/services/api';
import type { Reservation } from '@/services/api/types/reservations';
import type { Expense } from '@/services/api/types/finance';

const TYPE_LABEL: Record<string, string> = {
  accommodation: '宿泊', flight: '航空', train: '鉄道', bus: 'バス', ferry: '船', rental_car: 'レンタカー',
  restaurant: '飲食', activity: '体験', admission: '入場', other: 'その他',
};
const STATUS_LABEL: Record<string, string> = {
  confirmed: '確定', pending: '未確定', tentative: '仮', cancelled: 'キャンセル', canceled: 'キャンセル', waitlisted: '空き待ち',
};

function money(amount: number | string | null | undefined, currency: string | null | undefined): string | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `${currency === 'JPY' || !currency ? '¥' : `${currency} `}${n.toLocaleString('ja-JP')}`;
}

function md(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

interface Props { planId: string; eventId: string }

const EventRelatedSummary: React.FC<Props> = ({ planId, eventId }) => {
  const [rows, setRows] = useState<{ reservations: Reservation[]; expenses: Expense[] } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.allSettled([getReservations(planId), getExpenses(planId)]).then(([r, e]) => {
      if (!alive) return;
      const reservations = r.status === 'fulfilled' ? r.value.filter((x) => x.event_id === eventId) : [];
      const ids = new Set(reservations.map((x) => x.id));
      const expenses = e.status === 'fulfilled'
        ? e.value.filter((x) => x.kind !== 'refund' && ((x.related_type === 'event' && x.related_id === eventId)
          || (x.related_type === 'reservation' && x.related_id !== null && ids.has(x.related_id))))
        : [];
      setRows({ reservations, expenses });
    });
    return () => { alive = false; };
  }, [planId, eventId]);

  if (!rows || (rows.reservations.length === 0 && rows.expenses.length === 0)) return null;
  const total = rows.expenses.reduce((sum, x) => sum + (x.currency === 'JPY' ? Number(x.amount) || 0 : 0), 0);
  return (
    <section className="tc-related" aria-label="この予定の予約と費用(読むだけ)" data-testid="event-related">
      <p className="mb-1 text-xs font-semibold text-ink-700">この予定の予約と費用(ここでは変えられません)</p>
      {rows.reservations.length > 0 && (
        <ul className="space-y-1" aria-label="予約">
          {rows.reservations.map((r) => (
            <li key={r.id}>
              <span className="min-w-0 truncate">
                {`${TYPE_LABEL[r.type] ?? r.type}・${r.provider_name || '提供元未入力'}`}
                {md(r.start_at) ? `(${md(r.start_at)}${r.end_at && md(r.end_at) !== md(r.start_at) ? `〜${md(r.end_at)}` : ''})` : ''}
              </span>
              <span className="shrink-0 text-ink-700">
                {[STATUS_LABEL[r.status] ?? r.status, money(r.total_amount, r.currency)].filter(Boolean).join('・')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.expenses.length > 0 && (
        <ul className="mt-1 space-y-1" aria-label="費用">
          {rows.expenses.map((x) => (
            <li key={x.id}>
              <span className="min-w-0 truncate">{x.title}</span>
              <span className="shrink-0 text-ink-700">{money(x.amount, x.currency)}</span>
            </li>
          ))}
          {rows.expenses.length > 1 && total > 0 && (
            <li className="border-t border-cloud-200 pt-1 font-semibold"><span>費用の合計(円)</span><span>{money(total, 'JPY')}</span></li>
          )}
        </ul>
      )}
      <p className="mt-1 text-xs">
        <Link to={`/planner/${planId}/reservations`} className="font-semibold text-accent underline">予約</Link>
        {' ・ '}
        <Link to={`/planner/${planId}/expenses`} className="font-semibold text-accent underline">費用</Link>
        で直せます
      </p>
    </section>
  );
};

export default EventRelatedSummary;
