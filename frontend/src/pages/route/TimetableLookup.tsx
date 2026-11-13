/**
 * [Gate Remaining-2] FR-014・FR-015・FR-017 時刻表・運賃の候補(駅すぱあと。運用で鍵を登録した時だけ)。
 *
 * 押した時だけ探す。送るのは駅名と日時だけ。選んだ候補は経路候補の欄(所要時間・運賃・乗り換え・区間)に入れるだけで、
 * 保存は利用者が「保存」を押した時(勝手に旅程を変えない)。鍵が無い・取れない時は手で入れる案内を出す。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import { searchTimetable, type TimetableCandidate } from '@/services/api/remaining2';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const hm = (iso: string | null) => (iso ? iso.slice(11, 16) : '—');

const TimetableLookup: React.FC<{
  planId: string;
  origin: string;
  destination: string;
  date: string;
  onPick: (c: TimetableCandidate) => void;
}> = ({ planId, origin: o0, destination: d0, date: date0, onPick }) => {
  const [origin, setOrigin] = useState(o0);
  const [destination, setDestination] = useState(d0);
  const [date, setDate] = useState(date0);
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [found, setFound] = useState<TimetableCandidate[]>([]);

  const run = async () => {
    if (!origin.trim() || !destination.trim() || !date) {
      setMessage('出発・到着の駅と日付を入れてください');
      return;
    }
    setBusy(true);
    setMessage(null);
    setFound([]);
    try {
      const r = await searchTimetable(planId, {
        origin: origin.trim(), destination: destination.trim(), date, ...(time ? { time } : {}),
      });
      setFound(r.candidates);
      setMessage(r.message);
    } catch (e) {
      setMessage(errorDetailMessage(e, '時刻表を取れませんでした。手で入れてください'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="border rounded-md p-3" data-testid="timetable-lookup">
      <legend className="text-sm font-medium px-1">時刻表から探す(任意)</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">出発の駅
          <input className="w-full border rounded-md px-2 py-1 text-sm" value={origin} maxLength={60}
            onChange={(e) => setOrigin(e.target.value)} />
        </label>
        <label className="text-xs">到着の駅
          <input className="w-full border rounded-md px-2 py-1 text-sm" value={destination} maxLength={60}
            onChange={(e) => setDestination(e.target.value)} />
        </label>
        <label className="text-xs">日付
          <input type="date" className="w-full border rounded-md px-2 py-1 text-sm" value={date}
            onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs">出発の時刻
          <input type="time" className="w-full border rounded-md px-2 py-1 text-sm" value={time}
            onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <div className="mt-2">
        <Button variant="outline" size="sm" loading={busy} onClick={run}>時刻表から探す</Button>
      </div>
      {message && <p className="text-xs text-ink-700 mt-2" role="status">{message}</p>}
      {found.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="時刻表の候補">
          {found.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-md px-2 py-1">
              <span>
                {`${hm(c.legs[0]?.departure_at ?? null)} → ${hm(c.legs[c.legs.length - 1]?.arrival_at ?? null)}`}
                {c.total_duration_minutes !== null && ` ・ ${c.total_duration_minutes}分`}
                {c.transfer_count !== null && ` ・ 乗り換え${c.transfer_count}回`}
                {c.total_cost !== null && ` ・ ${c.total_cost.toLocaleString()}円`}
                <span className="block text-xs text-ink-700">{c.legs.map((l) => l.line || l.mode).join(' → ')}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => onPick(c)}>この候補を入れる</Button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
};

export default TimetableLookup;
