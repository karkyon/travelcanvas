/**
 * [Gate HomeLive] 旅行中のホーム(旅行の期間に入ると、旅行前の表紙・準備の進み具合の代わりに出す)。
 *
 * 上から: 旅の状態の帯(旅行中・何日目・現地の時刻・最後に読んだ時刻・通信なし) → 次にすること(行き先・時刻・あと何分・
 * 移動の状況・「案内を開く」・予約がある時だけ「チケット」) → いまの予定 → 遅延・休業(ある時だけ) → 今日の流れ → 地図。
 * PC は「次にすること + 今日の流れ」と地図を並べ、スマホは 次 → 流れ → 地図 の順。流れの予定を押すと地図の印も選ばれる(逆も同じ)。
 * 予定は GET /plans/{id}/today(今日の画面と同じ値)。読めない時はホームの要約(focus.today)の今と次だけを出し、そう書く。
 * 値を作らない: 座標の無い予定は地図に出さず、案内も出さない(理由を書く)。
 */
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, RefreshCw, Route, Ticket } from 'lucide-react';
import { getToday } from '@/services/api';
import type { TodayEvent, TodayResponse } from '@/services/api';
import type { DashboardFocus, DashboardTrip } from '@/services/api/types/g9';
import { computeTodayFlow, computeTodayView, formatTimeInZone, timeRange, TRANSPORT_LABELS } from '@/pages/today/todayModel';
import { safeExternalUrl, safeInternalPath } from '@/utils/safeNavigation';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { clockIn, guideUrl, liveState, LIVE_STATE_LABEL, untilLabel } from './tripLiveModel';
import { eventTime, minutesLabel } from './dashboardModel';

const TripLiveMap = lazy(() => import('./TripLiveMap'));

type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; res: TodayResponse; offsetMs: number; at: number }
  | { kind: 'error'; message: string };

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

const TripLiveHome: React.FC<{ trip: DashboardTrip; focus: DashboardFocus | null }> = ({ trip, focus }) => {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [offline, setOffline] = useState(isOffline);

  const read = useCallback(async () => {
    try {
      const res = await getToday(trip.id);
      const server = Date.parse(res.server_time);
      setLoad({ kind: 'ok', res, offsetMs: Number.isNaN(server) ? 0 : server - Date.now(), at: Date.now() });
    } catch (e) {
      setLoad((s) => (s.kind === 'ok' ? s : { kind: 'error', message: errorDetailMessage(e, '今日の予定を読み込めませんでした') }));
    }
  }, [trip.id]);

  useEffect(() => { void read(); }, [read]);
  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 30_000);
    const on = () => { setOffline(false); void read(); };
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.clearInterval(tick); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [read]);

  const tz = load.kind === 'ok' ? load.res.timezone_id : focus?.today?.timezone_id ?? trip.timezone_id;
  const at = nowMs + (load.kind === 'ok' ? load.offsetMs : 0);
  const view = useMemo(() => (load.kind === 'ok' ? computeTodayView(load.res, at) : null), [load, at]);
  const flow = useMemo(() => (load.kind === 'ok' && view ? computeTodayFlow(load.res, view, at) : null), [load, view, at]);
  const events: TodayEvent[] = load.kind === 'ok' ? load.res.events : [];

  // 読めない時はホームの要約(focus.today)の今と次
  const summary = focus?.today ?? null;
  const nextEv = view ? view.nextEvent : null;
  const nowEv = view ? view.nowEvent : null;
  const minutes = view ? view.minutesUntilNext : summary?.minutes_until_next ?? null;
  const alerts = focus?.alerts ?? null;
  const alertCount = alerts ? alerts.active + alerts.detected : 0;
  const base = `/planner/${encodeURIComponent(trip.id)}`;
  const ticketTo = nextEv?.has_ticket && nextEv.reservation_id
    ? safeInternalPath(`${base}/reservations?open=${encodeURIComponent(nextEv.reservation_id)}`) : null;
  const guide = nextEv ? guideUrl(nowEv, nextEv) : null;
  const status = nextEv?.transport_status ? TRANSPORT_LABELS[nextEv.transport_status] : undefined;
  const hasPins = events.some((e) => e.latitude != null && e.longitude != null);

  return (
    <section className="tc-live-home" aria-labelledby="dash-hero-title" data-testid="dashboard-hero" data-phase="ongoing">
      <p className="tc-live-bar" data-testid="live-bar">
        <span className="tc-plan-chip tc-plan-chip--live" data-testid="dashboard-phase">旅行中</span>
        <b>{trip.total_days ? `${trip.day_number ?? 1}日目 / ${trip.total_days}日` : `${trip.day_number ?? 1}日目`}</b>
        <span>{`現地 ${clockIn(at, tz)}`}<small>{tz ? `(${tz})` : ''}</small></span>
        {offline ? (
          <span className="tc-live-bar__off" role="status">
            {load.kind === 'ok' ? `通信なし: ${clockIn(load.at, tz)} に読んだ予定を表示` : '通信なし'}</span>
        ) : load.kind === 'ok' ? (
          <span className="tc-live-bar__fresh">{`予定は ${clockIn(load.at, tz)} に更新`}</span>
        ) : null}
        <button type="button" className="tc-focus-ring tc-live-bar__btn" onClick={() => void read()} aria-label="予定を読み直す">
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </p>
      <h2 id="dash-hero-title" className="tc-live-title">{trip.title}</h2>
      {trip.destination && <p className="tc-live-dest">{trip.destination}</p>}

      <div className="tc-live-grid">
        <div className="tc-live-main">
          <div className="tc-live-next" data-testid="dashboard-nownext" aria-labelledby="live-next-h">
            <h3 id="live-next-h" className="tc-live-eyebrow">次にすること</h3>
            {load.kind === 'loading' && !summary && <p role="status">今日の予定を読み込み中…</p>}
            {nextEv ? (
              <>
                <p className="tc-live-next__title">{nextEv.title}</p>
                <p className="tc-live-next__time">
                  <span className="tc-numeric">{timeRange(nextEv, tz)}</span>
                  {untilLabel(minutes) && <b>{untilLabel(minutes)}</b>}
                  {status && <span className={`tc-pill ${status.tone}`}>{status.text}</span>}
                </p>
                {view?.minutesUntilDeparture != null && (
                  <p className="tc-live-next__sub">{`出発の目安: ${untilLabel(view.minutesUntilDeparture)}(移動の区間に登録した出発の時刻)`}</p>
                )}
                {nextEv.address && <p className="tc-live-next__sub">{nextEv.address}</p>}
                <nav aria-label="この旅行の操作" className="tc-live-next__acts">
                  {guide ? (
                    <a href={safeExternalUrl(guide) ?? undefined} target="_blank" rel="noopener noreferrer" className="tc-focus-ring tc-mbtn tc-mbtn--primary">
                      <Route size={16} aria-hidden="true" />案内を開く<span className="sr-only">(Google マップ・新しいタブ)</span>
                    </a>
                  ) : null}
                  {ticketTo && (
                    <Link to={safeInternalPath(ticketTo) ?? '/dashboard'} className="tc-focus-ring tc-mbtn"><Ticket size={16} aria-hidden="true" />チケット</Link>
                  )}
                  <Link to={safeInternalPath(`/planner/${encodeURIComponent(trip.id)}/today`) ?? '/dashboard'} className="tc-focus-ring tc-mbtn">旅の当日を開く</Link>
                </nav>
                {!guide && <p className="tc-live-next__sub">場所の座標・住所が無いため、案内は出せません。</p>}
              </>
            ) : !view && summary?.next_event ? (
              <>
                <p className="tc-live-next__title">{summary.next_event.title}</p>
                <p className="tc-live-next__time">
                  <span className="tc-numeric">{eventTime(summary.next_event, tz) ?? '時刻未定'}</span>
                  {minutesLabel(summary.minutes_until_next) && <b>{minutesLabel(summary.minutes_until_next)}</b>}
                </p>
                <nav aria-label="この旅行の操作" className="tc-live-next__acts">
                  <Link to={safeInternalPath(`/planner/${encodeURIComponent(trip.id)}/today`) ?? '/dashboard'} className="tc-focus-ring tc-mbtn tc-mbtn--primary">旅の当日を開く</Link>
                </nav>
              </>
            ) : load.kind !== 'loading' ? (
              <>
                <p className="tc-live-next__title">
                  {view && !view.isCurrentDay ? '今日の日程はありません' : '今日のこの後の予定はありません'}
                </p>
                <nav aria-label="この旅行の操作" className="tc-live-next__acts">
                  <Link to={safeInternalPath(`/planner/${encodeURIComponent(trip.id)}/today`) ?? '/dashboard'} className="tc-focus-ring tc-mbtn tc-mbtn--primary">旅の当日を開く</Link>
                  <Link to={safeInternalPath(`/planner/${encodeURIComponent(trip.id)}`) ?? '/dashboard'} className="tc-focus-ring tc-mbtn">旅程を開く</Link>
                </nav>
              </>
            ) : null}
            {nowEv && (
              <p className="tc-live-now" data-testid="live-now">
                <span className="tc-live-eyebrow">いま</span>{nowEv.title}
                {flow?.nowProgress && <small>{`(残り約 ${flow.nowProgress.minutesLeft} 分)`}</small>}
              </p>
            )}
            {load.kind === 'error' && (
              <p className="tc-live-warn" role="alert">{`${load.message}。ホームの要約だけを出しています。`}</p>
            )}
          </div>

          {alertCount > 0 && alerts && (
            <div className="tc-live-alert" role="note" data-testid="live-alerts">
              <h3><AlertTriangle size={16} aria-hidden="true" />{`遅延・休業 ${alertCount}件`}</h3>
              <ul>
                {alerts.top.map((x, n) => (
                  <li key={n}>
                    {`${x.kind_label ?? '知らせ'}${x.event_title ? `: ${x.event_title}` : ''}`}
                    {x.delay_minutes ? `(${x.delay_minutes}分)` : ''}{x.is_stale ? '(情報が古い)' : ''}
                  </li>
                ))}
              </ul>
              <Link to={safeInternalPath(`/planner/${encodeURIComponent(trip.id)}/alerts`) ?? '/dashboard'} className="tc-focus-ring tc-mini-link">対応を選ぶ →</Link>
            </div>
          )}
          {alertCount === 0 && alerts && (
            <p className="tc-live-ok" data-testid="live-alerts-ok">遅延・休業の知らせはありません</p>
          )}

          <div className="tc-live-flow" aria-labelledby="live-flow-h" data-testid="live-flow">
            <div className="tc-section-row">
              <h3 id="live-flow-h" className="tc-section-title"><CalendarDays size={16} aria-hidden="true" />今日の流れ</h3>
              <span className="tc-live-sub">{`時刻は旅行先の時刻${tz ? `(${tz})` : ''}`}</span>
            </div>
            {events.length === 0 ? (
              <p className="tc-live-sub">{load.kind === 'ok' ? '今日の時刻つきの予定はありません。' : '今日の予定を読み込めていません。'}</p>
            ) : (
              <ol className="tc-live-steps">
                {events.map((e) => {
                  const st = liveState(e.id, nowEv?.id ?? null, nextEv?.id ?? null, flow?.doneIds ?? []);
                  return (
                    <li key={e.id} data-state={st}>
                      <button type="button" className="tc-focus-ring" aria-pressed={selected === e.id}
                        onClick={() => setSelected((v) => (v === e.id ? null : e.id))}>
                        <span className="tc-numeric tc-live-steps__time">{formatTimeInZone(e.start_at, tz)}</span>
                        <span className="tc-live-steps__name">{e.title}</span>
                        <span className="tc-live-steps__state">{LIVE_STATE_LABEL[st]}{e.has_ticket ? '・チケットあり' : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        <div className="tc-live-side">
          {hasPins ? (
            <div className="tc-live-map" data-testid="live-map">
              <Suspense fallback={<p className="tc-live-sub" role="status">地図を読み込み中…</p>}>
                <TripLiveMap events={events} timeZone={tz} nowId={nowEv?.id ?? null} nextId={nextEv?.id ?? null}
                  doneIds={flow?.doneIds ?? []} selectedId={selected} onSelect={setSelected} />
              </Suspense>
            </div>
          ) : (
            <p className="tc-live-sub tc-live-nomap">
              {load.kind === 'ok' ? '今日の予定に座標が無いため、地図は出せません。' : '地図は予定を読み込んだ後に出します。'}
            </p>
          )}
          <nav aria-label="旅行中によく使う画面" className="tc-live-links">
            <Link to={safeInternalPath(`${base}/reservations`) ?? '/dashboard'} className="tc-focus-ring">予約・チケット</Link>
            <Link to={safeInternalPath(`${base}/expenses`) ?? '/dashboard'} className="tc-focus-ring">支出を記録</Link>
            <Link to={safeInternalPath(base) ?? '/dashboard'} className="tc-focus-ring">旅程を開く</Link>
            <Link to={safeInternalPath(`${base}/kit`) ?? '/dashboard'} className="tc-focus-ring">旅行箱</Link>
          </nav>
        </div>
      </div>
    </section>
  );
};

export default TripLiveHome;
