/**
 * [Gate TDay] 寄り道チャンス: すきま時間(次の予定へ出るまで 30 分以上)に、前後の予定を結ぶ道の近く(2km 以内)の候補。
 * 外の検索(無料の provider)は押した時だけ呼ぶ(開いただけでは探さない)。足す前に後の予定への影響を出し、
 * 承認した時だけ旅程に予定を足す(候補そのものは保存しない)。
 */
import React, { useState } from 'react';
import { Clock, Plus } from 'lucide-react';
import type { TodayEvent } from '@/services/api';
import {
  addDetourEvent, findDetours, type DetourCandidate, type DetourKind, type GuideGap,
} from '@/services/api/travelDay';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { formatTimeInZone } from '../todayModel';
import { planDetour, walkMinutes } from './todayLive';

const KINDS: [DetourKind, string][] = [['all', 'すべて'], ['indoor', '屋内だけ'], ['cafe', 'カフェ'], ['sweets', '甘いもの'],
  ['surprise', '意外な一軒']];
const STAYS = [20, 30, 45];

export const Detours: React.FC<{
  planId: string; dayId: string | null; gap: GuideGap; events: TodayEvent[]; timeZone: string | null; canEdit: boolean;
  onFound: (c: DetourCandidate[]) => void; onAdded: () => void;
}> = ({ planId, dayId, gap, events, timeZone, canEdit, onFound, onAdded }) => {
  const [kind, setKind] = useState<DetourKind>('all');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<DetourCandidate[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [picked, setPicked] = useState<DetourCandidate | null>(null);
  const [stay, setStay] = useState(30);
  const [done, setDone] = useState<string | null>(null);
  const after = events.find((e) => e.id === gap.after_event_id);
  const before = events.find((e) => e.id === gap.before_event_id);

  const search = async (k: DetourKind) => {
    setKind(k);
    setBusy(true);
    setMessage(null);
    setPicked(null);
    try {
      const r = await findDetours(planId, { after_event_id: gap.after_event_id, before_event_id: gap.before_event_id, kind: k });
      setItems(r.candidates);
      setMessage(r.message);
      onFound(r.candidates);
    } catch (e) {
      setItems([]);
      setMessage(errorDetailMessage(e, '寄り道の候補を探せませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const plan = picked ? planDetour(gap, stay, walkMinutes(picked.distance_km), timeZone) : null;
  const add = async () => {
    if (!picked || !plan || !dayId) return;
    setBusy(true);
    try {
      await addDetourEvent(planId, { day_id: dayId, title: picked.name, local_start_time: plan.start, local_end_time: plan.end,
        address: picked.address, latitude: picked.latitude, longitude: picked.longitude });
      setDone(`「${picked.name}」を ${plan.start} に足しました`);
      setPicked(null);
      onAdded();
    } catch (e) {
      setMessage(errorDetailMessage(e, '旅程に足せませんでした'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tc-live-card tc-live-card--sand" aria-labelledby="today-detour-title" data-testid="today-detour">
      <div className="tc-live-row" style={{ justifyContent: 'space-between' }}>
        <h2 id="today-detour-title" className="tc-live-label tc-live-label--gold">
          <Clock size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />寄り道チャンス
        </h2>
        <span className="tc-live-muted">
          {`${formatTimeInZone(gap.start_at, timeZone)}〜${formatTimeInZone(gap.end_at, timeZone)} に${gap.minutes}分の空き`}
        </span>
      </div>
      <p className="tc-live-muted" style={{ margin: '4px 0 0' }}>
        {`${after?.title ?? '前の予定'} のあと、${before?.title ?? '次の予定'} へ向かう道の近く(2km 以内)`}
      </p>
      <div role="group" aria-label="寄り道の種類" className="tc-live-chips">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" className={`tc-focus-ring tc-mbtn tc-mbtn--sm ${items && kind === k ? 'tc-mbtn--primary' : ''}`}
            aria-pressed={items != null && kind === k} disabled={busy} onClick={() => search(k)}>{label}</button>
        ))}
      </div>
      {items == null && !busy && <p className="tc-live-muted" style={{ margin: '8px 0 0' }}>種類を押すと近くの候補を探します。</p>}
      {busy && <p className="tc-live-muted" role="status" style={{ margin: '8px 0 0' }}>探しています…</p>}
      {message && <p className="tc-live-muted" role="status" style={{ margin: '8px 0 0' }}>{message}</p>}
      {done && <p role="status" className="tc-live-chip tc-live-chip--good" style={{ marginTop: 8 }}>{done}</p>}
      {items && items.length > 0 && (
        <ul className="tc-detour__list">
          {items.map((c, i) => (
            <li key={`${c.name}-${i}`} className="tc-detour__item">
              <span className="tc-tmap__pin" data-state="detour" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
              <div>
                <b>{c.name}</b>
                <div className="tc-live-chips" style={{ marginTop: 4 }}>
                  {c.distance_km != null && <span className="tc-live-chip">{`経路から ${Math.round(c.distance_km * 1000)}m`}</span>}
                  <span className="tc-live-chip">{`歩いて約${walkMinutes(c.distance_km)}分`}</span>
                  {c.fit === 'indoor' && <span className="tc-live-chip tc-live-chip--info">屋内</span>}
                  {c.genre_label && <span className="tc-live-chip">{c.genre_label}</span>}
                </div>
              </div>
              {canEdit && (
                <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setPicked(c)}
                  aria-label={`${c.name}を足す前に影響を見る`}><Plus size={14} aria-hidden="true" />足す</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {picked && plan && (
        <div className="tc-detour__impact" role="region" aria-label="足す前の影響">
          <b>{`「${picked.name}」を足すと`}</b>
          <div role="radiogroup" aria-label="寄る長さ" className="tc-live-chips">
            {STAYS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={stay === m}
                className={`tc-focus-ring tc-mbtn tc-mbtn--sm ${stay === m ? 'tc-mbtn--primary' : ''}`} onClick={() => setStay(m)}>{`${m}分`}</button>
            ))}
          </div>
          <ul>
            <li>{`寄る時間: ${plan.start}〜${plan.end}(行き帰り 各約${walkMinutes(picked.distance_km)}分)`}</li>
            <li>{plan.fits ? `${before?.title ?? '次の予定'}: 変わらず(あと${plan.leftMinutes}分の余裕)`
              : `${before?.title ?? '次の予定'}: ${plan.overflowMinutes}分はみ出します`}</li>
          </ul>
          <p className="tc-live-muted" style={{ margin: '6px 0 0' }}>移動時間は直線距離からの概算です。足した予定は旅程からいつでも消せます。</p>
          <div className="tc-live-actions">
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy || !dayId} onClick={add}>
              今日の旅程に足す
            </button>
            <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => setPicked(null)}>やめる</button>
          </div>
        </div>
      )}
    </section>
  );
};

export default Detours;
