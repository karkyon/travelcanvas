/**
 * [Gate TDay-Mock] 一日の時間帯・状態ごとの今日の画面: 簡易表示(Mobile-Simple)・予定が無い日(Mobile-Empty)・
 * 読み込み中/取得できない(Mobile-Loading)・通信できない(Mobile-Offline)・朝(Mobile-Morning)・夜のふりかえり(Mobile-Night)・
 * 旅の終わり(Mobile-Finish)・旅の前(Mobile-BeforeTrip)。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, CloudRain, Pause, Play, Sunrise, WifiOff } from 'lucide-react';
import { getPackingItems } from '@/services/api';
import { getWeather, type Forecast } from '@/services/api/dayVariants';
import { keepForNextTrip, type GuideUpcoming, type TodayGuide } from '@/services/api/travelDay';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { formatTimeInZone } from '../todayModel';
import { dateLabel, rainWindow, recapTitle, sealGlyph, walkedKm } from './todayLive';
import { Seal } from './LivePieces';
import { MapCard, NowCard } from './TodayDash';
import { ticketCount, travelShort } from './todayHelpers';
import { TeaserArt } from './LiveCards';
import { useTeaserImage } from './useTeaserImage';
import type { TodayCtx } from './todayCtx';
import { getMemoryThumbnail } from '@/services/api/photoFeatures';

const hm = (iso: string | null | undefined, tz: string | null) => formatTimeInZone(iso ?? null, tz);

// ---- 簡易表示 -----------------------------------------------------------------------------------------------------------

export const SimpleView: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { nowEv, nextEv, go, timeZone } = ctx;
  const p = ctx.flow?.nowProgress ?? null;
  const end = nowEv ? nowEv.end_at ?? ctx.gEvents[nowEv.id]?.end_at ?? null : null;
  const hasBooking = nextEv ? !!(ctx.guide?.bookings?.[nextEv.id] || nextEv.reservation_id || nextEv.has_ticket) : false;
  return (
    <div className="tl-simple">
      <div className="tl-row">
        <h1 className="tl-title tl-title--lg">今日 ・ 簡易表示</h1>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" aria-pressed="true" onClick={ctx.toggleSimple}>簡易表示: 入</button>
      </div>
      <section className="tl-card tl-simple__card" aria-labelledby="tl-simple-now" data-testid="today-now">
        <p className="tl-lbl" id="tl-simple-now">いま</p>
        <p className="tl-simple__title">{nowEv ? nowEv.title : '予定の合間'}</p>
        {nowEv && <p className="tl-simple__sub">{end ? `${hm(end, timeZone)} まで${p ? `（あと${p.minutesLeft}分）` : ''}` : hm(nowEv.start_at, timeZone)}</p>}
        {p && <div className="sr-only" role="progressbar" aria-label="今の予定の進み" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} />}
      </section>
      <section className="tl-card tl-simple__card" aria-labelledby="tl-simple-next" data-testid="today-next">
        <p className="tl-lbl tl-lbl--coral" id="tl-simple-next">つぎ</p>
        {nextEv ? (
          <>
            <p className="tl-simple__title">{nextEv.title}</p>
            <p className="tl-simple__sub">{[`${hm(nextEv.start_at, timeZone)} 着`, go ? `${hm(go.leaveBy, timeZone)} に出発` : null].filter(Boolean).join(' ・ ')}</p>
            <div className="tl-actions tl-actions--fill">
              <button type="button" className="tc-focus-ring tl-btn tl-btn--coral tl-btn--lg" onClick={() => ctx.open('go')}>案内を開く</button>
              {hasBooking && <button type="button" className="tc-focus-ring tl-btn tl-btn--lg" onClick={() => ctx.open('ticket', nextEv.id)}>予約を見せる</button>}
            </div>
          </>
        ) : <p className="tl-simple__sub">本日、これ以降の予定はありません</p>}
      </section>
      <p className="tl-small tl-mute">簡易表示は文字を大きく、今と次だけにします。この端末に覚えます。</p>
    </div>
  );
};

// ---- 予定が無い日 -------------------------------------------------------------------------------------------------

export const FreeDayView: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const navigate = useNavigate();
  const prev = ctx.guide?.prev_day ?? null;
  return (
    <div className="tl-free" data-testid="today-free">
      <div className="tl-free__art" aria-hidden="true"><CalendarDays size={40} /></div>
      <h1 className="tl-title tl-title--lg">今日は自由な日です</h1>
      <p>{`${dateLabel(ctx.data.today_date) || '今日'}の予定はまだありません。`}<br />行きたい場所リストや寄り道の候補から足せます。</p>
      <div className="tl-actions tl-actions--col">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={() => navigate(`/planner/${ctx.planId}/candidates?near=1`)}>近くの候補を見る</button>
        <button type="button" className="tc-focus-ring tl-btn" onClick={() => navigate(`/planner/${ctx.planId}/candidates`)}>行きたい場所リストから足す</button>
        <button type="button" className="tc-focus-ring tl-btn" onClick={() => navigate(`/planner/${ctx.planId}`)}>プランBを使う</button>
      </div>
      {prev && (
        <section className="tl-card tl-card--paper tl-inline" aria-label="昨日の旅帖">
          <Seal title={prev.title ?? '旅'} id={prev.date} size={44} label="" />
          <p className="tl-inline__text"><b>昨日の旅帖：</b>{` ${prev.visited}つの印 ・ 写真 ${prev.photos}枚`}</p>
        </section>
      )}
    </div>
  );
};

// ---- 読み込み中・取得できない --------------------------------------------------------------------------------------------

export const LoadingView: React.FC = () => (
  <div className="tl-skel" role="status" aria-busy="true" aria-label="読み込み中">
    <span className="tl-skel__band" /><span className="tl-skel__hero" /><span className="tl-skel__card" />
    <span className="tl-skel__card tl-skel__card--sm" /><span className="tl-skel__card" />
  </div>
);

export const LoadFailedView: React.FC<{ planId: string; error: string; onRetry: () => void }> = ({ planId, error, onRetry }) => {
  const navigate = useNavigate();
  return (
    <div className="tl-failed">
      <div role="alert" className="tl-card tl-card--warn">
        <b className="tl-title">当日の情報を取得できませんでした</b>
        <p className="tl-small">{error}</p>
        <p className="tl-small">端末に保存した情報もありません。電波の良い所で、もう一度お試しください。</p>
      </div>
      <div className="tl-actions tl-actions--fill">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={onRetry}>もう一度</button>
        <button type="button" className="tc-focus-ring tl-btn" onClick={() => navigate(`/planner/${planId}`)}>旅程の画面へ</button>
      </div>
    </div>
  );
};

// ---- 通信できない --------------------------------------------------------------------------------------------------

export const OfflineBar: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => (
  <div className="tl-offbar" role="status">
    <WifiOff size={18} aria-hidden="true" />
    <span><b>{typeof navigator !== 'undefined' && navigator.onLine === false ? '通信できません' : '最新の情報を取得できません'}</b>
      {` ${ctx.fetchedAt ? hm(new Date(ctx.fetchedAt).toISOString(), ctx.timeZone) : ''} に保存した情報を表示中`}</span>
  </div>
);

export const OfflineView: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { go, nextEv, timeZone } = ctx;
  const saved = ctx.fetchedAt ? hm(new Date(ctx.fetchedAt).toISOString(), timeZone) : '';
  const uses: [string, () => void][] = [['今日の予定', () => ctx.open('timeline')], ['チケットのQR', () => ctx.open('ticket')],
    ['宿の住所・電話', () => ctx.open('checkin')], ['旅帖の印・ひとこと', () => ctx.open('tabicho')]];
  return (
    <div className="tl-offline" data-testid="today-offline">
      {nextEv ? (
        <section className="tl-card tl-go" data-stage={go?.stage ?? 'none'} aria-labelledby="tl-off-go" data-testid="today-next">
          <p className="tl-lbl tl-lbl--coral" id="tl-off-go">出発の合図 ・ 端末で計算中</p>
          <p className="tl-go__head">{go ? `${hm(go.leaveBy, timeZone)} に出発（${go.minutesToLeave > 0 ? `あと${go.minutesToLeave}分` : go.stage === 'now' ? '今' : `${-go.minutesToLeave}分過ぎ`}）`
            : `${hm(nextEv.start_at, timeZone)} ${nextEv.title}`}</p>
          <p className="tl-go__sub">{`${nextEv.title} ${hm(nextEv.start_at, timeZone)}着${travelShort(ctx, nextEv) ? ` ・ ${travelShort(ctx, nextEv)}` : ''}`}</p>
          <p className="tl-go__note">{`遅延の情報は ${saved} 時点のものです`}</p>
        </section>
      ) : <p className="tl-card tl-small">本日、これ以降の予定はありません</p>}
      <NowCard ctx={ctx} />
      <div className="tl-offline__map"><p className="tl-lbl">保存した範囲の地図</p><MapCard ctx={ctx} /></div>
      <section className="tl-card" aria-labelledby="tl-off-can">
        <h2 id="tl-off-can" className="tl-lbl">通信なしで使えるもの</h2>
        <ul className="tl-offline__list">
          {uses.map(([label, fn]) => <li key={label}><button type="button" className="tc-focus-ring tl-btn" onClick={fn}>{label}</button></li>)}
        </ul>
        <p className="tl-small tl-mute">
          {`旅程の変更・写真・ひとことは端末に置き、つながった時に送ります（${ctx.pendingCount}件 待ち）。`}
        </p>
      </section>
      <section className="tl-card tl-card--flat" aria-labelledby="tl-off-cannot">
        <h2 id="tl-off-cannot" className="tl-lbl">今は使えないもの</h2>
        <p className="tl-small">寄り道の候補・最新の天気・プランBへの切り替え</p>
      </section>
      <button type="button" className="tc-focus-ring tl-btn tl-btn--pri tl-btn--block" onClick={ctx.refresh}>もう一度つなぐ</button>
    </div>
  );
};

// ---- 出発前のチェックの残り(朝) -------------------------------------------------------------------------------------

function usePrepLeft(ctx: TodayCtx): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (ctx.stale) return;
    let alive = true;
    getPackingItems(ctx.planId).then((items) => {
      if (!alive) return;
      const open = items.filter((i) => i.visibility === 'full' && i.status !== 'packed' && i.status !== 'after_use').length;
      setLeft(open + ticketCount(ctx).issues);
    }).catch(() => { if (alive) setLeft(ticketCount(ctx).issues); });
    return () => { alive = false; };
    // 朝の画面を開いた時に一度だけ数える
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.planId, ctx.stale]);
  return left;
}

const MiniPhoto: React.FC<{ ctx: TodayCtx; title: string; memoryId: string | null; type: string }> = ({ ctx, title, memoryId, type }) => {
  const img = useTeaserImage(ctx.planId, title, memoryId);
  return <span className="tl-mini-photo">{img ? <img src={img.url} alt={`${title}の画像`} /> : <TeaserArt type={type} />}</span>;
};

// ---- 朝 ------------------------------------------------------------------------------------------------------------

export const MorningView: React.FC<{ ctx: TodayCtx; onToday: () => void }> = ({ ctx, onToday }) => {
  const first = ctx.nextEv ?? ctx.events[0] ?? null;
  const left = usePrepLeft(ctx);
  const w = rainWindow(ctx.hours, 0);
  const temp = ctx.sky?.tempMax != null ? `${Math.round(ctx.sky.tempMax)}°` : null;
  const go = ctx.go;
  const fun = ctx.events.filter((e) => !/accommodation|lodging|transport/.test(e.event_type) && !/出発|自宅/.test(e.title)).slice(0, 3);
  return (
    <div className="tl-morning" data-testid="today-dawn">
      <section className="tl-morning__hero" aria-labelledby="tl-morning-title">
        <svg aria-hidden="true" viewBox="0 0 390 200" preserveAspectRatio="xMidYMid slice" className="tl-morning__art">
          <rect width="390" height="200" fill="#fde7c8" /><circle cx="300" cy="150" r="54" fill="#ffc46b" />
          <path d="M0 150 Q100 120 200 140 T390 130 V200 H0Z" fill="#f2b880" /><path d="M0 172 Q200 150 390 168 V200 H0Z" fill="#e59a6a" />
        </svg>
        <div className="tl-morning__text">
          <p className="tl-lbl tl-lbl--coral"><Sunrise size={14} aria-hidden="true" />{` おはようございます ・ ${ctx.nowLocal ?? ''}`}</p>
          <h1 id="tl-morning-title" className="tl-title tl-title--lg">{`今日は、${ctx.dayTitle}`}</h1>
          <p className="tl-small">{[ctx.dayLabel, `${ctx.events.length}か所`, ctx.lodging ? '宿まで' : null].filter(Boolean).join(' ・ ')}</p>
        </div>
      </section>
      <section className="tl-card" aria-labelledby="tl-m-sky">
        <h2 id="tl-m-sky" className="tl-lbl">今日の空模様</h2>
        <p>{[ctx.sky?.label ? `${ctx.sky.label}${temp ? ` ${temp}` : ''}` : temp, w ? `${w.start}〜${w.end}時に雨の可能性 ${w.max}%` : '雨の心配は少なめ']
          .filter(Boolean).join('、')}</p>
        {w && <p className="tl-small tl-c-blue"><CloudRain size={14} aria-hidden="true" /> 折りたたみ傘を持って出よう</p>}
      </section>
      {first && (
        <section className="tl-card" aria-labelledby="tl-m-first">
          <h2 id="tl-m-first" className="tl-lbl">最初の出発</h2>
          <p><b>{go ? `${hm(go.leaveBy, ctx.timeZone)} に出発` : `${hm(first.start_at, ctx.timeZone)} から`}</b>{` ・ ${first.title} ${hm(first.start_at, ctx.timeZone)}着`}</p>
          {go && go.minutesToLeave > 0 && <p className="tl-small tl-mute">{`あと${go.minutesToLeave}分。${ctx.settings.notices.go ? '出る10分前にもう一度お知らせします' : ''}`}</p>}
        </section>
      )}
      {fun.length > 0 && (
        <section className="tl-card" aria-labelledby="tl-m-fun">
          <h2 id="tl-m-fun" className="tl-lbl">今日の楽しみ</h2>
          <div className="tl-mini-photos">{fun.map((e) => <MiniPhoto key={e.id} ctx={ctx} title={e.title} memoryId={ctx.gEvents[e.id]?.image_memory_id ?? null} type={e.event_type} />)}</div>
          <p className="tl-small">{`${fun.map((e) => e.title).join(' → ')}${ctx.events.length > fun.length ? ' ほか' : ''}`}</p>
        </section>
      )}
      <div className="tl-actions tl-actions--col">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={() => ctx.open('prepare')}>
          {`出発前のチェック${left != null && left > 0 ? `（あと${left}つ）` : ''}`}
        </button>
        <button type="button" className="tc-focus-ring tl-btn" onClick={onToday}>今日の画面へ</button>
      </div>
    </div>
  );
};

// ---- 夜のふりかえり・旅の終わり --------------------------------------------------------------------------------------

const Reel: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const photos = ctx.guide?.day_photos ?? [];
  const [i, setI] = useState(0);
  const [play, setPlay] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  const cur = photos.length ? photos[i % photos.length]! : null;
  useEffect(() => {
    if (!play || photos.length < 2) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const t = window.setInterval(() => setI((v) => v + 1), 3000);
    return () => window.clearInterval(t);
  }, [play, photos.length]);
  useEffect(() => {
    if (!cur) return;
    let alive = true;
    let made: string | null = null;
    getMemoryThumbnail(ctx.planId, cur.id).then((b) => { made = URL.createObjectURL(b); if (alive) setUrl(made); }).catch(() => undefined);
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [ctx.planId, cur]);
  if (!cur) return null;
  const ev = ctx.events.find((e) => e.id === cur.event_id);
  return (
    <figure className="tl-reel">
      <div className="tl-reel__bars" aria-hidden="true">{photos.slice(0, 12).map((p, k) => <span key={p.id} data-on={k <= i % photos.length ? 'true' : undefined} />)}</div>
      {url ? <img src={url} alt={`${ev?.title ?? '今日'}の写真`} /> : <span className="tl-reel__empty" />}
      <figcaption><b>{`${hm(cur.at, ctx.timeZone)} ${ev?.title ?? ''}`}</b><br />{`撮った順に流れる今日のリール（写真 ${photos.length}枚）`}</figcaption>
      <button type="button" className="tc-focus-ring tl-reel__play" aria-label={play ? 'リールを止める' : 'リールを流す'} onClick={() => setPlay((v) => !v)}>
        {play ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
      </button>
    </figure>
  );
};

async function shareText(text: string): Promise<string | null> {
  try {
    if (navigator.share) { await navigator.share({ text }); return null; }
    await navigator.clipboard.writeText(text);
    return '送る文をコピーしました';
  } catch {
    return text;
  }
}

export const NightView: React.FC<{ ctx: TodayCtx; onToday: () => void }> = ({ ctx, onToday }) => {
  const g = ctx.guide as TodayGuide;
  const [hide, setHide] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [kept, setKept] = useState<string[]>([]);
  const m = g.metrics;
  const km = walkedKm(ctx.events, ctx.visitedIds);
  const next = g.next_day;
  const missed = ctx.events.filter((e) => !ctx.visitedIds.has(e.id) && ctx.stamps[e.id]?.status !== 'visited'
    && !/accommodation|lodging|transport/.test(e.event_type) && !/出発|自宅/.test(e.title)).slice(0, 2);
  const keep = async (id: string) => {
    const e = ctx.events.find((x) => x.id === id);
    if (!e) return;
    try {
      await keepForNextTrip(ctx.planId, { title: e.title, address: e.address, latitude: e.latitude, longitude: e.longitude });
      setKept((k) => [...k, id]);
    } catch (err) {
      setMsg(errorDetailMessage(err, '候補に残せませんでした'));
    }
  };
  return (
    <div className="tl-night" data-testid="today-recap">
      <p className="tl-lbl tl-lbl--mint">{`今日のふりかえり ・ ${ctx.nowLocal ?? ''}`}</p>
      <h1 className="tl-title tl-title--lg">{`おつかれさま。${recapTitle(m.visited, m.total)}`}</h1>
      <Reel ctx={ctx} />
      {!hide && (
        <div className="tl-night__stats">
          <div><b>{`${m.visited}か所`}</b><span>巡った場所</span></div>
          <div><b>{`${km}km`}</b><span>歩いた道のり（概算）</span></div>
          <div><b>{`${m.visited}印`}</b><span>旅帖の印</span></div>
        </div>
      )}
      <p className="tl-small tl-night__muted">数値は自分だけに表示（<button type="button" className="tc-focus-ring tl-link tl-link--mint" onClick={() => setHide((v) => !v)}>{hide ? '出す' : '隠せます'}</button>）。順位は作りません。</p>
      {next && (
        <section className="tl-night__box" aria-labelledby="tl-n-next">
          <h2 id="tl-n-next" className="tl-lbl tl-lbl--mint">{`明日のチラ見せ${g.day_index ? ` ・ DAY ${g.day_index + 1}` : ''}`}</h2>
          <p>{[next.first_event_time ? `${next.first_event_time.slice(0, 5)} 出発` : null, `${next.event_count}か所`, next.day_title].filter(Boolean).join(' ・ ')}</p>
          {missed.map((e) => (
            <p key={e.id} className="tl-small">
              {kept.includes(e.id) ? `今日行けなかった${e.title}を、行きたい場所リストに残しました` : <>
                {`今日行けなかった${e.title}を `}
                <button type="button" className="tc-focus-ring tl-link tl-link--mint" onClick={() => void keep(e.id)}>行きたい場所リストに残す</button></>}
            </p>
          ))}
        </section>
      )}
      <div className="tl-actions tl-actions--fill">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--gold" onClick={() => ctx.open('tabicho')}>今日の旅帖を見る</button>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--ghost" onClick={async () => setMsg(await shareText(
          `今日の旅帖「${ctx.dayTitle}」: ${m.visited}か所・写真${m.photos}枚`))}>同行者に送る</button>
      </div>
      <button type="button" className="tc-focus-ring tl-link tl-link--mint" onClick={onToday}>今日の画面を見る</button>
      {msg && <p role="status" className="tl-small">{msg}</p>}
    </div>
  );
};

export const FinishView: React.FC<{ ctx: TodayCtx; onToday: () => void }> = ({ ctx, onToday }) => {
  const navigate = useNavigate();
  const g = ctx.guide as TodayGuide;
  const trip = g.trip;
  const [kept, setKept] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const stamps = trip?.stamps ?? ctx.events.filter((e) => ctx.visitedIds.has(e.id)).map((e) => ({ event_id: e.id, title: e.title, event_type: e.event_type }));
  const missed = trip?.missed ?? [];
  const keepAll = async () => {
    try {
      for (const x of missed) {
        if (kept.includes(x.event_id)) continue;
        const e = ctx.events.find((y) => y.id === x.event_id);
        await keepForNextTrip(ctx.planId, { title: x.title, address: e?.address ?? null, latitude: e?.latitude ?? null, longitude: e?.longitude ?? null });
        setKept((k) => [...k, x.event_id]);
      }
    } catch (err) {
      setMsg(errorDetailMessage(err, '候補に残せませんでした'));
    }
  };
  const allKept = missed.length > 0 && missed.every((x) => kept.includes(x.event_id));
  return (
    <div className="tl-finish" data-testid="today-recap">
      <p className="tl-lbl tl-lbl--coral">{`旅の終わり ・ ${dateLabel(ctx.data.today_date)} ${ctx.nowLocal ?? ''}`}</p>
      <h1 className="tl-title tl-title--lg">おかえりなさい。旅帖が一冊になりました</h1>
      <section className="tl-book-cover" aria-label="旅帖">
        <b className="tl-book-cover__title">{`${ctx.tripTitle ?? '旅'} 旅帖`}</b>
        <div className="tl-book-cover__seals">
          {stamps.slice(0, 12).map((s) => <Seal key={s.event_id} title={s.title} id={s.event_id} eventType={s.event_type} size={40} />)}
          {stamps.length > 12 && <span className="tl-small">{`+${stamps.length - 12}`}</span>}
        </div>
        <p className="tl-small">{`${trip?.days ?? g.day_count}日 ・ 印 ${trip?.stamp_count ?? stamps.length} ・ 写真 ${trip?.photos ?? g.metrics.photos} ・ ひとこと ${trip?.notes ?? g.metrics.notes}`}</p>
      </section>
      {missed.length > 0 && (
        <section className="tl-card tl-card--flat" aria-label="行けなかった場所">
          {allKept ? <p>{`行けなかった ${missed.map((x) => x.title).join('・')} を「次の旅の候補」に残しました`}</p> : (
            <>
              <p>{`行けなかった ${missed.map((x) => x.title).join('・')} を「次の旅の候補」に残せます`}</p>
              <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => void keepAll()}>次の旅の候補に残す</button>
            </>
          )}
        </section>
      )}
      <div className="tl-actions tl-actions--col">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={() => navigate(`/planner/${ctx.planId}/journey`)}>旅のふりかえり・旅行記を作る</button>
        <div className="tl-actions tl-actions--fill">
          <button type="button" className="tc-focus-ring tl-btn" onClick={() => navigate(`/planner/${ctx.planId}/memories`)}>旅のリール</button>
          <button type="button" className="tc-focus-ring tl-btn" onClick={async () => setMsg(await shareText(
            `旅帖「${ctx.tripTitle ?? '旅'}」が一冊になりました: 印 ${trip?.stamp_count ?? stamps.length}・写真 ${trip?.photos ?? g.metrics.photos}枚`))}>同行者に送る</button>
        </div>
      </div>
      <button type="button" className="tc-focus-ring tl-link" onClick={onToday}>今日の画面を見る</button>
      {msg && <p role="status" className="tl-small">{msg}</p>}
      <span className="sr-only">{sealGlyph(ctx.dayTitle)}</span>
    </div>
  );
};

// ---- 旅の前 --------------------------------------------------------------------------------------------------------

export const BeforeTripView: React.FC<{ planId: string; upcoming: GuideUpcoming; title: string; destination: string | null }> = ({
  planId, upcoming, title, destination,
}) => {
  const navigate = useNavigate();
  const img = useTeaserImage(planId, destination ?? upcoming.first_event_title ?? '', null);
  const [fc, setFc] = useState<Forecast | null>(null);
  useEffect(() => {
    if (upcoming.days_until > 2) return;
    let alive = true;
    getWeather(planId, upcoming.date).then((w) => { if (alive) setFc(w.forecasts.find((f) => f.date === upcoming.date) ?? null); }).catch(() => undefined);
    return () => { alive = false; };
  }, [planId, upcoming.date, upcoming.days_until]);
  const when = upcoming.days_until <= 1 ? '明日' : `${dateLabel(upcoming.date)}`;
  return (
    <div className="tl-before" data-testid="today-before">
      <section className="tl-before__hero" aria-labelledby="tl-before-title">
        {img ? <img src={img.url} alt="" /> : <TeaserArt type="sightseeing" />}
        <div className="tl-before__text">
          <h1 id="tl-before-title" className="tl-before__h1">
            <span className="tl-lbl tl-lbl--light">{upcoming.is_trip_start ? '旅のはじまりまで' : '次の旅の日まで'}</span>
            <span className="tl-before__count">{upcoming.days_until <= 0 ? 'まもなく' : `あと ${upcoming.days_until}日`}</span>
          </h1>
          <p>{[title, `${dateLabel(upcoming.date)}${upcoming.first_event_time ? `${upcoming.first_event_time.slice(0, 5)} 出発` : ''}`].join(' ・ ')}</p>
        </div>
      </section>
      {fc && (
        <section className="tl-card" aria-labelledby="tl-b-sky">
          <h2 id="tl-b-sky" className="tl-lbl">{`${when}の空模様（予報）`}</h2>
          <p>{[fc.label, fc.rain_hours && fc.rain_hours.length ? `${fc.rain_hours.join('・')}に雨の可能性` : null].filter(Boolean).join(' ・ ')}</p>
          {fc.has_rain_variant && <p className="tl-small">雨の日のプランBが用意されています</p>}
        </section>
      )}
      <section className="tl-card" aria-labelledby="tl-b-tonight">
        <h2 id="tl-b-tonight" className="tl-lbl">今夜のうちに</h2>
        <ul className="tl-steps">
          <li>当日の情報を端末に保存（通信なしでも見られる）</li>
          <li>予約の「要確認」を確かめる</li>
          <li>同行者に到着予定の共有を頼む</li>
        </ul>
        {upcoming.first_event_title && (
          <p className="tl-small tl-mute">{`最初の予定: ${upcoming.first_event_time ? `${upcoming.first_event_time.slice(0, 5)} ` : ''}${upcoming.first_event_title}`}</p>
        )}
      </section>
      <section className="tl-card tl-card--paper tl-inline" aria-label="旅帖">
        <Seal title={upcoming.first_event_title ?? '旅'} id={upcoming.date} size={44} state="empty" label="" />
        <p className="tl-inline__text"><b>旅帖</b><br />{`${when}、${upcoming.event_count ?? ''}${upcoming.event_count ? 'つの' : ''}印が待っています`}</p>
      </section>
      <div className="tl-actions tl-actions--col">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={() => navigate(`/planner/${planId}/preparation`)}>当日の準備をする</button>
        <button type="button" className="tc-focus-ring tl-btn" onClick={() => navigate(`/planner/${planId}`)}>旅程を見る</button>
      </div>
    </div>
  );
};

