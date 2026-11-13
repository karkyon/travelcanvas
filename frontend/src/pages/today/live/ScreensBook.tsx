/**
 * [Gate TDay-Mock] 旅帖と地図の画面: 印(Mobile-Stamp)・この場所に残す(Mobile-Memo)・旅帖(Mobile-Tabicho)・
 * 今日の旅程(Mobile-Timeline)・地図(Mobile-Map / Mobile-MapPin / PC-Map)。
 *
 * - 印を押す = 予定の実績を「行った」(到着の時刻つき)にする。到着は手で確定する(位置は送らない)
 * - 記録は「自分だけ」が既定。同行者に見せる時だけ members。旅行記に使うかは記録ごとに選ぶ
 */
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Camera, Mic, Layers, LocateFixed, Navigation, Info, Ticket as TicketIcon, PenLine } from 'lucide-react';
import { getMemoryThumbnail } from '@/services/api/photoFeatures';
import { addMedia, addNote, pressStamp, removeStamp, type EtaShare } from '@/services/api/travelDay';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { formatTimeInZone } from '../todayModel';
import {
  TYPE_LABEL, arriveDiffLabel, dateLabel, durationLabel, hoursLabel, kanjiNum, modeWord, reiwaDate, sealGlyph, speak,
  stayDiffLabel, weatherLine,
} from './todayLive';
import { Seal } from './LivePieces';
import { Pill, TodayDock } from './TodayDash';
import { arriveSky, bookingPill, openGuide, travelShort } from './todayHelpers';
import { TeaserArt } from './LiveCards';
import { useTeaserImage } from './useTeaserImage';
import ScreenFrame from './ScreenFrame';
import { EmptyScreen } from './ScreensMove';
import type { TodayCtx } from './todayCtx';
import { ALL_FILTERS, type MapFilters } from './mapFilters';

const TodayMap = React.lazy(() => import('./TodayMap'));
const hm = (iso: string | null | undefined, tz: string | null) => formatTimeInZone(iso ?? null, tz);

/** 記録の写真の小さな画像(取れなければ出さない) */
export const Thumb: React.FC<{ planId: string; id: string; size?: number; alt: string }> = ({ planId, id, size = 64, alt }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    getMemoryThumbnail(planId, id).then((b) => {
      made = URL.createObjectURL(b);
      if (alive) setUrl(made);
    }).catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [planId, id]);
  return url ? <img className="tl-thumb" src={url} alt={alt} width={size} height={size} style={{ width: size, height: size }} />
    : <span className="tl-thumb tl-thumb--empty" style={{ width: size, height: size }} aria-hidden="true" />;
};

/** 大きな印(上に場所、真ん中に字、下に和暦の日付) */
export const BigSeal: React.FC<{ title: string; glyph: string; date: string; pressed: boolean; size?: number }> = ({
  title, glyph, date, pressed, size = 220,
}) => (
  <svg className={`tl-bigseal${pressed ? ' is-pressed' : ''}`} width={size} height={size} viewBox="0 0 220 220" role="img"
    aria-label={pressed ? `${title}の印(押した)` : `${title}の印(まだ)`}>
    <defs><path id="tl-seal-top" d="M40 110 A70 70 0 0 1 180 110" /><path id="tl-seal-bot" d="M36 118 A74 74 0 0 0 184 118" /></defs>
    <circle cx="110" cy="110" r="100" fill="none" strokeWidth="6" className="ring" strokeDasharray={pressed ? undefined : '10 8'} />
    <circle cx="110" cy="110" r="90" fill="none" strokeWidth="2" className="ring" />
    {pressed && <>
      <text className="arc" fontSize="15"><textPath href="#tl-seal-top" startOffset="50%" textAnchor="middle">{title.slice(0, 10)}</textPath></text>
      <text className="arc" fontSize="12"><textPath href="#tl-seal-bot" startOffset="50%" textAnchor="middle">{date}</textPath></text>
    </>}
    <text x="110" y="128" textAnchor="middle" className="glyph" fontSize={glyph.length > 1 ? 48 : 64}>{glyph}</text>
  </svg>
);

// ---- 印 ------------------------------------------------------------------------------------------------------------

export const StampScreen: React.FC<{ ctx: TodayCtx; eventId: string | null }> = ({ ctx, eventId }) => {
  const e = ctx.events.find((x) => x.id === eventId) ?? ctx.nowEv ?? ctx.nextEv;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pressedAt, setPressedAt] = useState<string | null>(null);
  if (!e) return <EmptyScreen ctx={ctx} title="旅帖の印" text="今日の予定がありません。" />;
  const st = ctx.stamps[e.id];
  const visited = st?.status === 'visited' || pressedAt != null;
  const at = pressedAt ?? st?.actual_start_at ?? null;
  const order = ctx.events.filter((x) => ctx.visitedIds.has(x.id) || (pressedAt && x.id === e.id)).findIndex((x) => x.id === e.id) + 1;
  const diff = arriveDiffLabel(e.start_at, at);
  const sameType = ctx.events.filter((x) => x.event_type === e.event_type);
  const sameDone = sameType.filter((x) => ctx.visitedIds.has(x.id) || (pressedAt && x.id === e.id)).length;
  const firstOfTrip = (ctx.guide?.day_index ?? 1) === 1 && order === 1;
  const press = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const now = new Date().toISOString();
      await pressStamp(ctx.planId, e.id, now, st?.revision ?? null);
      setPressedAt(now);
      if (ctx.settings.voice) speak(`${e.title}に着きました。旅帖に印を押しました`);
      ctx.reloadGuide();
    } catch (err) {
      setMsg(errorDetailMessage(err, '印を押せませんでした(編集できる人だけが押せます)'));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    setBusy(true);
    try {
      await removeStamp(ctx.planId, e.id);
      setPressedAt(null);
      ctx.reloadGuide();
      ctx.close();
    } catch (err) {
      setMsg(errorDetailMessage(err, '印を取り消せませんでした'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScreenFrame title={visited ? `着きました ・ ${hm(at, ctx.timeZone)}` : 'この場所で印を押す'} onClose={ctx.close} tone="paper"
      testId="today-stamp-dialog" closeIcon="x" closeLabel="閉じる"
      footer={visited ? (
        <>
          <p className="tl-lbl">この場所のページに残す</p>
          <div className="tl-actions tl-actions--fill">
            <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('memo', e.id)}><Camera size={18} aria-hidden="true" />写真</button>
            <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('memo', e.id)}><PenLine size={18} aria-hidden="true" />ひとこと</button>
            <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('memo', e.id)}><Mic size={18} aria-hidden="true" />声で</button>
          </div>
          <button type="button" className="tc-focus-ring tl-btn tl-btn--plain" onClick={ctx.close}>あとで ・ 今日の画面へ</button>
        </>
      ) : (
        <button type="button" className="tc-focus-ring tl-btn tl-btn--coral tl-btn--block" disabled={busy || ctx.stale} onClick={() => void press()}>
          着いた・印を押す
        </button>
      )}>
      <div className="tl-stamp">
        <h3 className="tl-title tl-title--lg">{e.title}</h3>
        {visited && <p className="tl-small">{[`今日 ${Math.max(1, order)}つ目の印`, diff].filter(Boolean).join(' ・ ')}</p>}
        <BigSeal title={e.title} glyph={sealGlyph(e.title, e.event_type)} date={reiwaDate(ctx.data.today_date)} pressed={visited} />
        <p className="tl-mute tl-small">印の図柄は、場所の名前・種類・日付から作ります</p>
        {visited && (
          <div className="tl-pills tl-pills--center">
            {firstOfTrip && <Pill tone="coral">はじめての土地</Pill>}
            <Pill>{`${TYPE_LABEL[e.event_type] ?? '場所'} ${sameDone}/${sameType.length}`}</Pill>
          </div>
        )}
        {msg && <p role="status" className="tl-small">{msg}</p>}
        {ctx.stale && !visited && <p className="tl-small">通信できないため、印は通信が戻ってから押せます。</p>}
        <p className="tl-mute tl-small">到着は位置の記録（ONの人だけ）か、手で「着いた」を押して確定します</p>
        {visited && st?.status === 'visited' && (
          <button type="button" className="tc-focus-ring tl-link" disabled={busy} onClick={() => void undo()}>印を取り消す</button>
        )}
      </div>
    </ScreenFrame>
  );
};

// ---- この場所に残す --------------------------------------------------------------------------------------------------

export const MemoScreen: React.FC<{ ctx: TodayCtx; eventId: string | null }> = ({ ctx, eventId }) => {
  const e = ctx.events.find((x) => x.id === eventId) ?? ctx.nowEv ?? ctx.nextEv;
  const [photos, setPhotos] = useState<File[]>([]);
  const [audio, setAudio] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [members, setMembers] = useState(false);
  const [journal, setJournal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const previews = useMemo(() => photos.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [photos]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);
  if (!e) return <EmptyScreen ctx={ctx} title="この場所に残す" text="今日の予定がありません。" />;
  const visited = ctx.visitedIds.has(e.id);
  const canPress = !visited && (e.id === ctx.nowEv?.id || ctx.doneIds.has(e.id));
  const vis = members ? 'members' as const : 'private' as const;
  const save = async () => {
    if (!note.trim() && photos.length === 0 && !audio && !canPress) return;
    setBusy(true);
    setMsg(null);
    try {
      const dayId = ctx.guide?.day_id ?? null;
      for (const file of photos) {
        await addMedia(ctx.planId, { kind: 'photo', file, event_id: e.id, day_id: dayId, body: null, visibility: vis,
          place_name: e.title, include_in_journal: journal });
      }
      if (audio) {
        await addMedia(ctx.planId, { kind: 'audio', file: audio, event_id: e.id, day_id: dayId, body: null, visibility: vis,
          place_name: e.title, include_in_journal: journal });
      }
      if (note.trim()) {
        await addNote(ctx.planId, { event_id: e.id, day_id: dayId, body: note.trim(), visibility: vis, place_name: e.title,
          include_in_journal: journal });
      }
      if (canPress) await pressStamp(ctx.planId, e.id, new Date().toISOString(), ctx.stamps[e.id]?.revision ?? null).catch(() => undefined);
      ctx.reloadGuide();
      setPhotos([]);
      setAudio(null);
      setNote('');
      setMsg('旅帖に綴じました');
      window.setTimeout(ctx.close, 600);
    } catch (err) {
      setMsg(errorDetailMessage(err, '記録を残せませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const where = e.id === ctx.nowEv?.id ? 'NOW' : visited ? '済' : 'この後';
  return (
    <ScreenFrame title="この場所に残す" onClose={ctx.close} closeIcon="x" closeLabel="閉じる" testId="today-memo"
      footer={(
        <button type="button" className="tc-focus-ring tl-btn tl-btn--pri tl-btn--block" disabled={busy}
          onClick={() => void save()}>{canPress ? '旅帖に綴じる（印も押す）' : '旅帖に綴じる'}</button>
      )}>
      <div className="tl-pad tl-memo">
        <div className="tl-row" style={{ justifyContent: 'flex-start', gap: 12 }}>
          <Seal title={e.title} id={e.id} eventType={e.event_type} size={52} state={visited ? 'done' : 'ready'} label="" />
          <div style={{ minWidth: 0 }}>
            <b className="tl-title">{e.title}</b>
            <p className="tl-mute tl-small">{`${where} ・ ${ctx.nowLocal ?? ''} ・ 位置は写真から（保存は自分だけ）`}</p>
          </div>
        </div>
        {(previews.length > 0 || audio) && (
          <ul className="tl-previews" aria-label="選んだ写真">
            {previews.map((p) => <li key={p.url}><img src={p.url} alt={`選んだ写真 ${p.name}`} /></li>)}
            {audio && <li className="tl-previews__audio"><Mic size={18} aria-hidden="true" />声</li>}
          </ul>
        )}
        <div className="tl-actions tl-actions--fill">
          <label className="tc-focus-ring tl-btn" style={{ cursor: 'pointer' }}>
            <Camera size={18} aria-hidden="true" />写真を選ぶ
            <input type="file" accept="image/*" multiple className="sr-only" disabled={busy}
              onChange={(ev) => { setPhotos(Array.from(ev.target.files ?? []).slice(0, 10)); ev.target.value = ''; }} />
          </label>
          <label className="tc-focus-ring tl-btn" style={{ cursor: 'pointer' }}>
            <Mic size={18} aria-hidden="true" />声で残す
            <input type="file" accept="audio/*" capture className="sr-only" disabled={busy}
              onChange={(ev) => { setAudio(ev.target.files?.[0] ?? null); ev.target.value = ''; }} />
          </label>
        </div>
        <label htmlFor="tl-memo-note" className="tl-lbl">ひとこと</label>
        <textarea id="tl-memo-note" rows={4} maxLength={2000} value={note} onChange={(ev) => setNote(ev.target.value)}
          className="tc-focus-ring tl-textarea" placeholder="思ったより湖が近い。風が気持ちいい" />
        <p className="tl-lbl" id="tl-memo-who">見せる相手</p>
        <div className="tl-seg" role="group" aria-labelledby="tl-memo-who">
          <button type="button" className="tc-focus-ring" aria-pressed={!members} onClick={() => setMembers(false)}>自分だけ</button>
          <button type="button" className="tc-focus-ring" aria-pressed={members} onClick={() => setMembers(true)}>同行者</button>
          <button type="button" className="tc-focus-ring" aria-pressed={journal} onClick={() => setJournal((v) => !v)}>旅行記に使う</button>
        </div>
        {msg && <p role="status" className="tl-small">{msg}</p>}
      </div>
    </ScreenFrame>
  );
};

// ---- 旅帖 ------------------------------------------------------------------------------------------------------------

export const TabichoScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { events, stamps, timeZone } = ctx;
  const pressed = events.filter((e) => ctx.visitedIds.has(e.id)).length;
  const idx = ctx.guide?.day_index ?? null;
  const date = ctx.data.today_date;
  const wd = dateLabel(date).replace(/^.*（(.)）$/, '$1');
  return (
    <ScreenFrame title={`旅帖 ・ ${idx ? `${kanjiNum(idx)}日目` : '今日'}`} onClose={ctx.close} tone="paper" testId="today-tabicho-book"
      right={<span className="tl-small">{`${pressed} / ${events.length} 押印`}</span>}
      footer={<>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--block" onClick={() => ctx.open('photoqr')}>同行者の写真も綴じる</button>
        <TodayDock ctx={ctx} current="tabicho" />
      </>}>
      <div className="tl-pad tl-book">
        <h3 className="tl-title tl-title--lg">{ctx.dayTitle}</h3>
        <p className="tl-mute tl-small">{[`${reiwaDate(date).replace(' ', '')}${wd ? `（${wd}）` : ''}`, ctx.sky?.label].filter(Boolean).join(' ・ ')}</p>
        <ol className="tl-book__list">
          {events.map((e) => {
            const g = ctx.gEvents[e.id];
            const s = stamps[e.id];
            const done = ctx.visitedIds.has(e.id);
            return (
              <li key={e.id} className="tl-book__entry" data-done={done ? 'true' : undefined}>
                <Seal title={e.title} id={e.id} eventType={e.event_type} size={52} state={done ? 'done' : 'empty'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button type="button" className="tc-focus-ring tl-book__title" onClick={() => ctx.open(done ? 'memo' : 'place', e.id)}>
                    {`${hm(done && s?.actual_start_at ? s.actual_start_at : e.start_at, timeZone)} ${e.title}`}
                  </button>
                  {done ? (
                    <>
                      {g?.note_text && <p className="tl-book__quote">{`「${g.note_text}」`}</p>}
                      {(g?.photo_ids?.length ?? 0) > 0 && (
                        <div className="tl-book__photos">
                          {g!.photo_ids!.slice(0, 3).map((id) => <Thumb key={id} planId={ctx.planId} id={id} alt={`${e.title}の写真`} />)}
                          {g!.photo_ids!.length > 3 && <span className="tl-small">{`+${g!.photo_ids!.length - 3}`}</span>}
                        </div>
                      )}
                      {(g?.audio_count ?? 0) > 0 && <p className="tl-small">{`声のメモ ${g!.audio_count}件`}</p>}
                      {!g?.note_text && !(g?.photo_ids?.length) && !(g?.audio_count) && (
                        <p className="tl-mute tl-small">{`写真 ${s?.photo_count ?? 0}枚 ・ 記録 ${s?.memory_count ?? 0}件`}</p>
                      )}
                    </>
                  ) : (
                    <p className="tl-mute tl-small">{s?.status === 'skipped' ? '行かなかった' : '着いたら印が押されます'}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </ScreenFrame>
  );
};

// ---- 今日の旅程 --------------------------------------------------------------------------------------------------------

export const TimelineScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { events, timeZone } = ctx;
  const line = weatherLine(ctx.sky?.label ?? null, ctx.sky?.tempMax ?? null, ctx.hours);
  const doneCount = events.filter((e) => ctx.doneIds.has(e.id) || ctx.visitedIds.has(e.id)).length;
  const later = events.filter((e) => !(ctx.doneIds.has(e.id) || ctx.visitedIds.has(e.id)) && e.id !== ctx.nowEv?.id).length;
  return (
    <ScreenFrame title="今日の旅程" onClose={ctx.close} testId="today-timeline"
      right={<button type="button" className="tc-focus-ring tl-btn tl-btn--sm" aria-pressed={ctx.simple} onClick={ctx.toggleSimple}>
        {ctx.simple ? '簡易表示: 入' : '簡易表示'}</button>}
      footer={<TodayDock ctx={ctx} current="timeline" />}>
      <div className="tl-pad">
        {line && <p className="tl-small tl-mute">{line}</p>}
        <ol className="tl-tline" aria-label="今日の旅程">
          {events.map((e, i) => {
            const g = ctx.gEvents[e.id];
            const s = ctx.stamps[e.id];
            const done = ctx.doneIds.has(e.id) || ctx.visitedIds.has(e.id);
            const isNow = e.id === ctx.nowEv?.id;
            const isNext = e.id === ctx.nextEv?.id;
            const rain = ctx.rainIds.has(e.id) && !done;
            const lodging = /accommodation|lodging/.test(e.event_type);
            const state = isNow ? 'NOW' : isNext ? 'NEXT' : done ? '済' : rain ? '雨' : '';
            const nextEvent = events[i + 1];
            const toNext = nextEvent ? ctx.gEvents[nextEvent.id] : undefined;
            const end = e.end_at ?? g?.end_at ?? null;
            const stay = end && e.start_at ? Math.round((Date.parse(end) - Date.parse(e.start_at)) / 60_000) : null;
            const b = bookingPill(ctx, e);
            const h = hoursLabel(g?.hours?.status, g?.hours?.minutes_to_close);
            let sub: React.ReactNode;
            if (isNow) sub = ctx.flow?.nowProgress ? `残り${ctx.flow.nowProgress.minutesLeft}分` : '今ここ';
            else if (done && s?.actual_start_at) sub = `着いた ${hm(s.actual_start_at, timeZone)}`;
            else if (done) sub = toNext?.travel_minutes != null ? `${modeWord(toNext.travel_mode)} ${durationLabel(toNext.travel_minutes)}` : '済んだ予定';
            else if (isNext) sub = <>{b && <Pill tone={b.tone}>{b.text}</Pill>}{h && <Pill tone={h.tone}>{h.text}</Pill>}{!b && !h && travelShort(ctx, e)}</>;
            else if (rain) sub = '屋外 ・ 雨の時間にかかる';
            else if (lodging) sub = [ctx.lodging?.check_in ? `チェックイン ${ctx.lodging.check_in}〜` : 'チェックイン', b?.text].filter(Boolean).join(' ・ ');
            else sub = [g?.travel_minutes != null ? `${modeWord(g.travel_mode ?? e.transport_mode)} ${g.travel_minutes}分` : null,
              stay && stay > 0 && stay < 1440 ? `滞在${stay}分` : null].filter(Boolean).join(' ・ ') || '　';
            return (
              <li key={e.id} data-state={state || 'LATER'} className="tl-tline__row">
                <span className="tl-tline__time">{hm(e.start_at, timeZone)}</span>
                <span className="tl-tline__dot" data-state={state || 'LATER'} aria-hidden="true" />
                <button type="button" className="tc-focus-ring tl-tline__body" onClick={() => ctx.open(done ? 'map' : 'place', e.id)}>
                  <span className="tl-tline__title"><b>{e.title}</b>{state && <Pill tone={state === 'NOW' ? 'coral' : state === 'NEXT' ? 'good' : state === '雨' ? 'info' : 'mute'}>{state}</Pill>}</span>
                  <span className="tl-tline__sub">{sub}</span>
                  {e.has_ticket && <span className="sr-only">チケット</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="tl-small tl-mute" data-testid="today-summary">
          {`済んだ予定 ${doneCount}件 ・ この後 ${later}件 ・ 時刻は現地時間（${timeZone ?? '端末の時刻'}）`}
        </p>
      </div>
    </ScreenFrame>
  );
};

// ---- 地図 --------------------------------------------------------------------------------------------------------------

export const MapScreen: React.FC<{ ctx: TodayCtx; eventId: string | null; crew: EtaShare[] }> = ({ ctx, eventId, crew }) => {
  const [filters, setFilters] = useState<MapFilters>(ALL_FILTERS);
  const [sel, setSel] = useState<string | null>(eventId ?? ctx.nextEv?.id ?? ctx.nowEv?.id ?? null);
  const [pale, setPale] = useState(false);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { events, timeZone } = ctx;
  const toggle = (k: keyof MapFilters) => setFilters((f) => ({ ...f, [k]: !f[k] }));
  const chips: [keyof MapFilters, string, boolean][] = [['plan', '今日の予定', false], ['trail', '足跡', true], ['detour', '寄り道', false],
    ['rain', '雨雲', true], ['crew', '同行者', false]];
  const locate = () => {
    setMsg(null);
    if (!('geolocation' in navigator)) { setMsg('この端末では今いる場所を取れません'); return; }
    navigator.geolocation.getCurrentPosition((p) => setMe([p.coords.latitude, p.coords.longitude]),
      () => setMsg('今いる場所を取れませんでした'), { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 });
  };
  const gap = ctx.gap;
  return (
    <ScreenFrame title="当日の地図" onClose={ctx.close} closeLabel="旅の当日へ戻る" tone="map" testId="today-map-screen" wide
      right={<span className="tl-pill tl-pill--good tl-pc">{`${ctx.stale ? '保存済み' : '最新'} ${ctx.nowLocal ?? ''}`}</span>}
      footer={<span className="tl-sp"><TodayDock ctx={ctx} current="map" /></span>}>
      <div className="tl-mapscr">
        <div className="tl-mapscr__filters" role="group" aria-label="地図に出すもの">
          {chips.map(([k, label, pcOnly]) => (
            <button key={k} type="button" className={`tc-focus-ring tl-chip${pcOnly ? ' tl-pc' : ''}`} aria-pressed={filters[k]}
              onClick={() => toggle(k)}>{label}</button>
          ))}
        </div>
        <aside className="tl-mapscr__side tl-pc" aria-label="今日の道のり">
          <p className="tl-lbl">{[ctx.dayLabel, dateLabel(ctx.data.today_date)].filter(Boolean).join(' ・ ')}</p>
          <h3 className="tl-title">今日の道のり</h3>
          <ol className="tl-mapscr__list">
            {events.map((e) => {
              const done = ctx.doneIds.has(e.id) || ctx.visitedIds.has(e.id);
              const g = ctx.gEvents[e.id];
              const word = e.id === ctx.nowEv?.id ? `NOW${ctx.flow?.nowProgress ? ` ・ 残り${ctx.flow.nowProgress.minutesLeft}分` : ''}`
                : e.id === ctx.nextEv?.id ? ['NEXT', hoursLabel(g?.hours?.status, g?.hours?.minutes_to_close)?.text, bookingPill(ctx, e)?.text].filter(Boolean).join(' ・ ')
                  : done ? `済${ctx.visitedIds.has(e.id) ? ' ・ 印' : ''}` : ctx.rainIds.has(e.id) ? '雨の時間にかかる'
                    : /accommodation|lodging/.test(e.event_type) ? 'チェックイン' : travelShort(ctx, e) ?? '';
              return (
                <li key={e.id}>
                  <button type="button" className="tc-focus-ring" aria-current={sel === e.id ? 'true' : undefined} onClick={() => setSel(e.id)}>
                    <b>{`${hm(e.start_at, timeZone)} ${e.title}`}</b><span>{word}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {gap && (
            <div className="tl-card tl-card--sand tl-card--flat">
              <b>寄り道チャンス</b>
              <p className="tl-small">{`${hm(gap.start_at, timeZone)}〜${hm(gap.end_at, timeZone)} に${gap.minutes}分の空き${ctx.detourPins.length ? ` ・ 候補 ${ctx.detourPins.length}件（${ctx.detourPins.slice(0, 3).map((_, i) => String.fromCharCode(65 + i)).join('・')}）` : ''}`}</p>
              <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('detour')}>候補を見る</button>
            </div>
          )}
        </aside>
        <div className="tl-mapscr__map">
          <Suspense fallback={<div className="tl-map-loading" aria-busy="true">地図を読み込み中…</div>}>
            <TodayMap ctx={ctx} variant="full" filters={filters} selectedId={sel} onSelect={setSel} crew={crew} pale={pale} me={me} />
          </Suspense>
          <div className="tl-mapscr__tools">
            <button type="button" className="tc-focus-ring tl-icon-btn" aria-label="地図の種類" aria-pressed={pale} onClick={() => setPale((v) => !v)}>
              <Layers size={18} aria-hidden="true" /></button>
            <button type="button" className="tc-focus-ring tl-icon-btn" aria-label="今いる場所" onClick={locate}>
              <LocateFixed size={18} aria-hidden="true" /></button>
          </div>
          <div className="tl-legend tl-mapscr__legend">
            <span><b className="tl-c-coral">━</b> 今日の足跡</span><span><b className="tl-c-teal">┅</b> この後の道のり</span>
            {ctx.rainIds.size > 0 && <span><b className="tl-c-blue">○</b> 雨の時間にかかる</span>}
          </div>
          {msg && <p className="tl-mapscr__msg" role="status">{msg}</p>}
          {sel && <MapSelected ctx={ctx} eventId={sel} onPick={setSel} />}
        </div>
      </div>
    </ScreenFrame>
  );
};

const MapSelected: React.FC<{ ctx: TodayCtx; eventId: string; onPick: (id: string) => void }> = ({ ctx, eventId, onPick }) => {
  const e = ctx.events.find((x) => x.id === eventId) ?? null;
  const g = e ? ctx.gEvents[e.id] : undefined;
  const img = useTeaserImage(ctx.planId, e?.title ?? '', g?.image_memory_id ?? null);
  if (!e) return null;
  const tz = ctx.timeZone;
  const idx = ctx.events.findIndex((x) => x.id === e.id) + 1;
  const done = ctx.visitedIds.has(e.id) || ctx.doneIds.has(e.id);
  if (done) {
    const s = ctx.stamps[e.id];
    const stayDiff = stayDiffLabel(e.start_at, e.end_at ?? g?.end_at ?? null, s?.actual_start_at ?? null, s?.actual_end_at ?? null);
    return (
      <section className="tl-mapsel" aria-label={`${e.title}(済)`} data-testid="today-map-pin">
        <div className="tl-row" style={{ justifyContent: 'flex-start', gap: 10 }}>
          <Seal title={e.title} id={e.id} eventType={e.event_type} size={44} state={ctx.visitedIds.has(e.id) ? 'done' : 'empty'} />
          <div style={{ minWidth: 0 }}>
            <p className="tl-lbl">{`済 ・ ${hm(s?.actual_start_at ?? e.start_at, tz)}〜${hm(s?.actual_end_at ?? e.end_at ?? g?.end_at ?? null, tz)}`}</p>
            <b className="tl-title">{e.title}</b>
          </div>
        </div>
        <p className="tl-small tl-mute">{[stayDiff, `写真 ${s?.photo_count ?? 0}枚`].filter(Boolean).join(' ・ ')}</p>
        {(g?.photo_ids?.length ?? 0) > 0 && (
          <div className="tl-book__photos">{g!.photo_ids!.slice(0, 3).map((id) => <Thumb key={id} planId={ctx.planId} id={id} alt={`${e.title}の写真`} />)}</div>
        )}
        <div className="tl-actions tl-actions--fill">
          <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('tabicho')}>旅帖のページへ</button>
          <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={() => ctx.open('memo', e.id)}>ひとこと追加</button>
        </div>
      </section>
    );
  }
  const isNext = e.id === ctx.nextEv?.id;
  const go = isNext ? ctx.go : null;
  const h = hoursLabel(g?.hours?.status, g?.hours?.minutes_to_close);
  const b = bookingPill(ctx, e);
  const sky = arriveSky(ctx, e);
  const end = e.end_at ?? g?.end_at ?? null;
  const later = ctx.events.filter((x) => !ctx.doneIds.has(x.id) && !ctx.visitedIds.has(x.id) && x.id !== e.id && x.id !== ctx.nowEv?.id
    && Date.parse(x.start_at ?? '') > Date.parse(e.start_at ?? '')).slice(0, 4);
  const label = e.id === ctx.nowEv?.id ? 'NOW ・ 今いる場所'
    : isNext ? `NEXT ・ ${go ? (go.minutesToLeave > 0 ? `あと${go.minutesToLeave}分で出発（${hm(go.leaveBy, tz)}）` : '今出発') : `${hm(e.start_at, tz)} から`}`
      : `この後 ・ ${hm(e.start_at, tz)}`;
  return (
    <section className="tl-mapsel" aria-label={e.title} data-testid="today-map-selected">
      <div className="tl-mapsel__top">
        <div className="tl-mapsel__img">{img ? <img src={img.url} alt="" /> : <TeaserArt type={e.event_type} />}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="tl-lbl tl-lbl--coral">{label}</p>
          <b className="tl-title"><span className="tl-mapsel__num">{idx}</span>{e.title}</b>
          <p className="tl-small tl-mute">{[`${hm(e.start_at, tz)}${end ? `〜${hm(end, tz)}` : ''}`, travelShort(ctx, e)].filter(Boolean).join(' ・ ')}</p>
          <div className="tl-pills tl-pc">{h && <Pill tone={h.tone}>{h.text}</Pill>}{b && <Pill tone={b.tone}>{b.text}</Pill>}
            {sky && <Pill tone={sky.rainy ? 'info' : 'mute'}>{sky.text}</Pill>}</div>
        </div>
      </div>
      <div className="tl-actions tl-actions--fill">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--coral" onClick={() => openGuide(e)}><Navigation size={16} aria-hidden="true" />
          <span className="tl-sp">案内</span><span className="tl-not-sp">案内を開く</span></button>
        <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('place', e.id)}><Info size={16} aria-hidden="true" />詳しく</button>
        {(b || e.reservation_id) && <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('ticket', e.id)}>
          <TicketIcon size={16} aria-hidden="true" />予約</button>}
      </div>
      {later.length > 0 && (
        <div className="tl-sp">
          <p className="tl-lbl">この後の予定</p>
          <ul className="tl-later">
            {later.map((x) => (
              <li key={x.id}><button type="button" className="tc-focus-ring tl-chip" onClick={() => onPick(x.id)}>
                {`${hm(x.start_at, tz)} ${x.title}`}<span className="tl-mute">{ctx.rainIds.has(x.id) ? ' 雨の時間' : /accommodation|lodging/.test(x.event_type) ? ' チェックイン' : travelShort(ctx, x) ? ` ${travelShort(ctx, x)}` : ''}</span>
              </button></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
