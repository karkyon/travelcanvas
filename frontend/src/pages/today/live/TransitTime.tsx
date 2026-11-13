/**
 * [Gate TDay-Transit] 電車・バスの実際の時刻。
 * 日本の電車・バスの時刻を無料で正確に返す経路の API は無い(Google の経路 API は日本の公共交通に非対応、
 * NAVITIME・駅すぱあと等は有料)。そこで、外の地図(Google マップの乗換。無料・正確)で調べ、分かった
 * 出発時刻と所要時間をこの予定へ向かう移動区間に入れる。以後の出発の合図・通知は概算ではなくこの時刻で出す。
 */
import React, { useState } from 'react';
import { ExternalLink, TrainFront } from 'lucide-react';
import type { TodayEvent } from '@/services/api';
import { saveTransitTime, type GuideEvent } from '@/services/api/travelDay';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { formatTimeInZone } from '../todayModel';
import { localToUtcIso, transitUrl } from './todayLive';

type Mode = 'train' | 'bus' | 'mixed';
const MODES: { value: Mode; label: string }[] = [
  { value: 'train', label: '電車' }, { value: 'bus', label: 'バス' }, { value: 'mixed', label: '電車とバス' },
];

const TransitTime: React.FC<{
  planId: string; next: TodayEvent; from: TodayEvent | null; guide: GuideEvent | undefined; localDate: string | null;
  timeZone: string | null; onSaved: () => void;
}> = ({ planId, next, from, guide, localDate, timeZone, onSaved }) => {
  const [open, setOpen] = useState(false);
  const initialDep = guide?.segment_departure_at ? formatTimeInZone(guide.segment_departure_at, timeZone) : '';
  const [dep, setDep] = useState(initialDep);
  const [minutes, setMinutes] = useState(guide?.travel_source === 'manual' && guide.travel_minutes ? String(guide.travel_minutes) : '');
  const [mode, setMode] = useState<Mode>(guide?.travel_mode === 'bus' ? 'bus' : guide?.travel_mode === 'mixed' ? 'mixed' : 'train');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const url = safeExternalUrl(transitUrl(from, next) ?? '');
  const canSave = !!guide && (!!guide.segment_id || !!guide.from_event_id);
  if (!url && !canSave) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guide) return;
    const n = Number(minutes);
    if (!Number.isFinite(n) || n < 1 || n > 600) {
      setErr('所要時間は 1〜600 分で入れてください');
      return;
    }
    const departure = dep ? localToUtcIso(localDate, dep, timeZone) : null;
    if (dep && !departure) {
      setErr('出発の時刻は「08:15」の形で入れてください');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await saveTransitTime(planId, { to_event_id: next.id, from_event_id: guide.from_event_id,
        segment_id: guide.segment_id, segment_revision: guide.segment_revision, mode, duration_minutes: Math.round(n),
        departure_at: departure });
      setMsg('保存しました。出発の合図と通知はこの時刻で出します');
      setOpen(false);
      onSaved();
    } catch (x) {
      setErr(errorDetailMessage(x, '保存できませんでした(旅程を変えられる人だけが保存できます)'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="today-transit-time">
      <div className="tc-go__links">
        {url && (
          <a className="tc-focus-ring tc-mbtn tc-mbtn--sm" href={url} target="_blank" rel="noopener noreferrer">
            <TrainFront size={14} aria-hidden="true" />乗換を調べる<ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
        {canSave && (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" aria-expanded={open}
            onClick={() => { setOpen((v) => !v); setMsg(null); }}>
            調べた時刻を入れる
          </button>
        )}
      </div>
      {open && (
        <form className="tc-transit-time" onSubmit={(e) => void save(e)} aria-label="乗換で調べた時刻" style={{ marginTop: 10 }}>
          <div className="tc-transit-time__row">
            <label htmlFor="tday-transit-dep">出発(任意)
              <input id="tday-transit-dep" type="time" value={dep} onChange={(e) => setDep(e.target.value)} />
            </label>
            <label htmlFor="tday-transit-min">所要(分)
              <input id="tday-transit-min" type="number" inputMode="numeric" min={1} max={600} required value={minutes}
                onChange={(e) => setMinutes(e.target.value)} />
            </label>
          </div>
          <label htmlFor="tday-transit-mode">乗り物
            <select id="tday-transit-mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <p className="tc-live-muted" style={{ margin: 0 }}>
            家・駅を出る時刻と、着くまでの分(歩く分も含めて)。出発を入れると、その時刻を「出る時刻」にします。
          </p>
          <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy}>この時刻で合図を出す</button>
        </form>
      )}
      {msg && <p className="tc-live-muted" role="status">{msg}</p>}
      {err && <p className="tc-live-error" role="alert">{err}</p>}
    </div>
  );
};

export default TransitTime;
