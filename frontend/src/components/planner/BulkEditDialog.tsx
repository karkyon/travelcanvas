/**
 * [Gate② FC-012] この日の予定をまとめて編集する(種類を変える・別の日へ移す)。選んだ予定だけを 1 回で変え、元に戻すで一度に戻る。
 * 鍵をかけた予定・エリアは選べない(サーバーも断る)。
 */
import React, { useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import type { DaySchedule } from '@/types';
import { bulkUpdateEvents } from '@/services/api/bulkEdit';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  revision: number;
  days: DaySchedule[];
  dayIndex: number;
  categories: Array<[string, string]>;
  /** 変えた後に旅程を読み直す */
  onDone: (updated: number) => void;
}

const field = 'tc-focus-ring mt-1 block w-full rounded-lg border border-cloud-200 bg-cloud-0 px-2 py-1 text-sm';

const BulkEditDialog: React.FC<Props> = ({ isOpen, onClose, planId, revision, days, dayIndex, categories, onDone }) => {
  const [picked, setPicked] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [toDay, setToDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const day = days[dayIndex];
  const events = (day?.events ?? []);
  const selectable = (e: DaySchedule['events'][number]) => !e.locked && e.category !== 'area' && !e.parent_event_id;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const apply = async () => {
    if (picked.length === 0) { setError('予定を選んでください'); return; }
    if (!type && !toDay) { setError('種類か移す日を選んでください'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await bulkUpdateEvents(planId, picked, { ...(type ? { event_type: type } : {}), ...(toDay ? { day_id: toDay } : {}) }, revision);
      setPicked([]);
      setType('');
      setToDay('');
      onDone(r.updated);
    } catch (e) {
      setError(errorDetailMessage(e, 'まとめて変えられませんでした。旅程を読み直してからもう一度試してください'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="まとめて編集" size="md">
      <div className="space-y-3 text-sm" data-testid="bulk-edit">
        <p className="text-xs text-ink-700">この日の予定から選んで、種類を変える・別の日へ移す(移した予定はその日の最後に、選んだ順で並びます)。「元に戻す」で一度に戻せます。</p>
        <ul className="space-y-1 max-h-60 overflow-y-auto">
          {events.map((e) => (
            <li key={e.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={picked.includes(e.id)} disabled={!selectable(e)} onChange={() => toggle(e.id)}
                  data-testid={`bulk-pick-${e.id}`} />
                <span>{`${e.start_time ? `${e.start_time} ` : ''}${e.title}`}</span>
                {!selectable(e) && <span className="text-xs text-ink-700">{e.locked ? '(鍵あり)' : '(エリア)'}</span>}
              </label>
            </li>
          ))}
        </ul>
        <label className="block text-xs font-medium text-ink-700">種類を変える
          <select className={field} value={type} onChange={(e) => setType(e.target.value)} data-testid="bulk-type">
            <option value="">変えない</option>
            {categories.filter(([v]) => v !== 'area').map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-ink-700">別の日へ移す
          <select className={field} value={toDay} onChange={(e) => setToDay(e.target.value)} data-testid="bulk-day">
            <option value="">移さない</option>
            {days.map((d, i) => (i === dayIndex ? null
              : <option key={d.id} value={d.id}>{`${i + 1} 日目${d.date ? `(${d.date.slice(5).replace('-', '/')})` : ''}`}</option>))}
          </select>
        </label>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" onClick={() => void apply()} loading={busy} disabled={busy} data-testid="bulk-apply">
            {`選んだ ${picked.length} 件を変える`}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>閉じる</Button>
        </div>
      </div>
    </Modal>
  );
};

export default BulkEditDialog;
