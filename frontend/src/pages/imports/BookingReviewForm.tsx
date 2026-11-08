/**
 * [Gate BookingFix] 読み取った予約の確認フォーム。項目ごとに直してから、1 回の操作で予約に登録する。
 * 読めなかった項目は空のまま出して、手で入れられる。読み取りの結果をそのまま信用しないよう、根拠を項目の下に出す。
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@/components/common/Button';
import { applyExtraction } from '@/services/api/photoFeatures';
import type { ApplyResult } from '@/services/api/photoFeatures';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const RESERVATION_TYPES: [string, string][] = [
  ['accommodation', '宿泊'], ['flight', '航空'], ['train', '鉄道'], ['bus', 'バス'], ['ferry', '船'], ['rental_car', 'レンタカー'],
  ['restaurant', '飲食'], ['activity', '体験'], ['admission', '入場'], ['other', 'その他'],
];

type Kind = 'text' | 'datetime' | 'number' | 'type' | 'area';
interface Field { path: string; label: string; kind?: Kind; only?: string[] }
const STAY = ['accommodation'];
const MOVE = ['flight', 'train', 'bus', 'ferry'];
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: '基本', fields: [
    { path: 'type', label: '種類', kind: 'type' },
    { path: 'provider_name', label: '施設・事業者の名前' },
    { path: 'confirmation_number', label: '予約番号' },
    { path: 'detail.booking_site', label: '予約サイト' },
    { path: 'holder_name', label: '予約者' },
    { path: 'guest_count', label: '人数', kind: 'number' },
  ] },
  { title: '日時', fields: [
    { path: 'start_at', label: '開始(チェックイン・出発)', kind: 'datetime' },
    { path: 'end_at', label: '終了(チェックアウト・到着)', kind: 'datetime' },
    { path: 'detail.checkin_window', label: 'チェックイン可能時間', only: STAY },
    { path: 'detail.arrival_time', label: '到着予定', only: STAY },
    { path: 'detail.checkout_limit', label: 'チェックアウト時間', only: STAY },
    { path: 'detail.nights', label: '泊数', only: STAY },
    { path: 'cancellation_deadline', label: 'キャンセル期限(無料で取り消せる最後の日時)', kind: 'datetime' },
    { path: 'detail.cancel_policy', label: 'キャンセル規定', kind: 'area' },
  ] },
  { title: '内容', fields: [
    { path: 'detail.plan_name', label: 'プラン', kind: 'area' },
    { path: 'detail.room', label: '部屋', kind: 'area', only: STAY },
    { path: 'detail.meal', label: '食事', only: STAY },
    { path: 'detail.flight_number', label: '便名', only: ['flight'] },
    { path: 'detail.train_name', label: '列車', only: ['train'] },
    { path: 'detail.from_place', label: '出発地', only: MOVE },
    { path: 'detail.to_place', label: '到着地', only: MOVE },
    { path: 'detail.seat', label: '座席', only: MOVE },
    { path: 'detail.address', label: '住所' },
    { path: 'contact_phone', label: '電話' },
  ] },
  { title: '料金', fields: [
    { path: 'total_amount', label: '金額', kind: 'number' },
    { path: 'currency', label: '通貨' },
    { path: 'detail.payment', label: '支払い方法' },
  ] },
];

interface Candidate { field_path: string; value?: string | null; evidence_locator?: string | null; review_status?: string }
interface Props {
  planId: string;
  jobId: string;
  candidates: Candidate[];
  notes?: string[];
  onDone: (result: ApplyResult) => void;
  onDiscard: () => void;
}

const offsetOf = (iso: string): string => iso.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? '+09:00';

const BookingReviewForm: React.FC<Props> = ({ planId, jobId, candidates, notes, onDone, onDiscard }) => {
  const initial = useMemo(() => {
    const values: Record<string, string> = {};
    for (const c of candidates) if (c.value && c.review_status !== 'rejected') values[c.field_path] = c.value;
    return values;
  }, [candidates]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const shown: Record<string, string> = {};
    for (const [k, v] of Object.entries(initial)) shown[k] = /_at$|deadline$/.test(k) ? v.slice(0, 16) : v;
    return shown;
  });
  const [addToItinerary, setAddToItinerary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evidence = Object.fromEntries(candidates.map((c) => [c.field_path, c.evidence_locator]));
  const type = values.type ?? '';
  const set = (path: string, value: string) => setValues((prev) => ({ ...prev, [path]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) {
      setError('種類を選んでください');
      return;
    }
    setBusy(true);
    setError(null);
    const fields: Record<string, string | null> = {};
    for (const group of GROUPS) {
      for (const f of group.fields) {
        const v = (values[f.path] ?? '').trim();
        if (f.kind === 'datetime' && v) fields[f.path] = `${v.slice(0, 16)}:00${offsetOf(initial[f.path] ?? '')}`;
        else fields[f.path] = v || null;
      }
    }
    try {
      onDone(await applyExtraction(planId, jobId, fields, addToItinerary));
    } catch (err) {
      setError(errorDetailMessage(err, '予約を登録できませんでした'));
      setBusy(false);
    }
  };

  const inputClass = 'block w-full mt-1 border border-cloud-200 rounded-md bg-surface px-2 py-1.5 text-sm text-ink-900';
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="booking-review">
      <p className="text-sm text-ink-700">読み取った内容です。違う所は直してから登録してください。空の項目は使いません。</p>
      {notes && notes.length > 0 && <ul className="rounded-md bg-warning-soft p-3 text-sm text-ink-900 space-y-1" data-testid="booking-review-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-2">
          <legend className="text-sm font-semibold text-ink-900">{group.title}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.fields.filter((f) => !f.only || f.only.includes(type) || values[f.path]).map((f) => {
              const id = `review-${f.path.replace('.', '-')}`;
              return (
                <div key={f.path} className={`min-w-0 ${f.kind === 'area' ? 'sm:col-span-2' : ''}`}>
                  <label htmlFor={id} className="block text-sm text-ink-800">{f.label}</label>
                  {f.kind === 'type' ? (
                    <select id={id} className={inputClass} value={type} onChange={(e) => set(f.path, e.target.value)}>
                      <option value="">選んでください</option>
                      {RESERVATION_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                  ) : f.kind === 'area' ? (
                    <textarea id={id} rows={2} className={inputClass} value={values[f.path] ?? ''} onChange={(e) => set(f.path, e.target.value)} />
                  ) : (
                    <input id={id} className={inputClass} type={f.kind === 'datetime' ? 'datetime-local' : f.kind === 'number' ? 'number' : 'text'} min={f.kind === 'number' ? 0 : undefined}
                      value={values[f.path] ?? ''} onChange={(e) => set(f.path, e.target.value)} />
                  )}
                  {evidence[f.path] && <p className="mt-0.5 text-xs text-ink-700">{`根拠: ${evidence[f.path]}`}</p>}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={addToItinerary} onChange={(e) => setAddToItinerary(e.target.checked)} />
        <span>開始日の旅程にも予定を追加して、この予約と紐付ける</span>
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onDiscard}>登録しない</Button>
        <Button type="submit" variant="primary" loading={busy} data-testid="booking-review-submit">この内容で予約を登録</Button>
      </div>
      <p className="text-xs text-ink-700">予約番号は暗号化して保存します。<Link className="underline" to={`/planner/${planId}/reservations`}>予約の一覧</Link></p>
    </form>
  );
};

export default BookingReviewForm;
