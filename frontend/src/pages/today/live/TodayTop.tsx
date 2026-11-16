/**
 * [Gate TDay-Live2] 旅の当日「今日」の画面の上半分(改修モックアップ 2026-11-14 どおり)。
 *
 * 開いて数秒で「今・次・何時に出る・変化・次の操作」が分かる順に並べる:
 * 1. ライブ帯: 現地時刻(端末の時刻と違えば併記)・何日目か・情報の新しさ(最新 / 保存済み・何分前)
 * 2. 判断カード: NOW と NEXT を 1 枚に。出る時刻を大きく、段階(余裕あり/そろそろ/今出発/遅れ気味)は文字でも出す。
 *    移動時間の出どころ(実時刻/手入力/登録した移動/概算/不明)を出る時刻のすぐ下に。
 *    主な操作は文脈で(案内を開く・予約がある時だけチケット)。お助けは見出しの右に常に出す
 * 3. 変化の知らせ: 雨・遅延/運休・営業時間・予約の要確認は、起きた時だけカード。無い時は 1 行
 * 4. 今日の流れ(タブレット・PC): 予定を押すと地図で選ぶ。PC・タブレット横は地図の上に選んだ場所のカードを重ねる
 *    (右に固定のスポット欄は置かない)。空模様は地図の下に同じ時刻の線で
 * 状態は色だけで伝えない(必ず文字)。
 */
import React from 'react';
import {
  AlertTriangle, BookOpen, Camera, CalendarDays, CheckCircle2, CloudRain, Coffee, Eye, LifeBuoy, ListOrdered,
  Map as MapIcon, Navigation, RefreshCw, Settings2, Stamp, Ticket, WifiOff, X,
} from 'lucide-react';
import { formatTimeInZone } from '../todayModel';
import {
  STAGE_LABEL, STAGE_ORDER, dateLabel, hoursLabel, localHm, modeWord, type GoNowView,
} from './todayLive';
import { Seal } from './LivePieces';
import type { TodayCtx, TodayScreen } from './todayCtx';
import { bookingPill } from './todayHelpers';
import {
  SOURCE_LETTER, SOURCE_WORD, changeItems, hasBookingFor, sourceKind, travelSource, type SourceKind,
} from './todaySource';

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




// ---- 移動時間の出どころ ------------------------------------------------------------------------------------------

export const SourceTag: React.FC<{ kind: SourceKind; children?: React.ReactNode; testId?: string }> = ({ kind, children, testId }) => (
  <span className="tl-src" data-kind={kind} data-testid={testId}>
    <i aria-hidden="true">{SOURCE_LETTER[kind]}</i>
    {children ?? SOURCE_WORD[kind]}
  </span>
);

function deviceZone(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { return null; }
}

function minutesAgo(ms: number | null, nowMs: number): number | null {
  if (ms == null) return null;
  return Math.max(0, Math.round((nowMs - ms) / 60_000));
}

// ---- 1. ライブ帯 ---------------------------------------------------------------------------------------------------

export const LiveBand: React.FC<{ ctx: TodayCtx; syncedAt: string | null; deviceNowMs: number }> = ({ ctx, syncedAt, deviceNowMs }) => {
  const { go, nextEv, timeZone } = ctx;
  const dz = deviceZone();
  const showDevice = !!timeZone && !!dz && dz !== timeZone;
  const deviceHm = showDevice ? formatTimeInZone(new Date(deviceNowMs).toISOString(), dz) : null;
  const deviceWord = dz === 'Asia/Tokyo' ? '日本' : '端末';
  const ago = minutesAgo(ctx.fetchedAt, deviceNowMs);
  return (
    <div className="tl-band" role="status" aria-label="ライブ帯" data-testid="today-live-band" data-stale={ctx.stale ? 'true' : undefined}>
      <b className="tl-band__live"><span className="tl-band__dot" aria-hidden="true" />{ctx.stale ? '保存済み' : 'LIVE'}</b>
      {(ctx.dayLabel || ctx.data.today_date) && (
        <span className="tl-band__muted tl-not-sp">{[ctx.dayLabel, dateLabel(ctx.data.today_date)].filter(Boolean).join(' ・ ')}</span>
      )}
      {ctx.nowLocal && (
        <span>現地 <b>{ctx.nowLocal}</b>{deviceHm && <span className="tl-band__muted">{`（${deviceWord} ${deviceHm}）`}</span>}</span>
      )}
      {nextEv && <span className="tl-band__next tl-not-sp">次 <b>{`${hm(nextEv.start_at, timeZone)} ${nextEv.title}`}</b></span>}
      {go && (
        <span className="tl-band__go tl-not-sp" data-stage={go.stage}>
          {go.minutesToLeave > 0 ? `あと${go.minutesToLeave}分で出発` : go.stage === 'now' ? '今出発' : `出発を${-go.minutesToLeave}分過ぎた`}
        </span>
      )}
      <span className="tl-band__fresh" data-stale={ctx.stale ? 'true' : undefined} data-testid="today-sync">
        {ctx.stale ? <WifiOff size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
        {ctx.stale
          ? `保存済み${syncedAt ? ` ${syncedAt} 取得` : ''}${ago != null ? ` ・ ${ago}分前` : ''}`
          : `最新${syncedAt ? ` ${syncedAt}` : ''} 同期`}
      </span>
    </div>
  );
};

// ---- 見出しの行(今日の題・進み・お助け・簡易表示・更新・設定) -----------------------------------------------------

export const TodayTitleRow: React.FC<{ ctx: TodayCtx; showZoneNote: boolean; live: boolean }> = ({ ctx, showZoneNote, live }) => {
  const visited = ctx.events.filter((e) => ctx.visitedIds.has(e.id) || ctx.doneIds.has(e.id)).length;
  return (
    <div className="tl-titlerow">
      {live && (
        <div className="tl-titlerow__main">
          <h1 id="today-hero-title" className="tl-title tl-title--lg tl-titlerow__h1">{ctx.dayTitle}</h1>
          <p className="tl-mute tl-small tl-titlerow__sub">
            {[`${ctx.events.length}か所のうち ${visited}か所`, ctx.destination].filter(Boolean).join(' ・ ')}
            {showZoneNote && <span className="tl-titlerow__zone">{` ・ 時刻は現地時間(${ctx.timeZone})`}</span>}
          </p>
        </div>
      )}
      <div className="tl-toolbar">
        <button type="button" onClick={() => ctx.open('help')} className="tc-focus-ring tl-icon-btn tl-icon-btn--text tl-icon-btn--help"
          aria-label="お助け" data-testid="today-help-open">
          <LifeBuoy size={16} aria-hidden="true" /><span className="tl-not-sp">お助け</span>
        </button>
        <button type="button" onClick={ctx.toggleSimple} aria-pressed={ctx.simple} className="tc-focus-ring tl-icon-btn tl-icon-btn--text">
          <Eye size={16} aria-hidden="true" />{ctx.simple ? '簡易表示: 入' : '簡易表示'}
        </button>
        <button type="button" onClick={ctx.refresh} aria-label="更新" className="tc-focus-ring tl-icon-btn">
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => ctx.open('settings')} aria-label="当日の設定" className="tc-focus-ring tl-icon-btn">
          <Settings2 size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

// ---- 2. 判断カード(NOW + NEXT) ---------------------------------------------------------------------------------

export const DecisionCard: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { go, nowEv: n, nextEv: e, timeZone } = ctx;
  const p = ctx.flow?.nowProgress ?? null;
  const nowVisited = n ? ctx.visitedIds.has(n.id) : false;
  const nowEnd = n ? (n.end_at ?? ctx.gEvents[n.id]?.end_at ?? null) : null;
  const src = travelSource(ctx, e);
  const status = e?.transport_status === 'delayed' ? '遅延' : e?.transport_status === 'cancelled' ? '運休' : null;
  const leave = go ? hm(go.leaveBy, timeZone) : null;
  return (
    <section className="tl-decide" data-stage={go?.stage ?? 'none'} aria-labelledby="today-next-title" data-testid="today-decide">
      {n && (
        <div className="tl-decide__now" data-testid="today-now">
          <Seal title={n.title} id={n.id} eventType={n.event_type} size={40} state={nowVisited ? 'done' : 'ready'} label="" />
          <div className="tl-decide__nowtext">
            <p className="tl-lbl">{`NOW ・ いま ${hm(n.start_at, timeZone)}${nowEnd ? `〜${hm(nowEnd, timeZone)}` : ''}`}</p>
            <h2 className="tl-decide__nowtitle">{n.title}</h2>
            {p && (
              <div className="tl-bar" role="progressbar" aria-label="今の予定の進み" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={p.percent}><span style={{ width: `${p.percent}%` }} /></div>
            )}
          </div>
          <div className="tl-decide__nowside">
            {p && <b className="tl-decide__left">{`残り${p.minutesLeft}分`}</b>}
            <button type="button" className="tc-focus-ring tl-btn tl-btn--sm tl-btn--soft" onClick={() => ctx.open('stamp', n.id)}>
              <Stamp size={14} aria-hidden="true" />{nowVisited ? '旅帖に綴じる' : '印を押す'}
            </button>
          </div>
        </div>
      )}
      <div className="tl-decide__next" data-testid="today-next">
        {e ? (
          <>
            <div className="tl-row">
              <p className="tl-lbl tl-lbl--coral">{go ? '出発の合図 ・ NEXT' : 'NEXT ・ 次の予定'}</p>
              <span className="tl-decide__pills">
                {go && <Pill tone={go.stage === 'relaxed' ? 'good' : go.stage === 'late' ? 'warn' : 'coral'}>{STAGE_LABEL[go.stage]}</Pill>}
                {status && <Pill tone="bad">{status}</Pill>}
              </span>
            </div>
            <div className="tl-decide__main" data-testid="today-go">
              {go && <GoRing view={go} size={104} top={go.minutesToLeave > 0 ? '出発まで' : null} />}
              <div className="tl-decide__text">
                {go && leave ? (
                  <>
                    <p className="tl-decide__pre">次の予定へ</p>
                    <p className="tl-decide__leave"><span className="tl-decide__time">{leave}</span> <b>に出発</b></p>
                  </>
                ) : (
                  <p className="tl-decide__leave"><span className="tl-decide__time">{hm(e.start_at, timeZone)}</span> <b>から</b></p>
                )}
                <h2 id="today-next-title" className="tl-decide__title">
                  {e.title}<span className="tl-mute">{` ${hm(e.start_at, timeZone)}着`}</span>
                </h2>
                <div className="tl-decide__src">
                  <SourceTag kind={src.kind} testId="today-go-source">{src.text}</SourceTag>
                  <button type="button" className="tc-focus-ring tl-link" onClick={() => ctx.open('source', e.id)}>出どころを見る</button>
                </div>
                {go?.estimated && <p className="tl-go__note">移動時間は直線距離からの概算です。余裕を見て出発してください</p>}
                {go?.stage === 'late' && go.expectedArrivalMs != null && (
                  <p className="tl-go__note">{`${hm(new Date(go.expectedArrivalMs).toISOString(), timeZone)} 着の見込み`}</p>
                )}
              </div>
            </div>
            {go && (
              <ol className="tl-stages" aria-label="出発までの段階">
                {STAGE_ORDER.map((s) => (
                  <li key={s} data-stage={s} aria-current={s === go.stage ? 'step' : undefined}>{STAGE_LABEL[s]}</li>
                ))}
              </ol>
            )}
            <div className="tl-actions tl-actions--fill">
              <button type="button" className="tc-focus-ring tl-btn tl-btn--coral" onClick={() => ctx.open('go')}>
                <Navigation size={16} aria-hidden="true" />案内を開く
              </button>
              {hasBookingFor(ctx, e) && (
                <button type="button" className="tc-focus-ring tl-btn" onClick={() => ctx.open('ticket', e.id)}>
                  <Ticket size={16} aria-hidden="true" />予約・チケット
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="tl-small" data-testid="today-next-none">本日、これ以降の予定はありません</p>
        )}
      </div>
    </section>
  );
};

// ---- 3. 変化の知らせ -------------------------------------------------------------------------------------------------

export const ChangeAlerts: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const items = changeItems(ctx);
  if (items.length === 0) {
    const checked = ctx.fetchedAt ? hm(new Date(ctx.fetchedAt).toISOString(), ctx.timeZone) : null;
    return (
      <p className="tl-calm" data-testid="today-calm">
        <CheckCircle2 size={14} aria-hidden="true" />
        {`遅延・休業・雨の知らせ なし${checked ? `（${checked} 確認）` : ''}`}
      </p>
    );
  }
  return (
    <div className="tl-changes" data-testid="today-changes">
      {items.map((it) => (
        <section key={it.key} className="tl-change" data-tone={it.tone} role="status" data-testid={it.testId}>
          <span className="tl-change__icon">{it.icon === 'rain' ? <CloudRain size={22} aria-hidden="true" /> : it.icon === 'ticket' ? <Ticket size={22} aria-hidden="true" /> : <AlertTriangle size={22} aria-hidden="true" />}</span>
          <div className="tl-change__body">
            <b>{it.title}</b>
            <p>{it.body}</p>
            <p className="tl-change__meta">{it.meta.map((m) => <span key={m}>{m}</span>)}</p>
            <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open(it.screen, it.arg ?? null)}>{it.action}</button>
          </div>
        </section>
      ))}
    </div>
  );
};

// ---- 4. 今日の流れ(タブレット・PC) ------------------------------------------------------------------------------

export const FlowCard: React.FC<{ ctx: TodayCtx; selectedId: string | null; onSelect: (id: string) => void }> = ({ ctx, selectedId, onSelect }) => {
  const { events, timeZone } = ctx;
  return (
    <section className="tl-card tl-flow" aria-labelledby="today-flow-title" data-testid="today-flow">
      <div className="tl-row">
        <h2 id="today-flow-title" className="tl-lbl">今日の流れ ・ 押すと地図で見る</h2>
        <button type="button" className="tc-focus-ring tl-link" onClick={() => ctx.open('timeline')}>旅程を開く</button>
      </div>
      <ol className="tl-flow__list">
        {events.map((e, i) => {
          const done = ctx.visitedIds.has(e.id) || ctx.doneIds.has(e.id);
          const st = e.id === ctx.nowEv?.id ? 'now' : e.id === ctx.nextEv?.id ? 'next' : done ? 'done' : 'todo';
          const g = ctx.gEvents[e.id];
          const kind = sourceKind(g?.travel_source, g?.travel_minutes);
          const sub = st === 'now' ? `NOW${ctx.flow?.nowProgress ? ` ・ 残り${ctx.flow.nowProgress.minutesLeft}分` : ''}`
            : st === 'next' ? `NEXT${ctx.go ? ` ・ ${hm(ctx.go.leaveBy, timeZone)} に出発` : ''}`
              : done ? (ctx.visitedIds.has(e.id) ? '済 ・ 印を押した' : '済') : ctx.rainIds.has(e.id) ? '雨の時間にかかる' : 'この後';
          const gapHere = ctx.gap && ctx.gap.before_event_id === e.id ? ctx.gap : null;
          return (
            <li key={e.id} data-state={st}>
              {i > 0 && g?.travel_minutes != null && (
                <p className="tl-flow__move">
                  <SourceTag kind={kind}>{`${modeWord(g.travel_mode ?? e.transport_mode)} ${g.travel_minutes}分`}</SourceTag>
                </p>
              )}
              {gapHere && (
                <p className="tl-flow__gap"><Coffee size={13} aria-hidden="true" />
                  {`${hm(gapHere.start_at, timeZone)}〜${hm(gapHere.end_at, timeZone)} 空き${gapHere.minutes}分 ・ 寄り道チャンス`}</p>
              )}
              <button type="button" className="tc-focus-ring tl-flow__item" aria-pressed={selectedId === e.id} onClick={() => onSelect(e.id)}>
                <span className="tl-flow__time">{hm(e.start_at, timeZone)}</span>
                <Seal title={e.title} id={e.id} eventType={e.event_type} size={32}
                  state={ctx.visitedIds.has(e.id) ? 'done' : st === 'now' ? 'ready' : 'empty'} label="" />
                <span className="tl-flow__text"><b>{e.title}</b><span className="tl-mute tl-small">{sub}</span></span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

// ---- 地図の上に重ねる「選んだ場所」(タブレット横・PC) ----------------------------------------------------------

export const SpotOverlay: React.FC<{ ctx: TodayCtx; eventId: string; onClose: () => void }> = ({ ctx, eventId, onClose }) => {
  const e = ctx.events.find((x) => x.id === eventId);
  if (!e) return null;
  const g = ctx.gEvents[e.id];
  const done = ctx.visitedIds.has(e.id) || ctx.doneIds.has(e.id);
  const st = e.id === ctx.nowEv?.id ? 'NOW' : e.id === ctx.nextEv?.id ? 'NEXT' : done ? '済' : ctx.rainIds.has(e.id) ? '雨の時間' : 'この後';
  const end = e.end_at ?? g?.end_at ?? null;
  const h = hoursLabel(g?.hours?.status, g?.hours?.minutes_to_close);
  const b = bookingPill(ctx, e);
  const src = travelSource(ctx, e);
  return (
    <section className="tl-spot" aria-label={`${e.title}(地図で選んだ場所)`} data-testid="today-spot">
      <div className="tl-row">
        <p className="tl-lbl tl-lbl--coral">{`${st} ・ ${hm(e.start_at, ctx.timeZone)}${end ? `〜${hm(end, ctx.timeZone)}` : ''}`}</p>
        <button type="button" className="tc-focus-ring tl-icon-btn" aria-label="選んだ場所を閉じる" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <b className="tl-spot__title">{e.title}</b>
      <div className="tl-pills">
        {g?.travel_minutes != null && <SourceTag kind={src.kind}>{src.text}</SourceTag>}
        {h && <Pill tone={h.tone}>{h.text}</Pill>}
        {b && <Pill tone={b.tone}>{b.text}</Pill>}
        {ctx.rainIds.has(e.id) && <Pill tone="info">雨の時間にかかる</Pill>}
      </div>
      {g?.entrance_note && <p className="tl-small tl-mute">{`入口メモ：${g.entrance_note}`}</p>}
      <div className="tl-actions">
        {e.id === ctx.nextEv?.id && (
          <button type="button" className="tc-focus-ring tl-btn tl-btn--sm tl-btn--coral" onClick={() => ctx.open('go')}>
            <Navigation size={14} aria-hidden="true" />案内
          </button>
        )}
        {e.id === ctx.nowEv?.id && (
          <button type="button" className="tc-focus-ring tl-btn tl-btn--sm tl-btn--pri" onClick={() => ctx.open('stamp', e.id)}>印を押す</button>
        )}
        <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('place', e.id)}>詳しく</button>
        {hasBookingFor(ctx, e) && (
          <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('ticket', e.id)}>
            <Ticket size={14} aria-hidden="true" />予約・チケット
          </button>
        )}
        {ctx.rainIds.has(e.id) && (
          <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={() => ctx.open('rain')}>プランBと比べる</button>
        )}
      </div>
    </section>
  );
};

// ---- 地図の下の「空模様と今日の予定」(時刻の線) ----------------------------------------------------------------

export const SkyStrip: React.FC<{ ctx: TodayCtx }> = ({ ctx }) => {
  const { hours, events, timeZone } = ctx;
  const startHours = events.map((e) => Number((localHm(e.start_at, timeZone) ?? '').slice(0, 2))).filter((x) => !Number.isNaN(x));
  const from = Math.max(0, Math.min(9, ...(startHours.length ? startHours : [9])));
  const to = Math.min(23, Math.max(21, ...(startHours.length ? startHours : [21])));
  const shown = hours.filter((h) => h.hour >= from && h.hour <= to);
  if (shown.length === 0) return null;
  const span = to - from + 1;
  const pos = (iso: string | null | undefined) => {
    const t = localHm(iso ?? null, timeZone);
    if (!t) return null;
    const v = Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60;
    return Math.min(100, Math.max(0, ((v - from) / span) * 100));
  };
  const cols = { gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` };
  const fetched = ctx.sky?.fetchedAt ? hm(new Date(ctx.sky.fetchedAt).toISOString(), timeZone) : null;
  const nowPos = pos(new Date(ctx.nowMs).toISOString());
  return (
    <div className="tl-skystrip" data-testid="today-skystrip">
      <div className="tl-row">
        <b className="tl-small">空模様と今日の予定（時刻の線）</b>
        <span className="tl-mute tl-small">{`1時間ごとの降水確率 ・ ${ctx.sky?.source ?? 'Open-Meteo'}${fetched ? ` ・ ${fetched}取得` : ''}`}</span>
      </div>
      <div className="tl-skystrip__bars" style={cols} aria-hidden="true">
        {shown.map((h) => <span key={h.hour} data-rain={h.rainy ? 'true' : undefined} style={{ height: `${Math.max(6, h.probability ?? 0)}%` }} />)}
      </div>
      <div className="tl-skystrip__events" aria-hidden="true">
        {events.map((e) => {
          const a = pos(e.start_at);
          const end = e.end_at ?? ctx.gEvents[e.id]?.end_at ?? null;
          const b = pos(end) ?? (a != null ? a + 100 / span / 2 : null);
          if (a == null || b == null) return null;
          const st = e.id === ctx.nowEv?.id ? 'now' : e.id === ctx.nextEv?.id ? 'next'
            : ctx.visitedIds.has(e.id) || ctx.doneIds.has(e.id) ? 'done' : ctx.rainIds.has(e.id) ? 'rain' : 'todo';
          return <span key={e.id} data-state={st} style={{ left: `${a}%`, width: `${Math.max(1.5, b - a)}%` }} title={e.title} />;
        })}
        {nowPos != null && <i className="tl-skystrip__now" style={{ left: `${nowPos}%` }} />}
      </div>
      <div className="tl-skystrip__hours" style={cols} aria-hidden="true">{shown.map((h) => <span key={h.hour}>{h.hour}</span>)}</div>
    </div>
  );
};

// ---- 下の操作(スマホ・タブレット。1段) --------------------------------------------------------------------------

export const TodayDock: React.FC<{ ctx: TodayCtx; current: TodayScreen | 'today' }> = ({ ctx, current }) => {
  const target = ctx.nowEv ?? ctx.nextEv;
  const tab = (key: TodayScreen | 'today', label: string, icon: React.ReactNode) => (
    <button key={key} type="button" className="tc-focus-ring tl-tab-btn" aria-current={current === key ? 'page' : undefined}
      onClick={() => (key === 'today' ? ctx.close() : ctx.open(key as TodayScreen))}>
      <span aria-hidden="true">{icon}</span>{label}
    </button>
  );
  return (
    <nav className="tl-dock tl-dock--one" aria-label="当日の画面" data-current={current}>
      {tab('today', '今日', <CalendarDays size={20} />)}
      {tab('map', '地図', <MapIcon size={20} />)}
      <button type="button" className="tc-focus-ring tl-tab-btn tl-tab-btn--fab" aria-label="印・写真・ひとことを残す"
        onClick={() => ctx.open('memo', target?.id ?? null)}>
        <span className="tl-fab" aria-hidden="true"><Camera size={22} /></span>残す
      </button>
      {tab('tabicho', '旅帖', <BookOpen size={20} />)}
      {tab('timeline', '旅程', <ListOrdered size={20} />)}
    </nav>
  );
};

/** 通信なしの時、上に出す知らせ(保存時刻・何分前・送信待ち) */
export const OfflineAlert: React.FC<{ ctx: TodayCtx; deviceNowMs: number }> = ({ ctx, deviceNowMs }) => {
  const saved = ctx.fetchedAt ? hm(new Date(ctx.fetchedAt).toISOString(), ctx.timeZone) : null;
  const ago = minutesAgo(ctx.fetchedAt, deviceNowMs);
  return (
    <section className="tl-change" data-tone="off" role="status" data-testid="today-offline-alert">
      <span className="tl-change__icon"><WifiOff size={22} aria-hidden="true" /></span>
      <div className="tl-change__body">
        <b>{`通信できません ・ ${saved ?? ''} に保存した情報を表示中`}</b>
        <p>出発の合図は端末で計算を続けます。最新の天気・寄り道の候補・プランBへの切り替えは、つながってから。</p>
        <p className="tl-change__meta">
          {ago != null && <span>{`${ago}分前に取得`}</span>}
          <span>{ctx.pendingCount > 0 ? `送信待ち ${ctx.pendingCount}件` : '送信待ちなし'}</span>
          <span>チケット・宿の情報は保存した物を表示</span>
        </p>
        <button type="button" className="tc-focus-ring tl-btn tl-btn--sm" onClick={ctx.refresh}><RefreshCw size={14} aria-hidden="true" />もう一度つなぐ</button>
      </div>
    </section>
  );
};

