/**
 * [Gate PlanUX] 予定と予定の間の移動手段。
 *
 * - 移動手段の印(徒歩・鉄道・新幹線など)は常に上に並べず、2 つの予定の間の行で「移動手段を選ぶ」を押した時だけ出す
 * - 印を押すと、その移動手段で区間を保存する(新しく作る・変える)。前後が合わない区間は、今の前の予定から着く区間に直す
 * - 新幹線・飛行機などの詳細(出発・到着の時刻、列車名・便名、号車・座席・乗り場、所要時間、費用、メモ)は「詳細」から後で入れる
 * - 予約番号は「予約」の画面で保存する(暗号化して持つ。ここでは持たない)
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import TransportIcon from '@/components/common/TransportIcon';
import { LEGEND_MODES, transportMode } from '@/utils/transportModes';
import { createSegment, updateSegment } from '@/services/api';
import type { SegmentMode, SegmentUpdateData, TravelSegment } from '@/services/api/types/segments';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

export interface SegmentSaveContext {
  planId: string;
  /** 区間の If-Match(旅程の版) */
  revision: number | undefined;
}

interface PickerProps extends SegmentSaveContext {
  fromEventId: string;
  fromTitle: string;
  toEventId: string;
  toTitle: string;
  segment: TravelSegment | null;
  canEdit: boolean;
  /** 区間の表示(今の行の中身)。区間が無い時は null */
  children?: React.ReactNode;
  mismatch?: boolean;
  onSaved: (segment: TravelSegment) => void | Promise<void>;
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 詳細の項目の名前(移動手段ごとに分かりやすい名前にする) */
function detailLabels(mode: string | null | undefined): { number: string; platform: string } {
  switch (mode) {
    case 'shinkansen': case 'train': return { number: '列車名・号数(例: のぞみ 21号)', platform: '号車・座席・番線' };
    case 'flight': return { number: '便名(例: NH 21)', platform: '座席・搭乗口' };
    case 'express_bus': case 'bus': return { number: 'バス会社・便名', platform: '乗り場・座席' };
    case 'ferry': return { number: '船会社・便名', platform: '乗り場・座席' };
    case 'taxi': return { number: 'タクシー会社', platform: '乗り場' };
    case 'helicopter': return { number: '手配先・便名', platform: '乗り場' };
    default: return { number: '名前・便名', platform: '乗り場・メモ' };
  }
}

const SegmentPicker: React.FC<PickerProps> = ({
  planId, revision, fromEventId, fromTitle, toEventId, toTitle, segment, canEdit, children, mismatch = false, onSaved,
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const current = segment ? transportMode(segment.mode).mode : null;

  const choose = async (mode: SegmentMode) => {
    setBusy(mode);
    setError(null);
    try {
      let saved: TravelSegment;
      if (segment) {
        if (revision === undefined) throw new Error('旅程の版を読み込めていません。再読み込みしてください');
        const patch: SegmentUpdateData = { mode };
        // 並べ替えで前後が合わなくなった区間は、今の前の予定から着く区間に直す
        if (segment.from_event_id !== fromEventId) Object.assign(patch, { from_event_id: fromEventId, from_place_id: undefined });
        saved = await updateSegment(planId, segment.id, patch, revision);
      } else {
        saved = await createSegment(planId, { from_event_id: fromEventId, to_event_id: toEventId, mode }, newKey());
      }
      await onSaved(saved);
      setOpen(false);
    } catch (e) {
      setError(errorDetailMessage(e, '移動手段を保存できませんでした'));
    } finally {
      setBusy(null);
    }
  };

  return (
    // 予定の一覧(role=list)の中の 1 行として「移動」を置く(中の印・操作は、この行の中)
    <div className="tc-segment-slot" role="listitem" aria-label={`「${toTitle}」への移動`} data-testid={`segment-slot-${toEventId}`}>
      {children ?? (
        <div className="tc-segment-row tc-segment-row--empty" data-testid="segment-empty" data-to-event={toEventId}>
          <span className="sr-only">移動:</span>
          <span>{`「${fromTitle}」→「${toTitle}」 · 移動手段未設定`}</span>
        </div>
      )}
      {canEdit && (
        <div className="tc-segment-tools">
          <button type="button" className="tc-focus-ring tc-segment-btn" aria-expanded={open}
            onClick={() => setOpen((v) => !v)} data-testid={`segment-choose-${toEventId}`}
            aria-label={`「${fromTitle}」から「${toTitle}」への移動手段を${segment ? '変える' : '選ぶ'}`}>
            {segment ? (mismatch ? '移動手段を選び直す' : '変える') : '＋ 移動手段を選ぶ'}
          </button>
          {segment && !mismatch && (
            <button type="button" className="tc-focus-ring tc-segment-btn" onClick={() => setDetail(true)}
              data-testid={`segment-detail-${toEventId}`} aria-label={`「${toTitle}」へ着く移動の詳細(時刻・便名・座席など)`}>
              詳細
            </button>
          )}
        </div>
      )}
      {open && (
        <div role="radiogroup" aria-label={`「${fromTitle}」から「${toTitle}」への移動手段`} className="tc-segment-modes"
          data-testid={`segment-modes-${toEventId}`}>
          {LEGEND_MODES.map((m) => {
            const info = transportMode(m);
            return (
              <button key={m} type="button" role="radio" aria-checked={current === m} disabled={busy !== null}
                className={`tc-focus-ring tc-segment-mode ${current === m ? 'is-on' : ''}`}
                onClick={() => void choose(m as SegmentMode)} data-testid={`segment-mode-${m}`}>
                <TransportIcon mode={m} size={14} />
                {info.label}{info.note ? `(${info.note})` : ''}
                {busy === m && <span className="sr-only">保存しています</span>}
              </button>
            );
          })}
          <button type="button" className="tc-focus-ring tc-segment-btn" onClick={() => setOpen(false)}>やめる</button>
        </div>
      )}
      {error && <p role="alert" className="tc-segment-error">{error}</p>}
      {detail && segment && (
        <SegmentDetailDialog planId={planId} revision={revision} segment={segment} title={`「${fromTitle}」→「${toTitle}」`}
          onClose={() => setDetail(false)} onSaved={async (s) => { await onSaved(s); setDetail(false); }} />
      )}
    </div>
  );
};

interface DetailProps extends SegmentSaveContext {
  segment: TravelSegment;
  title: string;
  onClose: () => void;
  onSaved: (segment: TravelSegment) => void | Promise<void>;
}

const toLocal = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 区間の詳細(後から入れる・直す)。空にした項目は送らない(消す操作は区間の画面で行う) */
export const SegmentDetailDialog: React.FC<DetailProps> = ({ planId, revision, segment, title, onClose, onSaved }) => {
  const labels = detailLabels(segment.mode);
  const [form, setForm] = useState({
    departure: toLocal(segment.planned_departure_at), arrival: toLocal(segment.planned_arrival_at),
    number: segment.transport_number ?? '', platform: segment.platform ?? '',
    minutes: segment.duration_minutes !== null && segment.duration_minutes !== undefined ? String(segment.duration_minutes) : '',
    cost: segment.cost ?? '', note: segment.luggage_note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [form]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (revision === undefined) { setError('旅程の版を読み込めていません。再読み込みしてください'); return; }
    const data: SegmentUpdateData = {};
    if (form.departure) data.planned_departure_at = new Date(form.departure).toISOString();
    if (form.arrival) data.planned_arrival_at = new Date(form.arrival).toISOString();
    if (form.departure && form.arrival && new Date(form.arrival) < new Date(form.departure)) {
      setError('到着は出発より後にしてください');
      return;
    }
    if (form.number.trim()) data.transport_number = form.number.trim().slice(0, 100);
    if (form.platform.trim()) data.platform = form.platform.trim().slice(0, 100);
    if (form.minutes.trim()) {
      const m = Number(form.minutes);
      if (!Number.isFinite(m) || m < 0) { setError('所要時間は 0 以上の分で入れてください'); return; }
      data.duration_minutes = m;
    }
    if (form.cost.trim()) {
      const c = Number(form.cost);
      if (!Number.isFinite(c) || c < 0) { setError('費用は 0 以上の数で入れてください'); return; }
      data.cost = String(c);
      data.currency = segment.currency ?? 'JPY';
    }
    if (form.note.trim()) data.luggage_note = form.note.trim();
    setBusy(true);
    try {
      await onSaved(await updateSegment(planId, segment.id, data, revision));
    } catch (e) {
      setError(errorDetailMessage(e, '詳細を保存できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const field = 'mt-1 block w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900';
  const mode = transportMode(segment.mode);
  return (
    <Modal isOpen onClose={onClose} title={`移動の詳細(${mode.label})`} size="md">
      <div className="space-y-3" data-testid="segment-detail-dialog">
        <p className="text-sm text-ink-700">{title}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink-900">出発<input type="datetime-local" className={field}
            value={form.departure} onChange={set('departure')} /></label>
          <label className="text-sm font-medium text-ink-900">到着<input type="datetime-local" className={field}
            value={form.arrival} onChange={set('arrival')} /></label>
          <label className="text-sm font-medium text-ink-900 sm:col-span-2">{labels.number}<input className={field}
            value={form.number} onChange={set('number')} maxLength={100} /></label>
          <label className="text-sm font-medium text-ink-900">{labels.platform}<input className={field}
            value={form.platform} onChange={set('platform')} maxLength={100} /></label>
          <label className="text-sm font-medium text-ink-900">所要時間(分)<input type="number" min={0} inputMode="numeric"
            className={field} value={form.minutes} onChange={set('minutes')} /></label>
          <label className="text-sm font-medium text-ink-900">{`費用(${segment.currency ?? 'JPY'})`}<input type="number" min={0}
            inputMode="decimal" className={field} value={form.cost} onChange={set('cost')} /></label>
          <label className="text-sm font-medium text-ink-900 sm:col-span-2">メモ(乗り換え・荷物など)<textarea rows={2}
            className={field} value={form.note} onChange={set('note')} /></label>
        </div>
        <p className="text-xs text-ink-700">
          予約番号・チケットは
          <Link to={`/planner/${planId}/reservations`} className="mx-1 font-semibold text-accent underline">予約</Link>
          に保存します(暗号化して持ち、普段は隠します)。
        </p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-cloud-200 pt-3">
          <Button variant="outline" onClick={onClose}>やめる</Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>保存</Button>
        </div>
      </div>
    </Modal>
  );
};

export default SegmentPicker;
