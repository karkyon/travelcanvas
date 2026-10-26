/**
 * [Gate G7] FR-005 予定の終了時刻(日をまたぐ予定)と、保存する前の影響の確認(backend の impact-preview)。
 *
 * 終了は「時刻」と「開始の日から何日後か(同じ日・翌日・2日後)」で入れる(夜行バス・深夜まで続く予定)。
 * 「変更の影響を確かめる」(保存する前)で、この変更で新たに出る問題・解消する問題・つながる移動と予約の数を、旅程を変えずに示す。
 */
import React, { useState } from 'react';
import { previewEventImpact } from '@/services/api/g7';
import type { ImpactPreview } from '@/services/api/types/g7';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

export interface EndValue { time: string; offset: number }

interface Props {
  planId: string;
  eventId: string;
  startTime: string;
  end: EndValue;
  onEndChange: (v: EndValue) => void;
}

const EventTimeImpact: React.FC<Props> = ({ planId, eventId, startTime, end, onEndChange }) => {
  const [impact, setImpact] = useState<ImpactPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    setImpact(null);
    try {
      setImpact(await previewEventImpact(planId, eventId, {
        local_start_time: startTime || null,
        local_end_time: end.time || null,
        ...(end.time ? { end_day_offset: end.offset } : {}),
      }));
    } catch (e) {
      setError(errorDetailMessage(e, '影響を確かめられませんでした'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-gray-800">
          終了時刻
          <input type="time" className="mt-1 block border rounded-lg px-2 py-1" value={end.time}
            onChange={(e) => { setImpact(null); onEndChange({ ...end, time: e.target.value }); }} />
        </label>
        <label className="text-sm text-gray-800">
          終わる日
          <select className="mt-1 block border rounded-lg px-2 py-1" value={end.offset}
            onChange={(e) => { setImpact(null); onEndChange({ ...end, offset: Number(e.target.value) }); }}>
            <option value={0}>同じ日</option>
            <option value={1}>翌日(日をまたぐ)</option>
            <option value={2}>2日後</option>
          </select>
        </label>
        <button type="button" onClick={check} disabled={busy}
          className="px-3 py-1.5 text-sm border border-blue-700 text-blue-800 rounded-lg hover:bg-blue-50 disabled:opacity-50">
          {busy ? '確かめています…' : '変更の影響を確かめる'}
        </button>
      </div>
      {error && <p className="text-sm text-red-800" role="alert">{error}</p>}
      {impact && (
        <div className="rounded-lg bg-slate-50 p-2 text-sm text-gray-900 space-y-1" role="status" aria-label="変更の影響">
          {impact.summary.map((s) => <p key={s}>{s}</p>)}
          {impact.new_issues.length > 0 && (
            <ul className="list-disc pl-5 text-red-800" aria-label="新たに出る問題">
              {impact.new_issues.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}</li>)}
            </ul>
          )}
          {impact.resolved_issues.length > 0 && (
            <ul className="list-disc pl-5 text-green-800" aria-label="解消する問題">
              {impact.resolved_issues.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default EventTimeImpact;
