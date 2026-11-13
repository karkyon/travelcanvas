/**
 * [Gate TDay-Mock] 動く時の画面: 出発の合図(Mobile-GoNow)・移動モード(Mobile-Transit)・次の場所(Mobile-Place)・
 * 宿の到着ガイド(Mobile-Checkin)・宿へ帰る(Mobile-HomeRoute)。
 */
import React, { Suspense, useEffect, useState } from 'react';
import { Navigation, Phone, Ticket as TicketIcon, Send, AlertTriangle } from 'lucide-react';
import { safeExternalUrl, safeTelHref } from '@/utils/safeNavigation';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { formatTimeInZone } from '../todayModel';
import {
  STAGE_LABEL, STAGE_ORDER, distanceKm, goScreenText, hoursLabel, noteLines, speak,
} from './todayLive';
import { GoRing } from './TodayDash';
import { arriveSky, bookingPill, homeRoute, openGuide, shareMyEta, travelShort } from './todayHelpers';
import { TeaserArt } from './LiveCards';
import { useTeaserImage } from './useTeaserImage';
import ScreenFrame from './ScreenFrame';
import TransitTime from './TransitTime';
import type { TodayCtx } from './todayCtx';

const TodayMap = React.lazy(() => import('./TodayMap'));
const hm = (iso: string | null | undefined, tz: string | null) => formatTimeInZone(iso ?? null, tz);

// ---- 出発の合図 -----------------------------------------------------------------------------------------------------

export const GoNowScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { go, nextEv: e, timeZone } = ctx;
  if (!e) return <EmptyScreen ctx={ctx} title="出発の合図" text="今日、これから向かう予定はありません。" />;
  const start = hm(e.start_at, timeZone);
  const travel = travelShort(ctx, e);
  const hasBooking = !!(ctx.guide?.bookings?.[e.id] || e.reservation_id || e.has_ticket);
  if (!go) {
    return (
      <ScreenFrame title="出発の合図" onClose={ctx.close} tone="relaxed" testId="today-gonow"
        right={<span className="tl-mute tl-small">{`現地 ${ctx.nowLocal ?? ''}`}</span>}>
        <div className="tl-gonow">
          <h3 className="tl-gonow__head">{`${start} ${e.title}`}</h3>
          <p className="tl-gonow__sub">出る時刻はまだ分かりません。移動の時間を入れると、出る時刻をお知らせします。</p>
          {!ctx.stale && (
            <TransitTime planId={ctx.planId} next={e} guide={ctx.gEvents[e.id]}
              from={ctx.events.find((x) => x.id === ctx.gEvents[e.id]?.from_event_id) ?? null}
              localDate={ctx.data.today_date} timeZone={timeZone} onSaved={ctx.refresh} />
          )}
        </div>
      </ScreenFrame>
    );
  }
  const leave = hm(go.leaveBy, timeZone);
  const expected = go.expectedArrivalMs != null ? hm(new Date(go.expectedArrivalMs).toISOString(), timeZone) : null;
  const t = goScreenText(go, leave, start, expected);
  const primary = () => {
    if (go.stage === 'relaxed') ctx.close();
    else if (go.stage === 'soon') { openGuide(e); ctx.open('transit'); } else if (go.stage === 'now') ctx.open('transit');
    else ctx.open('delay');
  };
  return (
    <ScreenFrame title="出発の合図" onClose={ctx.close} tone={go.stage} testId="today-gonow"
      right={<span className="tl-mute tl-small">{`現地 ${ctx.nowLocal ?? ''}`}</span>}
      footer={(
        <>
          <ol className="tl-stage-row" aria-label="出発までの段階">
            {STAGE_ORDER.map((s) => <li key={s} data-stage={s} aria-current={s === go.stage ? 'step' : undefined}>{STAGE_LABEL[s]}</li>)}
          </ol>
          <div className="tl-actions tl-actions--fill">
            <button type="button" className="tc-focus-ring tl-btn tl-btn--stage" data-stage={go.stage} style={{ flex: 2 }} onClick={primary}>{t.primary}</button>
            {hasBooking && <button type="button" className="tc-focus-ring tl-btn" style={{ flex: 1 }} onClick={() => ctx.open('ticket', e.id)}>予約を確認</button>}
          </div>
        </>
      )}>
      <div className="tl-gonow">
        <p className="tl-gonow__stage" data-stage={go.stage}>{`段階：${STAGE_LABEL[go.stage]}`}</p>
        <GoRing view={go} size={240} top={t.ringTop} big={t.big} />
        <h3 className="tl-gonow__head">{t.head}</h3>
        <p className="tl-gonow__sub">{`${e.title} ${start}着${travel ? ` ・ ${travel.replace('（概算）', '')}` : ''}`}</p>
        {go.estimated && <p className="tl-mute tl-small">移動時間は直線距離からの概算です</p>}
        <div className="tl-gonow__advice">{t.advice}</div>
        {!ctx.stale && (
          <div className="tl-gonow__transit">
            <TransitTime planId={ctx.planId} next={e} guide={ctx.gEvents[e.id]}
              from={ctx.events.find((x) => x.id === ctx.gEvents[e.id]?.from_event_id) ?? null}
              localDate={ctx.data.today_date} timeZone={timeZone} onSaved={ctx.refresh} />
          </div>
        )}
      </div>
    </ScreenFrame>
  );
};

// ---- 移動モード -----------------------------------------------------------------------------------------------------

export const TransitScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { nextEv: e, go, nowMs, timeZone, settings } = ctx;
  const [spoken, setSpoken] = useState(false);
  const g = e ? ctx.gEvents[e.id] : undefined;
  const startMs = e?.start_at ? Date.parse(e.start_at) : NaN;
  const leaveMs = go ? Date.parse(go.leaveBy) : NaN;
  const arriveMs = go?.expectedArrivalMs ?? (Number.isNaN(startMs) ? null : startMs);
  const left = arriveMs != null ? Math.max(0, Math.ceil((arriveMs - nowMs) / 60_000)) : null;
  const lines = noteLines(g?.entrance_note, g?.place_note);
  useEffect(() => {
    if (e && settings.voice && left === 0 && !spoken) {
      speak(`${e.title}に着く時刻です。${lines.join('。')}`);
      setSpoken(true);
    }
  }, [settings.voice, left, spoken, e, lines]);
  if (!e) return <EmptyScreen ctx={ctx} title="移動モード" text="これから向かう予定はありません。" />;
  const total = !Number.isNaN(leaveMs) && arriveMs != null ? Math.max(1, (arriveMs - leaveMs) / 60_000) : null;
  const progress = total != null && left != null ? Math.max(0, Math.min(100, Math.round((1 - left / total) * 100))) : null;
  const from = ctx.events.find((x) => x.id === g?.from_event_id) ?? ctx.nowEv;
  const km = from ? distanceKm(from, e) : g?.distance_km ?? null;
  const restM = km != null && progress != null ? Math.max(0, Math.round((km * 1.3 * (1 - progress / 100)) * 1000 / 50) * 50) : null;
  const late = go?.stage === 'late';
  return (
    <ScreenFrame title={`移動モード ・ ${(travelShort(ctx, e) ?? '移動').split(' ')[0]}`} onClose={ctx.close} closeIcon="x" closeLabel="終える"
      tone="transit" testId="today-transit"
      footer={(
        <div className="tl-actions tl-actions--fill">
          <button type="button" className="tc-focus-ring tl-btn tl-btn--gold" onClick={() => openGuide(e)}>
            <Navigation size={18} aria-hidden="true" />外の地図で案内
          </button>
          <button type="button" className="tc-focus-ring tl-btn tl-btn--ghost" onClick={() => ctx.open('delay')}>
            <AlertTriangle size={18} aria-hidden="true" />遅れを知らせる
          </button>
        </div>
      )}>
      <div className="tl-transit">
        <p className="tl-transit__muted">{`${e.title}まで`}</p>
        <p className="tl-transit__big">{left == null ? '—' : left === 0 ? '到着の時刻' : `あと${left}分`}</p>
        <p className="tl-transit__line">
          {arriveMs != null ? `${hm(new Date(arriveMs).toISOString(), timeZone)} 着の見込み` : '到着の時刻は未定'}
          {late ? ' ・ 予定より遅れ気味' : ' ・ 予定どおり'}
        </p>
        {progress != null && (
          <>
            <div className="tl-transit__bar" role="progressbar" aria-label="道のりの進み" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
            <div className="tl-transit__ends">
              <span>{from?.title ?? '出発'}</span>
              <span>{restM != null ? `残り 約${restM}m（概算）` : go?.estimated ? '概算' : ''}</span>
            </div>
          </>
        )}
        {lines.length > 0 && (
          <section className="tl-transit__box" aria-labelledby="tl-transit-note">
            <h3 id="tl-transit-note" className="tl-lbl tl-lbl--mint">着いたら（入口メモ）</h3>
            <ol>{lines.map((l) => <li key={l}>{l}</li>)}</ol>
          </section>
        )}
        <div className="tl-transit__box tl-row">
          <span style={{ flex: 1 }}>着いたら、この場所のメモを読み上げます</span>
          <button type="button" role="switch" aria-checked={settings.voice} aria-label="着いたら読み上げる"
            className="tc-focus-ring tl-switch" onClick={() => ctx.setSettings({ ...settings, voice: !settings.voice })}>
            {settings.voice ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </ScreenFrame>
  );
};

// ---- 次の場所 -------------------------------------------------------------------------------------------------------

export const PlaceScreen: React.FC<{ ctx: TodayCtx; eventId: string | null }> = ({ ctx, eventId }) => {
  const e = ctx.events.find((x) => x.id === eventId) ?? ctx.nextEv ?? ctx.nowEv;
  const g = e ? ctx.gEvents[e.id] : undefined;
  const img = useTeaserImage(ctx.planId, e?.title ?? '', g?.image_memory_id ?? null);
  if (!e) return <EmptyScreen ctx={ctx} title="次の場所" text="今日の予定がありません。" />;
  const tz = ctx.timeZone;
  const end = e.end_at ?? g?.end_at ?? null;
  const state = e.id === ctx.nextEv?.id ? 'NEXT' : e.id === ctx.nowEv?.id ? 'NOW' : ctx.visitedIds.has(e.id) || ctx.doneIds.has(e.id) ? '済' : 'この後';
  const go = e.id === ctx.nextEv?.id ? ctx.go : null;
  const h = hoursLabel(g?.hours?.status, g?.hours?.minutes_to_close);
  const sky = arriveSky(ctx, e);
  const b = bookingPill(ctx, e);
  const booking = ctx.guide?.bookings?.[e.id];
  const phone = g?.phone && safeTelHref(g.phone) ? g.phone : null;
  return (
    <ScreenFrame title={e.title} hideTitle onClose={ctx.close} testId="today-place"
      footer={(
        <div className="tl-actions tl-actions--fill">
          <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" style={{ flex: 2 }} onClick={() => openGuide(e)}>
            <Navigation size={18} aria-hidden="true" />ここへ案内
          </button>
          {phone && <a className="tc-focus-ring tl-btn" style={{ flex: 1 }} href={safeTelHref(phone) ?? undefined}>
            <Phone size={18} aria-hidden="true" />電話</a>}
        </div>
      )}>
      <div className="tl-place__hero">
        {img ? <img src={img.url} alt={`${e.title}の画像`} /> : <TeaserArt type={e.event_type} />}
        {img?.credit && (img.href && safeExternalUrl(img.href)
          ? <a className="tl-place__credit" href={safeExternalUrl(img.href) ?? undefined} target="_blank" rel="noopener noreferrer">出典：Wikipedia</a>
          : <span className="tl-place__credit">{img.credit}</span>)}
      </div>
      <div className="tl-pad">
        <p className="tl-lbl">
          {[state, `${hm(e.start_at, tz)}${end ? `〜${hm(end, tz)}` : ''}`,
            go ? (go.minutesToLeave > 0 ? `あと${go.minutesToLeave}分で出発` : STAGE_LABEL[go.stage]) : null].filter(Boolean).join(' ・ ')}
        </p>
        <h3 className="tl-title tl-title--lg">{e.title}</h3>
        {e.address && <p className="tl-mute tl-small">{e.address}</p>}
        <div className="tl-tiles">
          <div><b className={h ? `tl-c-${h.tone}` : ''}>{h?.text ?? '不明'}</b><span>{h?.tone === 'good' ? '滞在の間ずっと' : '営業'}</span></div>
          <div><b>{sky?.text ?? '—'}</b><span>着く頃の天気</span></div>
          <div><b className={b ? `tl-c-${b.tone}` : ''}>{b ? (b.tone === 'warn' ? '要確認' : '予約済み') : 'なし'}</b><span>予約</span></div>
        </div>
        {g?.entrance_note && (
          <section className="tl-card tl-card--flat"><h4 className="tl-lbl">入口・目印（場所のメモ）</h4><p>{g.entrance_note}</p></section>
        )}
        {g?.memo && (
          <section className="tl-card tl-card--flat"><h4 className="tl-lbl">自分の見どころメモ</h4><p>{g.memo}</p></section>
        )}
        {!g?.entrance_note && g?.place_note && (
          <section className="tl-card tl-card--flat"><h4 className="tl-lbl">場所のメモ</h4><p>{g.place_note}</p></section>
        )}
        {(booking || e.reservation_id) && (
          <section className="tl-card tl-card--flat tl-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4 className="tl-lbl">予約</h4>
              {(booking?.reservations ?? []).map((r) => (
                <p key={r.id} style={{ margin: '2px 0 0' }}>
                  {[r.type_label, r.guest_count ? `${r.guest_count}名` : null, r.start ? hm(r.start, tz) : null].filter(Boolean).join(' ')}
                </p>
              ))}
              <p className="tl-mute tl-small">予約番号は予約の画面で表示</p>
            </div>
            <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('ticket', e.id)}>
              <TicketIcon size={16} aria-hidden="true" />予約を見る
            </button>
          </section>
        )}
      </div>
    </ScreenFrame>
  );
};

// ---- 宿の到着ガイド ------------------------------------------------------------------------------------------------

export const CheckinScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const l = ctx.lodging;
  const img = useTeaserImage(ctx.planId, l?.title ?? '', null);
  if (!l) return <EmptyScreen ctx={ctx} title="今日の宿" text="今日の旅程に宿の予定がありません。" />;
  const lines = noteLines(l.entrance_note, l.memo);
  const tomorrow = ctx.guide?.next_day;
  const phone = l.phone && safeTelHref(l.phone) ? l.phone : null;
  return (
    <ScreenFrame title={l.title} hideTitle onClose={ctx.close} testId="today-checkin"
      footer={(
        <div className="tl-actions tl-actions--fill">
          <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" style={{ flex: 2 }} onClick={() => ctx.open('home')}>
            <Navigation size={18} aria-hidden="true" />宿へ案内
          </button>
          {phone && <a className="tc-focus-ring tl-btn" style={{ flex: 1 }} href={safeTelHref(phone) ?? undefined}><Phone size={18} aria-hidden="true" />電話</a>}
        </div>
      )}>
      <div className="tl-place__hero">
        {img ? <img src={img.url} alt={`${l.title}の画像`} /> : <TeaserArt type="accommodation" />}
      </div>
      <div className="tl-pad">
        <p className="tl-lbl">{`今日の宿 ・ ${hm(l.start_at, ctx.timeZone)} 着予定`}</p>
        <h3 className="tl-title tl-title--lg">{l.title}</h3>
        <p className="tl-small">
          {[l.check_in ? `チェックイン ${l.check_in}〜` : null, l.booking === 'booked' ? '予約済み' : l.booking === 'issue' ? '予約 要確認' : null,
            l.nights ? `${l.nights}泊` : null, l.guest_count ? `${l.guest_count}名` : null].filter(Boolean).join(' ・ ')}
        </p>
        <section className="tl-card tl-card--flat">
          <h4 className="tl-lbl">着いたら</h4>
          <ol className="tl-steps">
            {(lines.length ? lines : ['フロントで予約名を伝える（予約番号は予約の画面）']).map((x) => <li key={x}>{x}</li>)}
          </ol>
          {lines.length === 0 && <p className="tl-small tl-mute">宿の入口・目印のメモを旅程に書いておくと、ここに出ます</p>}
        </section>
        <dl className="tl-facts">
          <div><dt>住所</dt><dd>{l.address ?? '未登録'}</dd></div>
          <div><dt>電話</dt><dd>{l.phone ?? '未登録'}</dd></div>
          <div><dt>駐車場</dt><dd>{l.notes ? l.notes : '予約のメモから（未登録）'}</dd></div>
          <div><dt>明日の出発</dt><dd>{tomorrow?.first_event_time ? tomorrow.first_event_time.slice(0, 5) : '未定'}</dd></div>
        </dl>
      </div>
    </ScreenFrame>
  );
};

// ---- 宿へ帰る ------------------------------------------------------------------------------------------------------


export const HomeRouteScreen: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const [me, setMe] = useState<[number, number] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const l = ctx.lodging;
  const r = homeRoute(ctx, me);
  if (!l) return <EmptyScreen ctx={ctx} title="宿へ帰る" text="今日の旅程に宿の予定がありません。" />;
  const arrive = r ? hm(new Date(ctx.nowMs + r.walk * 60_000).toISOString(), ctx.timeZone) : null;
  const phone = l.phone && safeTelHref(l.phone) ? l.phone : null;
  const locate = () => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition((p) => setMe([p.coords.latitude, p.coords.longitude]), () => setMsg('今いる場所を取れませんでした'),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 });
  };
  const send = async () => {
    setMsg(null);
    try {
      if (ctx.lodgingEvent && ctx.nextEv?.id !== ctx.lodgingEvent.id) {
        setMsg('到着予定の共有は、次の予定が宿の時に送れます');
        return;
      }
      await shareMyEta(ctx);
      setMsg('到着予定を同行者に共有しました');
    } catch (e) {
      setMsg(errorDetailMessage(e, '到着予定を送れませんでした'));
    }
  };
  return (
    <ScreenFrame title={`宿へ帰る ・ ${ctx.nowLocal ?? ''}`} onClose={ctx.close} tone="night" testId="today-home"
      footer={(
        <div className="tl-actions tl-actions--fill tl-actions--col">
          <button type="button" className="tc-focus-ring tl-btn tl-btn--gold" onClick={() => openGuide({ ...l, title: l.title })}>
            <Navigation size={18} aria-hidden="true" />外の地図で案内
          </button>
          <div className="tl-actions tl-actions--fill">
            {phone && <a className="tc-focus-ring tl-btn tl-btn--ghost" href={safeTelHref(phone) ?? undefined}><Phone size={18} aria-hidden="true" />宿に電話</a>}
            <button type="button" className="tc-focus-ring tl-btn tl-btn--ghost" onClick={() => void send()} disabled={ctx.stale}>
              <Send size={18} aria-hidden="true" />到着予定を送る
            </button>
          </div>
        </div>
      )}>
      <div className="tl-pad tl-home">
        <p className="tl-transit__muted">{`${l.title}まで`}</p>
        <p className="tl-transit__big">{r ? `徒歩 約${r.walk}分` : '—'}</p>
        <p className="tl-transit__line">{r ? `${arrive} ごろ着（概算）` : '出発する場所が分かりません'}</p>
        {r && (
          <div className="tl-home__map">
            <Suspense fallback={<div className="tl-map-loading" aria-busy="true">地図を読み込み中…</div>}>
              <TodayMap ctx={ctx} variant="route" me={me}
                route={[{ lat: r.from.latitude!, lng: r.from.longitude!, label: '今', state: 'now' },
                  { lat: l.latitude!, lng: l.longitude!, label: '宿', state: 'home' }]} />
            </Suspense>
          </div>
        )}
        <p className="tl-transit__box">
          {`${r ? `${r.from.title}から` : ''}明るい大通りを優先してください。${r ? `タクシーなら 約${r.taxi}分（概算）。` : ''}`}
        </p>
        {!me && <button type="button" className="tc-focus-ring tl-btn tl-btn--ghost" onClick={locate}>今いる場所から測る（送りません）</button>}
        {msg && <p role="status" className="tl-small">{msg}</p>}
        {l.latitude == null && !l.address && <p className="tl-small">宿の場所(座標・住所)が登録されていません</p>}
      </div>
    </ScreenFrame>
  );
};

export const EmptyScreen: React.FC<{ ctx: TodayCtx; title: string; text: string }> = ({ ctx, title, text }) => (
  <ScreenFrame title={title} onClose={ctx.close}>
    <div className="tl-pad"><p>{text}</p>
      <button type="button" className="tc-focus-ring tl-btn tl-btn--pri" onClick={ctx.close}>今日の画面へ</button></div>
  </ScreenFrame>
);

