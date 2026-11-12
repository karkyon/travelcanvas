/**
 * [Gate TDay] 旅帖(たびちょう): 着いた予定ごとに、その場所だけの印が押され、写真・ひとこと・声が綴じられていく。
 *
 * - 印を押す = 予定の実績を「行った」(到着の時刻つき)にする(旅の振り返り・Journey と同じ記録。新しい表は作らない)
 * - 到着は位置の記録(ONの人だけ)か、手で「着いた」を押して確定する。ここでは位置を送らない
 * - 記録は「自分だけ」が既定。同行者に見せる時だけ members
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Mic, PenLine } from 'lucide-react';
import Modal from '@/components/common/Modal';
import type { TodayEvent } from '@/services/api';
import { addMedia, addNote, pressStamp, removeStamp, type GuideStamp } from '@/services/api/travelDay';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { formatTimeInZone } from '../todayModel';
import { Seal } from './LivePieces';
import { speak } from './todayLive';

export const TabichoStrip: React.FC<{
  events: TodayEvent[]; stamps: Record<string, GuideStamp>; nowId: string | null; timeZone: string | null;
  onOpen: (eventId: string) => void; onBook: () => void;
}> = ({ events, stamps, nowId, timeZone, onOpen, onBook }) => {
  const pressed = events.filter((e) => stamps[e.id]?.status === 'visited').length;
  return (
    <section className="tc-live-card tc-live-card--sand" aria-labelledby="today-tabicho-title" data-testid="today-tabicho">
      <div className="tc-live-row" style={{ justifyContent: 'space-between' }}>
        <h2 id="today-tabicho-title" className="tc-lv-title" style={{ margin: 0, fontSize: 17 }}>今日の旅帖</h2>
        <span className="tc-live-muted">{`${pressed} / ${events.length} 押印`}</span>
      </div>
      <ul className="tc-tabicho__strip">
        {events.map((e) => {
          const st = stamps[e.id]?.status === 'visited' ? 'done' : e.id === nowId ? 'ready' : 'empty';
          return (
            <li key={e.id}>
              <button type="button" className="tc-focus-ring" onClick={() => onOpen(e.id)}
                aria-label={`${e.title}(${st === 'done' ? '印を押した' : st === 'ready' ? 'ここで印を押せます' : 'まだ'})`}>
                <Seal title={e.title} id={e.id} eventType={e.event_type} size={52} state={st} label="" />
              </button>
              <span>{st === 'ready' ? '押せます' : formatTimeInZone(e.start_at, timeZone)}</span>
            </li>
          );
        })}
      </ul>
      <div className="tc-live-actions"><button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={onBook}>旅帖を開く</button></div>
    </section>
  );
};

export const StampDialog: React.FC<{
  planId: string; dayId: string | null; event: TodayEvent | null; stamp: GuideStamp | undefined; canEdit: boolean;
  voice: boolean; timeZone: string | null; onClose: () => void; onChanged: () => void;
}> = ({ planId, dayId, event, stamp, canEdit, voice, timeZone, onClose, onChanged }) => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [members, setMembers] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [justPressed, setJustPressed] = useState(false);
  if (!event) return null;
  const visited = stamp?.status === 'visited' || justPressed;

  const press = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await pressStamp(planId, event.id, new Date().toISOString(), stamp?.revision ?? null);
      setJustPressed(true);
      if (voice) speak(`${event.title}に着きました。旅帖に印を押しました`);
      onChanged();
    } catch (e) {
      setMsg(errorDetailMessage(e, '印を押せませんでした(編集できる人だけが押せます)'));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    setBusy(true);
    try {
      await removeStamp(planId, event.id);
      setJustPressed(false);
      onChanged();
      onClose();
    } catch (e) {
      setMsg(errorDetailMessage(e, '印を取り消せませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await addNote(planId, { event_id: event.id, day_id: dayId, body: note.trim(), visibility: members ? 'members' : 'private',
        place_name: event.title });
      setNote('');
      setMsg('ひとことを綴じました');
      onChanged();
    } catch (e) {
      setMsg(errorDetailMessage(e, 'ひとことを残せませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (kind: 'photo' | 'audio', files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, 10);
    if (list.length === 0) return;
    setBusy(true);
    try {
      for (const file of list) {
        await addMedia(planId, { kind, file, event_id: event.id, day_id: dayId, body: null,
          visibility: members ? 'members' : 'private', place_name: event.title });
      }
      setMsg(kind === 'photo' ? `写真 ${list.length}枚を綴じました` : '声の記録を綴じました');
      onChanged();
    } catch (e) {
      setMsg(errorDetailMessage(e, '記録を残せませんでした'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={visited ? '旅帖に綴じる' : 'この場所で印を押す'} size="md">
      <div className="tc-stamp-hero" data-testid="today-stamp-dialog">
        <p className="tc-live-label tc-live-label--gold">
          {visited ? `着きました${stamp?.actual_start_at ? ` ・ ${formatTimeInZone(stamp.actual_start_at, timeZone)}` : ''}` : '着いたら押す'}
        </p>
        <h3 className="tc-lv-title" style={{ fontSize: 22 }}>{event.title}</h3>
        <Seal title={event.title} id={event.id} eventType={event.event_type} size={150} state={visited ? 'done' : 'ready'}
          press={justPressed} />
        <p className="tc-live-muted">印の字は場所の名前と種類から作ります。到着は手で確定します(位置は送りません)</p>
        {!visited && canEdit && (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy} onClick={press}
            style={{ minWidth: 200, justifyContent: 'center' }}>着いた・印を押す</button>
        )}
        {!canEdit && <p className="tc-live-muted">見るだけの参加者は印を押せません。記録は残せます。</p>}
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        <p className="tc-live-label">この場所のページに残す</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <label className="tc-focus-ring tc-mbtn" style={{ justifyContent: 'center', cursor: 'pointer' }}>
            <Camera size={18} aria-hidden="true" />写真
            <input type="file" accept="image/*" multiple className="sr-only" disabled={busy}
              onChange={(e) => { void upload('photo', e.target.files); e.target.value = ''; }} />
          </label>
          <label className="tc-focus-ring tc-mbtn" style={{ justifyContent: 'center', cursor: 'pointer' }}>
            <Mic size={18} aria-hidden="true" />声で
            <input type="file" accept="audio/*" capture className="sr-only" disabled={busy}
              onChange={(e) => { void upload('audio', e.target.files); e.target.value = ''; }} />
          </label>
          <button type="button" className="tc-focus-ring tc-mbtn" style={{ justifyContent: 'center' }}
            onClick={() => document.getElementById('tday-note')?.focus()}><PenLine size={18} aria-hidden="true" />ひとこと</button>
        </div>
        <label htmlFor="tday-note" className="tc-live-muted">ひとこと</label>
        <textarea id="tday-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
          className="tc-focus-ring" style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 15,
            border: '1px solid var(--tc-cloud-200)', borderRadius: 12, padding: 10, background: 'var(--tc-surface-solid)',
            color: 'var(--tc-ink-900)' }} placeholder="思ったより湖が近い。風が気持ちいい" />
        <label className="tc-live-switch" style={{ borderBottom: 0, paddingTop: 0 }}>
          <span>同行者にも見せる<small>既定は自分だけ</small></span>
          <input type="checkbox" checked={members} onChange={(e) => setMembers(e.target.checked)} />
        </label>
        {msg && <p role="status" className="tc-live-chip tc-live-chip--good" style={{ justifySelf: 'start' }}>{msg}</p>}
        <div className="tc-live-actions" style={{ marginTop: 0 }}>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy || !note.trim()} onClick={save}>
            ひとことを綴じる
          </button>
          <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => navigate(`/planner/${planId}/memories`)}>記録の一覧</button>
          {visited && canEdit && stamp?.status === 'visited' && (
            <button type="button" className="tc-focus-ring tc-mbtn" disabled={busy} onClick={undo}>印を取り消す</button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export const TabichoDialog: React.FC<{
  open: boolean; onClose: () => void; title: string; dateLabel: string; events: TodayEvent[];
  stamps: Record<string, GuideStamp>; timeZone: string | null; onOpen: (eventId: string) => void; planId: string;
}> = ({ open, onClose, title, dateLabel, events, stamps, timeZone, onOpen, planId }) => {
  const navigate = useNavigate();
  const pressed = events.filter((e) => stamps[e.id]?.status === 'visited').length;
  return (
    <Modal isOpen={open} onClose={onClose} title="今日の旅帖" size="md">
      <div className="tc-tabicho__page" data-testid="today-tabicho-book">
        <p className="tc-live-label tc-live-label--gold">{`${dateLabel} ・ ${pressed} / ${events.length} 押印`}</p>
        <h3 className="tc-lv-title" style={{ fontSize: 22, marginBottom: 8 }}>{title}</h3>
        {events.map((e) => {
          const s = stamps[e.id];
          const done = s?.status === 'visited';
          return (
            <div key={e.id} className="tc-tabicho__entry">
              <Seal title={e.title} id={e.id} eventType={e.event_type} size={56} state={done ? 'done' : 'empty'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{`${formatTimeInZone(done && s?.actual_start_at ? s.actual_start_at : e.start_at, timeZone)} ${e.title}`}</b>
                <p className="tc-live-muted" style={{ margin: '2px 0 0' }}>
                  {done ? `写真 ${s?.photo_count ?? 0}枚 ・ 記録 ${s?.memory_count ?? 0}件` : s?.status === 'skipped' ? '行かなかった' : '着いたら印が押されます'}
                </p>
              </div>
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => onOpen(e.id)}>
                {done ? '綴じる' : '開く'}
              </button>
            </div>
          );
        })}
        <div className="tc-live-actions">
          <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => navigate(`/planner/${planId}/journey`)}>旅の振り返りへ</button>
          <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => navigate(`/planner/${planId}/memories`)}>同行者の写真も集める</button>
        </div>
      </div>
    </Modal>
  );
};
