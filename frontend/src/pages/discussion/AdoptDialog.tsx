/**
 * [Gate G4] COL-02 決定した選択肢を旅程に反映する(採用)前の確認。
 *
 * - 候補箱の候補なら、置く日・時刻を選ぶ。予定なら、ほかの選択肢の予定を外すかを選ぶ
 * - 「確かめる」で何が変わるかを表示(何も変えない)。「反映する」は確かめた内容に問題が無い時だけ押せる
 * - 反映は1つの変更として記録され、後で「反映を元に戻す」ができる(その後に別の変更が無い時)
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import type { AdoptionPreview, NormalizedDay, Poll, PollOptionG4 } from '@/services/api';

interface Props {
  poll: Poll;
  days: NormalizedDay[];
  onPreview: (input: { day_id: string | null; local_start_time: string | null; remove_others: boolean }) => Promise<AdoptionPreview | null>;
  onAdopt: (input: { day_id: string | null; local_start_time: string | null; remove_others: boolean }, revision: number) => Promise<boolean>;
  onClose: () => void;
}

const AdoptDialog: React.FC<Props> = ({ poll, days, onPreview, onAdopt, onClose }) => {
  const options = poll.options as Array<Poll['options'][number] & PollOptionG4>;
  const decided = options.find((o) => o.id === poll.decided_option_id) ?? null;
  const needsDay = !!decided?.candidate_id;
  const hasOtherEvents = options.some((o) => o.id !== decided?.id && o.event_id && !o.event_missing);
  const [dayId, setDayId] = useState(days[0]?.id ?? '');
  const [time, setTime] = useState('');
  const [removeOthers, setRemoveOthers] = useState(false);
  const [preview, setPreview] = useState<AdoptionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const input = () => ({ day_id: needsDay ? dayId || null : null, local_start_time: needsDay && time ? time : null,
    remove_others: removeOthers });

  const check = async () => {
    setBusy(true);
    try {
      setPreview(await onPreview(input()));
    } finally {
      setBusy(false);
    }
  };

  const adopt = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      if (await onAdopt(input(), preview.plan_revision)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`「${poll.title}」の決定を旅程に反映`} size="md">
      <Modal.Body>
        <div className="space-y-3 text-sm text-ink-900">
          <p>決定: <span className="font-medium">{decided?.label ?? '(決定なし)'}</span></p>
          {needsDay && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">置く日
                <select className="mt-1 w-full border rounded-sm px-2 py-1" value={dayId}
                  onChange={(e) => { setDayId(e.target.value); setPreview(null); }}>
                  {days.length === 0 && <option value="">日程がありません</option>}
                  {days.map((d) => <option key={d.id} value={d.id}>{d.local_date}{d.title ? ` ${d.title}` : ''}</option>)}
                </select>
              </label>
              <label className="block">開始の時刻(任意)
                <input type="time" className="mt-1 w-full border rounded-sm px-2 py-1" value={time}
                  onChange={(e) => { setTime(e.target.value); setPreview(null); }} />
              </label>
            </div>
          )}
          {hasOtherEvents && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={removeOthers}
                onChange={(e) => { setRemoveOthers(e.target.checked); setPreview(null); }} />
              ほかの選択肢の予定を旅程から外す
            </label>
          )}
          <Button variant="outline" size="sm" onClick={() => void check()} loading={busy && !preview}>反映の内容を確かめる</Button>
          {preview && (
            <section aria-label="反映の内容" className="border rounded-sm p-2 bg-gray-50">
              <ul className="list-disc ml-5">{preview.effects.map((e) => <li key={e}>{e}</li>)}</ul>
              {preview.problems.map((p) => <p key={p.code} role="alert" className="mt-1 text-red-800">{p.message}</p>)}
              <p className="mt-1 text-xs text-ink-700">反映した後に「反映を元に戻す」ができます(その後に別の変更が無い時)。</p>
            </section>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" type="button" onClick={onClose}>やめる</Button>
        <Button variant="primary" type="button" disabled={!preview?.can_adopt || busy} onClick={() => void adopt()}>反映する</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AdoptDialog;
