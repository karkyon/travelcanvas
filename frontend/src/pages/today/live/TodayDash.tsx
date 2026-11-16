/**
 * [Gate TDay-Mock → TDay-Live2] 旅の当日「今日」の画面のカード。
 *
 * 上半分(ライブ帯・判断カード・変化の知らせ・今日の流れ・下の操作)は TodayTop.tsx。ここは下半分のカード
 * (次の場所のチラ見せ・地図・空模様・寄り道・同行者・今日の旅帖)。
 * スマホ(〜639px)は 1 列、タブレット縦(640〜1023px)は 2 列、タブレット横(1024〜1279px)は左 420px + 地図、
 * PC(1280px〜)は左 452px + 大きな地図。同じカードを 1 回だけ描き、並びは CSS(today-mock.css)で変える。
 * 状態は色だけで伝えない(必ず文字)。
 */
import React, { Suspense, useState } from 'react';
import { CloudRain, Coffee, Map as MapIcon } from 'lucide-react';
import { findDetours, type DetourCandidate } from '@/services/api/travelDay';
import { safeTelHref } from '@/utils/safeNavigation';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { formatTimeInZone } from '../todayModel';
import { hoursLabel, localHm, type SkyHour } from './todayLive';
import { JourneyThread } from './LivePieces';
import { TeaserArt } from './LiveCards';
import { useTeaserImage } from './useTeaserImage';
import type { TodayCtx } from './todayCtx';
import { arriveSky, bookingPill, type useCrew } from './todayHelpers';
import type { GuideEvent } from '@/services/api/travelDay';
import { GoRing, Pill, SkyStrip, SpotOverlay, TodayDock } from './TodayTop';
import { overlayWidth } from './todaySource';

export { GoRing, Pill, TodayDock };

const TodayMap = React.lazy(() => import('./TodayMap'));

const hm = (iso: string | null | undefined, tz: string | null) => formatTimeInZone(iso ?? null, tz);

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
          {img.href ? '代表画像（出典：Wikipedia）' : img.credit}
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
        {g?.hours && (
          <p className="tl-teaser__src tl-mute">
            {`営業時間：${g.hours.estimated ? '推定' : '旅程の値と照合'}${g.hours.window_label ? `（${g.hours.window_label}）` : ''}${g.hours.stale ? '・古い可能性' : ''} ・ 臨時休業は未確認`}
          </p>
        )}
        {memoLine && <p className="tl-teaser__memo tl-pc">{memoLine}</p>}
      </div>
    </section>
  );
};


// ---- 空模様の時刻の線(スマホ・タブレット縦) ---------------------------------------------------------------------

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

// ---- 地図(カード)。タブレット・PC は選んだ場所を地図の上に重ねる(右に固定の欄は置かない) ---------------------

export const MapCard: React.FC<{ ctx: TodayCtx; selectedId?: string | null; onSelect?: (id: string) => void; onClear?: () => void }> = ({
  ctx, selectedId = null, onSelect, onClear,
}) => {
  const placed = ctx.events.some((e) => e.latitude != null && e.longitude != null);
  if (!placed) return null;
  const pick = (id: string) => {
    if (onSelect && overlayWidth()) onSelect(id);
    else ctx.open('map', id);
  };
  return (
    <section className="tl-card tl-mapcard" aria-labelledby="today-mapcard-title" data-testid="today-map">
      <div className="tl-mapcard__head tl-not-sp">
        <h2 id="today-mapcard-title" className="tl-lbl">当日の地図</h2><span className="tl-mute tl-small">今日の流れと連動</span>
      </div>
      <h2 className="sr-only tl-sp">当日の地図</h2>
      <div className="tl-mapcard__canvas">
        <Suspense fallback={<div className="tl-map-loading" aria-busy="true">地図を読み込み中…</div>}>
          <TodayMap ctx={ctx} variant="card" selectedId={selectedId} onSelect={pick} />
        </Suspense>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--float" onClick={() => ctx.open('map', selectedId)}>
          <MapIcon size={15} aria-hidden="true" /><span className="tl-sp">地図を開く</span><span className="tl-not-sp">全画面</span>
        </button>
        {selectedId && onClear && (
          <div className="tl-not-sp tl-mapcard__spot"><SpotOverlay ctx={ctx} eventId={selectedId} onClose={onClear} /></div>
        )}
        <div className="tl-ge1024 tl-mapcard__sky"><SkyStrip ctx={ctx} /></div>
      </div>
      <div className="tl-legend">
        <span><b className="tl-c-coral">━</b> 今日の足跡</span>
        <span><b className="tl-c-teal">┅</b> この後<span className="tl-not-sp">の道のり</span></span>
        {ctx.rainIds.size > 0 && <span><b className="tl-c-blue">○</b> 雨の時間</span>}
        {ctx.detourPins.length > 0 && <span><b className="tl-c-gold">＋</b> 寄り道の候補</span>}
        <span className="tl-mute">足跡は位置の記録をONにした時だけ</span>
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
        <p className="tl-inline__text"><b id="today-detour-title">寄り道チャンス</b><br />{range}
          <span className="tl-small tl-mute tl-detour__note"><br />候補は旅程に勝手に入りません。足す前に後の予定への影響を確認します。</span></p>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--sand tl-not-pc" onClick={() => ctx.open('detour')}>候補を探す</button>
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
                      c.genre_label, '候補 ・ 営業は未確認'].filter(Boolean).join(' ・ ')}
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

export const CrewCard: React.FC<{ ctx: TodayCtx; crew: ReturnType<typeof useCrew>; onShareEta?: () => void }> = ({ ctx, crew, onShareEta }) => {
  const list = (crew.shares ?? []).filter((s) => !s.is_self);
  const mine = (crew.shares ?? []).find((s) => s.is_self) ?? null;
  if (ctx.stale && !crew.shares) return null;
  return (
    <section className="tl-card" aria-labelledby="today-crew-title" data-testid="today-crew">
      <div className="tl-row">
        <h2 id="today-crew-title" className="tl-lbl">同行者の到着予定</h2>
        <Pill tone="good">位置は共有しない</Pill>
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
      <p className="tl-mute tl-small">
        {`到着の時刻だけを共有（${mine ? `自分の共有は ${hm(mine.until, ctx.timeZone)} まで` : `最長${crew.maxHours}時間で自動で消えます`}）・ いつでも止められます`}
      </p>
      <div className="tl-actions">
        {onShareEta && ctx.nextEv && (
          <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={onShareEta} disabled={ctx.stale}>到着予定を送る</button>
        )}
        <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('crew')}>共有の設定</button>
      </div>
    </section>
  );
};


// ---- 今日の旅帖(旅の糸と印) ----------------------------------------------------------------------------------------

export const TabichoCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { events } = ctx;
  const pressed = events.filter((e) => ctx.visitedIds.has(e.id)).length;
  const photos = Object.values(ctx.stamps).reduce((n, s) => n + (s.photo_count ?? 0), 0);
  return (
    <section className="tl-card tl-card--paper" aria-labelledby="today-tabicho-title" data-testid="today-tabicho">
      <div className="tl-row">
        <h2 id="today-tabicho-title" className="tl-title tl-title--sm">今日の旅帖</h2>
        <span className="tl-mute tl-small">{`${pressed} / ${events.length} 押印`}</span>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('tabicho')}>開く</button>
      </div>
      {events.length > 0 && (
        <div className="tl-tabicho__thread">
          <JourneyThread events={events} timeZone={ctx.timeZone} nowId={ctx.nowEv?.id ?? null} nextId={ctx.nextEv?.id ?? null}
            doneIds={ctx.doneIds} stamps={ctx.stamps} rainIds={ctx.rainIds} />
        </div>
      )}
      <p className="tl-mute tl-small">{`印 ${pressed} ・ 写真 ${photos}${ctx.memoPending > 0 ? ` ・ 送信待ち ${ctx.memoPending}件` : ''} ・ 記録は自分で選んだ相手だけに見せます`}</p>
    </section>
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


