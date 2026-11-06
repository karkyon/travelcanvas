/**
 * [Gate G7] FR-005 予定の時間(開始 〜 終了)と、保存する前の影響の確認(backend の impact-preview)。
 *
 * [Gate PlanSpotEdit] 課題 #3-④ の作り直し:
 * - 「開始時刻 〜 終了」を 1 行に並べる(間に 〜)
 * - 終了は既定で「この場所で何時間何分」(滞在時間)で入れる。印のボタンで「何時まで」(終了時刻)に切り替えられる
 * - 「終わる日」の選択は外した。終了時刻の時は、カレンダーの印で終わる日付も入れられる(既定は日付なし)
 *   日付なしで開始より前の時刻なら翌日として扱う。終わる日は開始の日から 2 日後まで(backend の end_day_offset 0〜2)
 * 親へ渡す値は今までどおり { time: 終了の時刻, offset: 開始の日から何日後か }。
 */
import React, { useState } from 'react';
import { ArrowLeftRight, CalendarDays } from 'lucide-react';
import { previewEventImpact } from '@/services/api/g7';
import type { ImpactPreview } from '@/services/api/types/g7';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { MAX_OFFSET, addDays, dayDiff, endFromStay, stayMinutes, toMinutes, type EndValue } from './eventTimeModel';

export type { EndValue } from './eventTimeModel';


interface Props {
  planId: string;
  eventId: string;
  startTime: string;
  end: EndValue;
  onEndChange: (v: EndValue) => void;
  /** 開始時刻を変える(渡すと開始の入力もこの部品の中に並べる) */
  onStartChange?: (v: string) => void;
  /** 予定の日(YYYY-MM-DD)。終わる日付の入力に使う */
  dayDate?: string | null;
}

const field = 'mt-1 block w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900 disabled:opacity-50';

const EventTimeImpact: React.FC<Props> = ({ planId, eventId, startTime, end, onEndChange, onStartChange, dayDate }) => {
  const [impact, setImpact] = useState<ImpactPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 既定は滞在時間。日をまたいで終わる予定は終了時刻(日付つき)で見せる
  const [mode, setMode] = useState<'stay' | 'end'>(end.offset > 0 ? 'end' : 'stay');
  const [withDate, setWithDate] = useState(end.offset > 0);
  const initialStay = stayMinutes(startTime, end);
  const [stay, setStay] = useState<{ h: string; m: string }>(initialStay === null
    ? { h: '', m: '' } : { h: String(Math.floor(initialStay / 60)), m: String(initialStay % 60) });
  const [note, setNote] = useState<string | null>(null);
  const hasStart = toMinutes(startTime) !== null;

  const change = (v: EndValue) => { setImpact(null); onEndChange(v); };

  const applyStay = (h: string, m: string, start = startTime) => {
    setStay({ h, m });
    const minutes = (Number(h) || 0) * 60 + (Number(m) || 0);
    if (!h && !m) { setNote(null); change({ time: '', offset: 0 }); return; }
    const next = endFromStay(start, minutes);
    if (!next) {
      setNote(minutes > 0 ? '開始の日から 2 日後までに終わる長さにしてください' : null);
      return;
    }
    setNote(next.offset > 0 ? `終了は ${next.offset === 1 ? '翌日' : '2 日後'} の ${next.time} です` : `終了は ${next.time} です`);
    change(next);
  };

  const setStart = (v: string) => {
    onStartChange?.(v);
    // 滞在時間で入れている時は、開始を変えても長さを保つ
    if (mode === 'stay' && (stay.h || stay.m)) applyStay(stay.h, stay.m, v);
  };

  const setEndTime = (time: string) => {
    if (!time) { change({ time: '', offset: 0 }); setNote(null); return; }
    if (withDate) { change({ time, offset: end.offset }); return; }
    const s = toMinutes(startTime);
    const e = toMinutes(time);
    const offset = s !== null && e !== null && e <= s ? 1 : 0;
    setNote(offset ? '開始より前の時刻なので、翌日として扱います' : null);
    change({ time, offset });
  };

  const setEndDate = (date: string) => {
    if (!dayDate || !date) return;
    const offset = dayDiff(dayDate, date);
    if (offset < 0 || offset > MAX_OFFSET) { setNote('終わる日は開始の日から 2 日後までにしてください'); return; }
    setNote(null);
    change({ time: end.time, offset });
  };

  const switchMode = () => {
    setNote(null);
    if (mode === 'stay') { setMode('end'); return; }
    const m = stayMinutes(startTime, end);
    setStay(m === null ? { h: '', m: '' } : { h: String(Math.floor(m / 60)), m: String(m % 60) });
    setWithDate(false);
    setMode('stay');
  };

  const toggleDate = () => {
    if (withDate) {
      setWithDate(false);
      setEndTime(end.time);
    } else {
      setWithDate(true);
    }
  };

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

  const endDateValue = dayDate ? addDays(dayDate, end.offset) : '';
  return (
    <div className="space-y-2" data-testid="event-time">
      <div className={onStartChange ? 'tc-time-row' : ''}>
        {onStartChange && (
          <>
            <label className="text-sm font-medium text-ink-700">
              開始時刻
              <input type="time" className={field} value={startTime} onChange={(e) => setStart(e.target.value)} />
            </label>
            <span className="tc-time-tilde" aria-hidden="true">〜</span>
          </>
        )}
        <div className="min-w-0">
          <div className="flex items-end gap-2">
            {mode === 'stay' ? (
              <fieldset className="min-w-0 flex-1" disabled={!hasStart}>
                <legend className="text-sm font-medium text-ink-700">この場所での時間</legend>
                <div className="mt-1 flex items-center gap-1 text-sm text-ink-900">
                  <input type="number" min={0} max={71} inputMode="numeric" aria-label="滞在(時間)" className={`${field} mt-0 w-16`}
                    value={stay.h} onChange={(e) => applyStay(e.target.value, stay.m)} />
                  <span>時間</span>
                  <input type="number" min={0} max={59} step={5} inputMode="numeric" aria-label="滞在(分)" className={`${field} mt-0 w-16`}
                    value={stay.m} onChange={(e) => applyStay(stay.h, e.target.value)} />
                  <span>分</span>
                </div>
              </fieldset>
            ) : (
              <div className="min-w-0 flex-1">
                <label className="text-sm font-medium text-ink-700">
                  終了時刻
                  <input type="time" className={field} value={end.time} onChange={(e) => setEndTime(e.target.value)} />
                </label>
                {withDate && dayDate && (
                  <label className="mt-2 block text-sm font-medium text-ink-700">
                    終わる日
                    <input type="date" className={field} value={endDateValue} min={dayDate} max={addDays(dayDate, MAX_OFFSET)}
                      onChange={(e) => setEndDate(e.target.value)} />
                  </label>
                )}
              </div>
            )}
            {mode === 'end' && dayDate && (
              <button type="button" className="tc-focus-ring tc-time-toggle" aria-pressed={withDate} onClick={toggleDate}
                title={withDate ? '終わる日付を入れない' : '終わる日付も入れる'} data-testid="end-date-toggle"
                aria-label={withDate ? '終わる日付を入れない' : '終わる日付も入れる'}>
                <CalendarDays size={16} aria-hidden="true" />
              </button>
            )}
            <button type="button" className="tc-focus-ring tc-time-toggle" onClick={switchMode} data-testid="end-mode-toggle"
              title={mode === 'stay' ? '終了時刻(何時まで)で入れる' : '滞在時間(何時間何分)で入れる'}
              aria-label={mode === 'stay' ? '終了時刻(何時まで)で入れる' : '滞在時間(何時間何分)で入れる'}>
              <ArrowLeftRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      {mode === 'stay' && !hasStart && <p className="text-xs text-ink-700">開始時刻を入れると、この場所での時間で終わりを決められます</p>}
      {note && <p className="text-xs text-ink-700" role="status" data-testid="end-note">{note}</p>}
      <button type="button" onClick={check} disabled={busy}
        className="tc-focus-ring min-h-9 text-xs font-semibold text-accent underline disabled:opacity-50">
        {busy ? '確かめています…' : '変更の影響を確かめる'}
      </button>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {impact && (
        <div className="rounded-lg bg-cloud-100 p-2 text-sm text-ink-900 space-y-1" role="status" aria-label="変更の影響">
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
