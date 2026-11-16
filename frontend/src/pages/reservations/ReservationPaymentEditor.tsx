/**
 * [Gate TripKitFix] 予約の詳細の「料金と支払い」。支払い状況を入れられるようにする。
 *
 * 以前は詳細に支払い状況の欄が無く、準備の「出発前チェック」に出る「支払い状況が未入力」を直す場所が無かった。
 * 保存は既存の PATCH /plans/{plan_id}/reservations/{id}(If-Match に版)だけを使う。権限は backend が判定し、
 * 閲覧者などで拒否された時は理由を出す。金額・通貨・取消の期限は表示だけ(この欄では変えない)。
 */
import React, { useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import { updateReservation } from '@/services/api';
import type { Reservation } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { PAYMENT_CHOICES, PAYMENT_LABEL, attentionReasons, paymentText, paymentTone } from './reservationListModel';


interface Props {
  reservation: Reservation;
  planId: string;
  onSaved: (r: Reservation) => void;
  formatDateTime: (iso: string | null) => string;
}

const ReservationPaymentEditor: React.FC<Props> = ({ reservation: r, planId, onSaved, formatDateTime }) => {
  const [value, setValue] = useState(r.payment_status ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // 別の予約を開いた時だけ、入力と知らせを戻す(保存した後の「保存しました」は残す)
  useEffect(() => { setValue(r.payment_status ?? ''); setErr(null); setSaved(false); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const reasons = attentionReasons(r, Date.now());
  const changed = value !== (r.payment_status ?? '');

  const save = async () => {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const next = await updateReservation(planId, r.id, { payment_status: value }, r.revision);
      onSaved(next);
      setSaved(true);
    } catch (e) {
      setErr(errorDetailMessage(e, '支払い状況を保存できませんでした(ほかの人が先に変えた時は、開き直してください)'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {reasons.length > 0 && (
        <section className="tc-kit-detailgrp" data-tone="warn" aria-labelledby="res-attn-h">
          <h3 id="res-attn-h">要確認</h3>
          <p className="m-0 text-sm">{reasons.join('・')}(準備の「出発前チェック」にも出ています)</p>
        </section>
      )}
      <section className="tc-kit-detailgrp" aria-labelledby="res-pay-h" data-testid="reservation-payment">
        <h3 id="res-pay-h">料金と支払い</h3>
        <dl className="tc-kit-dl">
          <dt>合計</dt>
          <dd>{r.total_amount != null ? `${r.total_amount.toLocaleString('ja-JP')} ${r.currency ?? ''}`.trim() : '—'}</dd>
          <dt>支払い</dt>
          <dd><span className="tc-kit-pill" data-tone={paymentTone(r)}>{paymentText(r)}</span></dd>
          <dt>取消の期限</dt>
          <dd>{r.cancellation_deadline ? formatDateTime(r.cancellation_deadline) : '—'}</dd>
        </dl>
        <div className="tc-kit-payedit">
          <label htmlFor={`pay-${r.id}`} className="text-sm font-medium text-ink-900">支払い状況を入れる</label>
          <select id={`pay-${r.id}`} className="tc-kit-payedit__sel" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">未入力</option>
            {PAYMENT_CHOICES.map((p) => <option key={p} value={p}>{PAYMENT_LABEL[p] ?? p}</option>)}
          </select>
          <Button variant="primary" size="sm" onClick={() => void save()} loading={saving} disabled={!changed || !value || saving}>保存</Button>
        </div>
        {err && <p className="m-0 mt-2 text-sm text-red-800" role="alert">{err}</p>}
        {saved && !err && <p className="m-0 mt-2 text-sm text-green-900" role="status">保存しました。</p>}
      </section>
    </>
  );
};

export default ReservationPaymentEditor;
