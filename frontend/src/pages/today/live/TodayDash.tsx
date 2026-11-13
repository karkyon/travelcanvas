/**
 * [Gate TDay-Mock] 旅の当日「今日」の画面のカード(モックアップ Mobile-Today / Tablet / Tablet-Land / Main の各部)。
 *
 * スマホ(〜639px)は 1 列(出発の合図 → チラ見せ → 地図 → NOW → 雨 → 寄り道 → 同行者 → 旅帖)、
 * タブレット縦(640〜1023px)は 2 列、タブレット横(1024〜1279px)は左 420px + 地図、PC(1280px〜)は 3 列 + 下段(旅帖・お助け)。
 * 同じカードを 1 回だけ描き、並びは CSS(today-mock.css)で変える。状態は色だけで伝えない(必ず文字)。
 */
import React, { Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, BookOpen, Camera, CloudRain, Coffee, Home, Languages, LifeBuoy, Map as MapIcon, Navigation, QrCode,
  RefreshCw, Settings2, Sun, Ticket, Wallet, ListOrdered, CalendarDays, ListChecks,
} from 'lucide-react';
import { findDetours, type DetourCandidate } from '@/services/api/travelDay';
import { safeExternalUrl, safeTelHref } from '@/utils/safeNavigation';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { formatTimeInZone } from '../todayModel';
import {
  STAGE_LABEL, STAGE_ORDER, dateLabel, hoursLabel, localHm, rainWindow, sealGlyph,
  type GoNowView, type SkyHour,
} from './todayLive';
import { JourneyThread, Seal } from './LivePieces';
import { TeaserArt } from './LiveCards';
import { useTeaserImage } from './useTeaserImage';
import type { TodayCtx, TodayScreen } from './todayCtx';
import { arriveSky, bookingPill, travelShort, type useCrew } from './todayHelpers';
import type { GuideEvent } from '@/services/api/travelDay';

const TodayMap = React.lazy(() => import('./TodayMap'));

const hm = (iso: string | null | undefined, tz: string | null) => formatTimeInZone(iso ?? null, tz);

// ---- 小さな部品 ---------------------------------------------------------------------------------------------------

export const Pill: React.FC<{ tone?: 'good' | 'warn' | 'bad' | 'info' | 'mute' | 'coral'; children: React.ReactNode }> = ({
  tone = 'mute', children,
}) => <span className={`tl-pill tl-pill--${tone}`}>{children}</span>;

/** 出発までの輪(80px / 118px / 240px) */
export const GoRing: React.FC<{ view: GoNowView; size: number; top?: string | null; big?: string }> = ({ view, size, top, big }) => {
  const dash = Math.round((view.stage === 'now' || view.stage === 'late' ? 1 : view.ring) * 314);
  const label = big ?? (view.minutesToLeave > 0 ? `${view.minutesToLeave}分` : view.stage === 'now' ? '今' : `+${-view.minutesToLeave}分`);
  return (
    <svg className="tl-ring" data-stage={view.stage} width={size} height={size} viewBox="0 0 120 120" role="img"
      aria-label={`${top ?? '出発まで'} ${label}`}>
      <circle className="bg" cx="60" cy="60" r="50" fill="none" strokeWidth="13" />
      <circle className="fg" cx="60" cy="60" r="50" fill="none" strokeWidth="13" strokeLinecap="round"
        strokeDasharray={`${dash} 314`} transform="rotate(-90 60 60)" />
      {top && <text className="sub" x="60" y="48" textAnchor="middle" fontSize="12" fontWeight="700">{top}</text>}
      <text x="60" y={top ? 78 : 70} textAnchor="middle" fontSize={label.length > 3 ? 24 : 30} fontWeight="800">{label}</text>
    </svg>
  );
};




// ---- 上: ライブ帯・旅の始まりの帯(今日の題) -------------------------------------------------------------------

export const TodayBand: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { go, nextEv, timeZone } = ctx;
  const w = rainWindow(ctx.hours, ctx.nowHour);
  return (
    <div className="tl-band" role="status" aria-label="ライブ帯" data-testid="today-live-band">
      <b className="tl-band__live"><span className="tl-band__dot" aria-hidden="true" />{ctx.stale ? '保存済み' : 'LIVE'}
        <span className="tl-sp">{` ${ctx.nowLocal ?? ''}`}</span></b>
      {ctx.nowLocal && <span className="tl-pc">現地 <b>{ctx.nowLocal}</b></span>}
      {nextEv && <span className="tl-band__next">次 <b>{`${hm(nextEv.start_at, timeZone)} ${nextEv.title}`}</b></span>}
      {go && (
        <span className="tl-band__go" data-stage={go.stage}>
          <span className="tl-sp">{go.minutesToLeave > 0 ? `${go.minutesToLeave}分` : go.stage === 'now' ? '今出発' : `+${-go.minutesToLeave}分`}</span>
          <span className="tl-wide">{go.minutesToLeave > 0 ? `あと${go.minutesToLeave}分で出発` : go.stage === 'now' ? '今出発' : `出発を${-go.minutesToLeave}分過ぎた`}</span>
        </span>
      )}
      {nextEv && travelShort(ctx, nextEv) && <span className="tl-band__muted tl-pc">{travelShort(ctx, nextEv)}</span>}
      <span className="tl-band__muted tl-pc">{ctx.delayed ? '遅延・休業の知らせ あり' : '遅延・休業の知らせ なし'}</span>
      {w && <span className="tl-band__end tl-wide">
        <span className="tl-pc">{`${w.start}時から雨の可能性 ${w.max}%`}</span><span className="tl-tab">{`${w.start}時〜 雨 ${w.max}%`}</span>
      </span>}
    </div>
  );
};

export const TodayToolbar: React.FC<{ ctx: TodayCtx; syncedAt: string | null }> = ({ ctx, syncedAt }) => (
  <div className="tl-toolbar">
    <span className={`tl-pill ${ctx.stale ? 'tl-pill--warn' : 'tl-pill--good'}`} data-testid="today-sync">
      {ctx.stale ? `保存済み${syncedAt ? ` ${syncedAt}` : ''}` : `最新${syncedAt ? ` ${syncedAt}` : ''} 同期`}
    </span>
    <button type="button" onClick={ctx.refresh} aria-label="更新" className="tc-focus-ring tl-icon-btn">
      <RefreshCw size={16} aria-hidden="true" />
    </button>
    <button type="button" onClick={ctx.toggleSimple} aria-pressed={ctx.simple} className="tc-focus-ring tl-icon-btn tl-icon-btn--text">
      <ListChecks size={16} aria-hidden="true" />{ctx.simple ? '簡易表示: 入' : '簡易表示'}
    </button>
    <button type="button" onClick={() => ctx.open('settings')} aria-label="当日の設定" className="tc-focus-ring tl-icon-btn">
      <Settings2 size={16} aria-hidden="true" />
    </button>
  </div>
);

export const TodayHero: React.FC<{ ctx: TodayCtx; showZoneNote: boolean }> = ({ ctx, showZoneNote }) => {
  const { events, timeZone } = ctx;
  const w = rainWindow(ctx.hours, ctx.nowHour);
  const temp = ctx.sky?.tempMax != null ? `${Math.round(ctx.sky.tempMax)}°` : null;
  const visited = events.filter((e) => ctx.visitedIds.has(e.id) || ctx.doneIds.has(e.id)).length;
  const date = dateLabel(ctx.data.today_date);
  return (
    <section className="tl-hero" aria-labelledby="today-hero-title">
      <svg className="tl-hero__wave" aria-hidden="true" viewBox="0 0 360 160" preserveAspectRatio="none">
        <path d="M0 120 Q90 100 180 114 T360 106 V160 H0Z" />
      </svg>
      <div className="tl-hero__body">
        <div className="tl-hero__top">
          <p className="tl-hero__eyebrow">
            {[ctx.dayLabel, date, ctx.destination].filter(Boolean).join(' ・ ') || 'TODAY'}
          </p>
          {(temp || w || ctx.sky?.label) && (
            <span className="tl-hero__sky tl-not-pc">
              <Sun size={14} aria-hidden="true" />
              {[temp, w ? `${w.start}時〜雨` : ctx.sky?.label].filter(Boolean).join(' ・ ')}
            </span>
          )}
        </div>
        <div className="tl-hero__main">
          <div style={{ minWidth: 0 }}>
            <h1 id="today-hero-title" className="tl-hero__title">{ctx.dayTitle}</h1>
            <p className="tl-hero__lead tl-pc">
              {`${events.length}か所のうち ${visited}か所を巡りました。`}
              {ctx.nextEv ? `次は${ctx.nextEv.title}へ。` : ''}
            </p>
            {showZoneNote && <p className="tl-hero__note">{`時刻は現地時間(${timeZone})`}</p>}
          </div>
          {(temp || ctx.sky?.label || w) && (
            <div className="tl-hero__weather tl-pc">
              {temp && <b>{temp}</b>}
              <span>{ctx.sky?.label ? `今は${ctx.sky.label}` : '今日の空模様'}</span>
              {w && <span>{`${w.start}〜${w.end}時 雨の可能性 ${w.max}%・傘を持って出よう`}</span>}
            </div>
          )}
        </div>
        {!ctx.simple && events.length > 0 && (
          <JourneyThread events={events} timeZone={timeZone} nowId={ctx.nowEv?.id ?? null} nextId={ctx.nextEv?.id ?? null}
            doneIds={ctx.doneIds} stamps={ctx.stamps} rainIds={ctx.rainIds} />
        )}
        {!ctx.simple && events.length > 0 && (
          <div className="tl-hero__progress tl-pc" role="progressbar" aria-label="今日の進み" aria-valuemin={0}
            aria-valuemax={events.length} aria-valuenow={visited}>
            <span style={{ width: `${Math.round((visited / Math.max(1, events.length)) * 100)}%` }} />
          </div>
        )}
      </div>
    </section>
  );
};

// ---- 出発の合図(NEXT) ------------------------------------------------------------------------------------------

export const GoCard: React.FC<{ ctx: TodayCtx; onShareEta: () => void }> = ({ ctx, onShareEta }) => {
  const { go, nextEv: e, timeZone } = ctx;
  if (!e) return null;
  const travel = travelShort(ctx, e);
  const start = hm(e.start_at, timeZone);
  const leave = go ? hm(go.leaveBy, timeZone) : null;
  const hasBooking = !!(ctx.guide?.bookings?.[e.id] || e.reservation_id || e.has_ticket);
  const status = e.transport_status === 'delayed' ? '遅延' : e.transport_status === 'cancelled' ? '運休' : null;
  return (
    <section className="tl-card tl-go" data-stage={go?.stage ?? 'none'} aria-labelledby="today-next-title" data-testid="today-next">
      <div className="tl-row">
        <p className="tl-lbl tl-lbl--coral">{go ? '出発の合図 ・ NEXT' : 'NEXT ・ 次の予定'}</p>
        {go && <Pill tone={go.stage === 'relaxed' ? 'good' : go.stage === 'late' ? 'warn' : 'coral'}>{STAGE_LABEL[go.stage]}</Pill>}
        {status && <Pill tone="bad">{status}</Pill>}
      </div>
      <div className="tl-go__main" data-testid="today-go">
        {go ? (
          <>
            <span className="tl-not-pc"><GoRing view={go} size={80} /></span>
            <span className="tl-pc"><GoRing view={go} size={118} top={go.minutesToLeave > 0 ? '出発まで' : null} /></span>
          </>
        ) : (
          <span className="tl-go__clock" aria-hidden="true">{start}</span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {go && leave ? (
            <p className="tl-go__head">
              <span className="tl-not-pc">{`${leave} に出発`}</span>
              <span className="tl-pc">{`${leave} に出れば、ちょうど`}</span>
            </p>
          ) : (
            <p className="tl-go__head">{e.departure_at ? `出発 ${hm(e.departure_at, timeZone)}` : `${start} から`}</p>
          )}
          <h2 id="today-next-title" className="tl-go__sub">
            {`${e.title} ${start}着`}<span className="tl-pc">{travel ? ` ・ ${travel.replace('（概算）', '')}` : ''}</span>
          </h2>
          {travel && <p className="tl-go__note tl-not-pc">{travel}</p>}
          {go?.estimated && <p className="tl-go__note tl-pc">移動時間は直線距離からの概算です</p>}
          {go?.stage === 'late' && go.expectedArrivalMs != null && (
            <p className="tl-go__note">{`${hm(new Date(go.expectedArrivalMs).toISOString(), timeZone)} 着の見込み`}</p>
          )}
        </div>
      </div>
      {go && (
        <ol className="tl-go__stages tl-pc" aria-label="出発までの段階">
          {STAGE_ORDER.map((s) => <li key={s} aria-current={s === go.stage ? 'step' : undefined}>{STAGE_LABEL[s]}</li>)}
        </ol>
      )}
      <div className="tl-actions">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--coral" onClick={() => ctx.open('go')}>
          <Navigation size={16} aria-hidden="true" />案内を開く
        </button>
        <button type="button" className="tc-focus-ring tl-btn tl-sp" onClick={() => ctx.open('place', e.id)}>次の場所を見る</button>
        {hasBooking && (
          <button type="button" className="tc-focus-ring tl-btn tl-not-sp" onClick={() => ctx.open('ticket', e.id)}>予約を確認</button>
        )}
        <button type="button" className="tc-focus-ring tl-btn tl-pc" onClick={onShareEta} disabled={ctx.stale}>同行者に到着予定を送る</button>
      </div>
    </section>
  );
};

// ---- 次の場所のチラ見せ ----------------------------------------------------------------------------------------------

export const TeaserCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const e = ctx.nextEv;
  const g: GuideEvent | undefined = e ? ctx.gEvents[e.id] : undefined;
  const img = useTeaserImage(ctx.planId, e?.title ?? '', g?.image_memory_id ?? null);
  if (!e) return null;
  const h = hoursLabel(g?.hours?.status, g?.hours?.minutes_to_close);
  const b = bookingPill(ctx, e);
  const sky = arriveSky(ctx, e);
  const endIso = e.end_at ?? g?.end_at ?? null;
  const stay = endIso && e.start_at ? Math.round((Date.parse(endIso) - Date.parse(e.start_at)) / 60_000) : null;
  const memoLine = [g?.entrance_note ? `入口メモ：${g.entrance_note}` : null,
    g?.memo ? `自分で書いた見どころ「${g.memo}」` : null].filter(Boolean).join('。');
  return (
    <section className="tl-card tl-teaser" aria-labelledby="today-teaser-title" data-testid="today-teaser">
      <button type="button" className="tc-focus-ring tl-teaser__open" onClick={() => ctx.open('place', e.id)}
        aria-label={`${e.title}の詳しい情報を開く`} />
      <div className="tl-teaser__img">
        {img ? <img src={img.url} alt={`${e.title}の画像`} loading="lazy" /> : <TeaserArt type={e.event_type} />}
        {img?.credit && <span className="tl-teaser__credit tl-pc">
          {img.href ? '代表画像（Wikipediaから・出典を表示）' : img.credit}
        </span>}
      </div>
      <div className="tl-teaser__body">
        <p className="tl-lbl"><span className="tl-not-tab">次の場所のチラ見せ</span><span className="tl-tab">次の場所</span></p>
        <h2 id="today-teaser-title" className="tl-title">{e.title}</h2>
        <div className="tl-pills">
          {h && <Pill tone={h.tone}>{h.tone === 'good' ? <><span>営業中</span><span className="tl-pc"> ・ 閉店まで十分</span></> : h.text}</Pill>}
          {b && <Pill tone={b.tone}>{b.text}</Pill>}
          {sky && <Pill tone={sky.rainy ? 'info' : 'mute'}><span className="tl-pc">着く頃 </span>{sky.text}</Pill>}
          {stay != null && stay > 0 && stay < 24 * 60 && (
            <span className="tl-pc"><Pill>{`滞在 ${stay}分${g?.end_estimated ? '(目安)' : ''}`}</Pill></span>
          )}
          {g?.phone && safeTelHref(g.phone) && (
            <a className="tc-focus-ring tl-pill tl-pill--link" href={safeTelHref(g.phone) ?? undefined}>電話<span className="sr-only">{` ${g.phone}`}</span></a>
          )}
        </div>
        {memoLine && <p className="tl-teaser__memo tl-pc">{memoLine}</p>}
      </div>
    </section>
  );
};

// ---- 空模様の時刻の線(PC)・雨の兆し(スマホ・タブレット) --------------------------------------------------------

export const SkyCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { hours, events, timeZone } = ctx;
  const startHours = events.map((e) => Number((localHm(e.start_at, timeZone) ?? '').slice(0, 2))).filter((n) => !Number.isNaN(n));
  const from = Math.max(0, Math.min(9, ...(startHours.length ? startHours : [9])));
  const to = Math.min(23, Math.max(19, ...(startHours.length ? startHours : [19])));
  const shown = hours.filter((h) => h.hour >= from && h.hour <= to);
  if (shown.length === 0) return null;
  const rain = ctx.upcomingRain;
  const cols = { gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` };
  return (
    <section className="tl-card" aria-labelledby="today-sky-title" data-testid="today-sky">
      <div className="tl-row">
        <h2 id="today-sky-title" className="tl-lbl">空模様の時刻の線</h2>
        <span className="tl-mute tl-small">{`1時間ごとの降水確率（${ctx.sky?.source ?? 'Open-Meteo'}）`}</span>
      </div>
      <div className="tl-sky__bars" style={cols} role="list" aria-label="1時間ごとの降水確率">
        {shown.map((h) => (
          <div key={h.hour} role="listitem" className="tl-sky__bar" aria-label={`${h.hour}時 ${h.probability ?? '不明'}%${h.rainy ? ' 雨' : ''}`}
            data-rain={h.rainy ? 'true' : undefined} data-now={h.hour === ctx.nowHour ? 'true' : undefined}
            style={{ height: `${Math.max(6, h.probability ?? 0)}%` }} />
        ))}
      </div>
      <div className="tl-sky__hours" style={cols} aria-hidden="true">{shown.map((h) => <span key={h.hour}>{h.hour}</span>)}</div>
      {rain && (
        <div className="tl-sky__notice" role="note">
          <CloudRain size={22} aria-hidden="true" />
          <p><b>{`${hm(rain.start_at, timeZone)} ${rain.title}（屋外）が雨の時間にかかります。`}</b>
            {ctx.sky?.hasRainVariant ? '控えの案に切り替えられます。' : '屋内の案を作れます。'}</p>
          <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('rain')}>プランBを見る</button>
        </div>
      )}
    </section>
  );
};

export const RainCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const w = rainWindow(ctx.hours, ctx.nowHour);
  const rain = ctx.upcomingRain;
  if (!w || !rain) return null;
  return (
    <section className="tl-card tl-card--rain tl-inline" aria-label="雨の兆し" data-testid="today-rain">
      <CloudRain size={28} aria-hidden="true" className="tl-rain__icon" />
      <p className="tl-inline__text"><b>{`${w.start}〜${w.end}時 雨 ${w.max}%`}</b><br />
        {`${hm(rain.start_at, ctx.timeZone)} ${rain.title}（屋外）にかかります`}</p>
      <button type="button" className="tc-focus-ring tl-btn tl-btn--rain" onClick={() => ctx.open('rain')}>
        <span className="tl-not-tab">プランB</span><span className="tl-tab">プランBを見る</span>
      </button>
    </section>
  );
};

// ---- 地図(カード) ------------------------------------------------------------------------------------------------

export const MapCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const placed = ctx.events.some((e) => e.latitude != null && e.longitude != null);
  if (!placed) return null;
  return (
    <section className="tl-card tl-mapcard" aria-labelledby="today-mapcard-title" data-testid="today-map">
      <div className="tl-mapcard__head tl-pc">
        <h2 id="today-mapcard-title" className="tl-lbl">当日の地図</h2><span className="tl-mute tl-small">旅程と連動</span>
      </div>
      <h2 className="sr-only tl-not-pc">当日の地図</h2>
      <div className="tl-mapcard__canvas">
        <Suspense fallback={<div className="tl-map-loading" aria-busy="true">地図を読み込み中…</div>}>
          <TodayMap ctx={ctx} variant="card" onSelect={(id) => ctx.open('map', id)} />
        </Suspense>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--float" onClick={() => ctx.open('map')}>
          <MapIcon size={15} aria-hidden="true" /><span className="tl-not-pc">地図を開く</span><span className="tl-pc">拡大</span>
        </button>
      </div>
      <div className="tl-legend">
        <span><b className="tl-c-coral">━</b> 今日の足跡</span>
        <span><b className="tl-c-teal">┅</b> この後<span className="tl-not-sp">の道のり</span></span>
        {ctx.rainIds.size > 0 && <span className="tl-not-pc"><b className="tl-c-blue">○</b> 雨の時間</span>}
        {ctx.detourPins.length > 0 && <span className="tl-pc"><b className="tl-c-gold">＋</b> 寄り道の候補</span>}
      </div>
    </section>
  );
};

// ---- NOW ------------------------------------------------------------------------------------------------------------

export const NowCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const e = ctx.nowEv;
  if (!e) return null;
  const p = ctx.flow?.nowProgress ?? null;
  const visited = ctx.visitedIds.has(e.id);
  const end = e.end_at ?? ctx.gEvents[e.id]?.end_at ?? null;
  return (
    <section className="tl-card tl-now" aria-labelledby="today-now-title" data-testid="today-now">
      <div className="tl-now__sp">
        <Seal title={e.title} id={e.id} eventType={e.event_type} size={44} state={visited ? 'done' : 'ready'} label="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="tl-lbl">
            <span className="tl-not-pc">{`NOW${p ? ` ・ 残り${p.minutesLeft}分` : ''}`}</span>
            <span className="tl-pc">{`NOW ・ いま ${hm(e.start_at, ctx.timeZone)}${end ? `〜${hm(end, ctx.timeZone)}` : ''}`}</span>
          </p>
          <h2 id="today-now-title" className="tl-now__title">{e.title}</h2>
          {p && (
            <div className="tl-now__prog tl-pc">
              <span>{`残り ${p.minutesLeft}分`}</span><span>{`${p.percent}%`}</span>
            </div>
          )}
          {p && (
            <div className="tl-bar tl-pc" role="progressbar" aria-label="今の予定の進み" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={p.percent}><span style={{ width: `${p.percent}%` }} /></div>
          )}
          {p && <span className="sr-only tl-not-pc">{`残り ${p.minutesLeft}分`}</span>}
        </div>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--pri tl-not-pc" onClick={() => ctx.open('stamp', e.id)}>
          {visited ? '旅帖に綴じる' : '印を押す'}
        </button>
      </div>
      <div className="tl-now__stamp tl-pc">
        <Seal title={e.title} id={e.id} eventType={e.event_type} size={52} state={visited ? 'done' : 'ready'} label="" />
        <p><b>{visited ? '旅帖に印を押しました' : 'ここで旅帖に印を押せます'}</b><br />写真とひとことを残すと、ページに綴じられます</p>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={() => ctx.open('stamp', e.id)}>
          {visited ? '旅帖に綴じる' : '印を押す'}
        </button>
      </div>
    </section>
  );
};

// ---- 寄り道チャンス ----------------------------------------------------------------------------------------------

export const DetourCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const gap = ctx.gap;
  const [items, setItems] = useState<DetourCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!gap || ctx.stale) return null;
  const range = `${hm(gap.start_at, ctx.timeZone)}〜${hm(gap.end_at, ctx.timeZone)} に${gap.minutes}分の空き`;
  const search = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await findDetours(ctx.planId, { after_event_id: gap.after_event_id, before_event_id: gap.before_event_id, kind: 'all' });
      setItems(r.candidates);
      setMsg(r.message);
      ctx.setDetourPins(r.candidates);
    } catch (e) {
      setItems([]);
      setMsg(errorDetailMessage(e, '寄り道の候補を探せませんでした'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="tl-card tl-card--sand tl-detour" aria-labelledby="today-detour-title" data-testid="today-detour">
      <div className="tl-inline">
        <Coffee size={24} aria-hidden="true" className="tl-c-gold" />
        <p className="tl-inline__text"><b id="today-detour-title">寄り道チャンス</b><br />{range}</p>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--sand tl-not-pc" onClick={() => ctx.open('detour')}>見る</button>
      </div>
      <div className="tl-pc">
        {items == null ? (
          <div className="tl-actions">
            <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" disabled={busy} onClick={() => void search()}>
              {busy ? '探しています…' : '近くの候補を探す'}
            </button>
            <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('detour')}>種類を選んで探す</button>
          </div>
        ) : (
          <ul className="tl-detour__list">
            {items.slice(0, 3).map((c, i) => (
              <li key={`${c.name}-${i}`}>
                <span className="tl-pin tl-pin--detour" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{c.name}</b>
                  <p className="tl-mute tl-small">
                    {[c.distance_km != null ? `経路から ${Math.round(c.distance_km * 1000)}m` : null, c.fit === 'indoor' ? '屋内' : null,
                      c.genre_label].filter(Boolean).join(' ・ ')}
                  </p>
                </div>
                <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('detour', `pick:${i}`)}>旅程に足す</button>
              </li>
            ))}
          </ul>
        )}
        {msg && <p className="tl-mute tl-small" role="status">{msg}</p>}
      </div>
    </section>
  );
};

// ---- 同行者の到着予定 --------------------------------------------------------------------------------------------



export const Face: React.FC<{ label: string; self?: boolean; size?: number; tone?: number }> = ({ label, self, size = 30, tone = 0 }) => (
  <span className="tl-face" data-self={self ? 'true' : undefined} data-tone={tone % 3} aria-hidden="true"
    style={{ width: size, height: size }}>{[...label][0]}</span>
);

export const CrewCard: React.FC<{ ctx: TodayCtx; crew: ReturnType<typeof useCrew> }> = ({ ctx, crew }) => {
  const list = (crew.shares ?? []).filter((s) => !s.is_self);
  const mine = (crew.shares ?? []).find((s) => s.is_self) ?? null;
  if (ctx.stale && !crew.shares) return null;
  return (
    <section className="tl-card" aria-labelledby="today-crew-title" data-testid="today-crew">
      <div className="tl-row">
        <h2 id="today-crew-title" className="tl-lbl">同行者の到着予定</h2>
        <button type="button" className="tc-focus-ring tl-link tl-not-pc" onClick={() => ctx.open('crew')}>すべて</button>
      </div>
      {list.length === 0 ? (
        <p className="tl-mute tl-small">まだ誰も到着予定を共有していません。</p>
      ) : (
        <>
          <ul className="tl-crew-mini tl-not-pc">
            {list.slice(0, 3).map((s, i) => (
              <li key={s.user_id}><Face label={s.label} tone={i} />
                <span>{`${hm(s.arrive_at, ctx.timeZone)} `}{s.delay_minutes != null && s.delay_minutes > 0
                  ? <b className="tl-c-warn">{`${s.delay_minutes}分遅れ`}</b> : '予定どおり'}</span></li>
            ))}
          </ul>
          <ul className="tl-crew-list tl-pc">
            {list.map((s, i) => (
              <li key={s.user_id}>
                <Face label={s.label} tone={i} size={34} />
                <span style={{ flex: 1, minWidth: 0 }}><b>{s.label}</b><br /><span className="tl-mute tl-small">{`${hm(s.arrive_at, ctx.timeZone)} 着予定`}</span></span>
                {s.delay_minutes != null && s.delay_minutes > 0
                  ? <Pill tone="warn">{`${s.delay_minutes}分遅れ`}</Pill> : <Pill tone="good">予定どおり</Pill>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="tl-mute tl-small tl-pc">
        {`位置ではなく到着予定だけを共有（${mine ? `今日 ${hm(mine.until, ctx.timeZone)} まで` : `最長${crew.maxHours}時間`}）`}
      </p>
      <div className="tl-actions tl-pc">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('crew')}>同行者の画面へ</button>
      </div>
    </section>
  );
};

// ---- 旅帖(小) ------------------------------------------------------------------------------------------------------

export const TabichoCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { events } = ctx;
  const pressed = events.filter((e) => ctx.visitedIds.has(e.id)).length;
  return (
    <section className="tl-card tl-card--paper" aria-labelledby="today-tabicho-title" data-testid="today-tabicho">
      <div className="tl-row">
        <h2 id="today-tabicho-title" className="tl-title tl-title--sm">今日の旅帖</h2>
        <span className="tl-mute tl-small">{`${pressed} / ${events.length}`}<span className="tl-not-sp"> 押印</span></span>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--sm tl-pc" onClick={() => ctx.open('tabicho')}>旅帖を開く</button>
      </div>
      <ul className="tl-seals">
        {events.map((e) => {
          const st = ctx.visitedIds.has(e.id) ? 'done' : e.id === ctx.nowEv?.id ? 'ready' : 'empty';
          return (
            <li key={e.id}>
              <button type="button" className="tc-focus-ring" onClick={() => ctx.open(st === 'empty' ? 'tabicho' : 'stamp', e.id)}
                aria-label={`${e.title}(${st === 'done' ? '印を押した' : st === 'ready' ? 'ここで印を押せます' : 'まだ'})`}>
                <Seal title={e.title} id={e.id} eventType={e.event_type} size={44} state={st} label="" />
              </button>
              <span className="tl-pc">{st === 'done' ? `${sealGlyph(e.title, e.event_type)} ${hm(e.start_at, ctx.timeZone)}`
                : st === 'ready' ? '押せます' : hm(e.start_at, ctx.timeZone)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// ---- お助け(PC のカード) ----------------------------------------------------------------------------------------

export const HelpCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const navigate = useNavigate();
  const rows: [React.ReactNode, string, () => void][] = [
    [<AlertTriangle size={18} key="a" />, '遅延・休業に対応', () => ctx.open('delay')],
    [<CloudRain size={18} key="b" />, 'プランBに切り替え', () => ctx.open('rain')],
    [<QrCode size={18} key="c" />, 'チケットのQR', () => ctx.open('ticket')],
    [<Wallet size={18} key="d" />, '立替を入れる', () => navigate(`/planner/${ctx.planId}/expenses`)],
    [<Languages size={18} key="e" />, '翻訳を開く', () => window.open(safeExternalUrl('https://translate.google.com/') ?? undefined, '_blank', 'noopener,noreferrer')],
    [<Home size={18} key="f" />, '宿へ帰る道', () => ctx.open('home')],
  ];
  return (
    <section className="tl-card tl-helpcard tl-pc" aria-labelledby="today-helpcard-title">
      <h2 id="today-helpcard-title" className="tl-title tl-title--sm">お助け（困った時はここ）</h2>
      <div className="tl-helpcard__grid">
        {rows.map(([icon, label, fn]) => (
          <button key={label} type="button" className="tc-focus-ring tl-btn" onClick={fn}>
            <span aria-hidden="true">{icon}</span>{label}
          </button>
        ))}
      </div>
      <p className="tl-mute tl-small">通信が切れても、今日の予定・チケット・宿の情報は保存済みのものを表示します</p>
    </section>
  );
};

// ---- 下の操作(スマホ・タブレット) -------------------------------------------------------------------------------

export const TodayDock: React.FC<{ ctx: TodayCtx; current: TodayScreen | 'today' }> = ({ ctx, current }) => {
  const tabs: [TodayScreen | 'today', string, React.ReactNode][] = [
    ['today', '今日', <CalendarDays size={20} key="t" />], ['map', '地図', <MapIcon size={20} key="m" />],
    ['tabicho', '旅帖', <BookOpen size={20} key="b" />], ['timeline', '旅程', <ListOrdered size={20} key="l" />],
  ];
  const target = ctx.nowEv ?? ctx.nextEv;
  return (
    <div className="tl-dock" data-current={current}>
      <nav aria-label="当日の操作" className="tl-dock__acts">
        <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={() => ctx.open('memo', target?.id ?? null)}>
          <Camera size={18} aria-hidden="true" /><span className="tl-not-tab">写真・ひとこと</span><span className="tl-tab">印を押す・ひとこと</span>
        </button>
        <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('help')}>
          <LifeBuoy size={18} aria-hidden="true" />お助け
        </button>
        <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('ticket')}>
          <Ticket size={18} aria-hidden="true" /><span className="tl-not-tab">チケット</span><span className="tl-tab">チケットQR</span>
        </button>
      </nav>
      <nav aria-label="当日の画面" className="tl-dock__tabs">
        {tabs.map(([key, label, icon]) => (
          <button key={key} type="button" className="tc-focus-ring tl-tab-btn" aria-current={current === key ? 'page' : undefined}
            onClick={() => (key === 'today' ? ctx.close() : ctx.open(key as TodayScreen))}>
            <span aria-hidden="true">{icon}</span>{label}
          </button>
        ))}
      </nav>
    </div>
  );
};



/** 1時間ごとの雨の棒(雨の兆しの画面・朝) */
export const RainBars: React.FC<{ hours: SkyHour[]; from: number; count: number }> = ({ hours, from, count }) => {
  const shown = Array.from({ length: count }, (_, i) => from + i).filter((h) => h <= 23)
    .map((h) => hours.find((x) => x.hour === h) ?? { hour: h, probability: null, rainy: false });
  return (
    <div className="tl-rainbars" role="list" aria-label="1時間ごとの降水確率">
      {shown.map((h) => (
        <div key={h.hour} role="listitem" aria-label={`${h.hour}時 ${h.probability ?? '不明'}%${h.rainy ? ' 雨' : ''}`}>
          <span className="tl-rainbars__bar" data-rain={h.rainy ? 'true' : undefined} style={{ height: `${Math.max(6, h.probability ?? 0)}%` }} />
          <span className="tl-rainbars__h" aria-hidden="true">{h.hour}</span>
        </div>
      ))}
    </div>
  );
};

