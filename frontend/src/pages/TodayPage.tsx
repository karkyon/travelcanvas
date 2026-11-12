/**
 * TodayPage (SC-07) - FR-029当日モードのNOW/NEXT画面。
 *
 * [Gate L1] backend/app/api/v1/plans.py の GET /plans/{planId}/today を
 * 表示する。DOC-02 FR-029「起動直後に今日、NOW、NEXT、出発まで、遅延、
 * 必要チケットを表示する」/ DOC-04 UI設計原則3「重要情報1操作: NOW/NEXT
 * から地図、予約、チケット、電話へ1操作」に対応する。
 *
 * [Gate L1b] 時刻を端末ではなく日程のIANAタイムゾーンの現地時刻で表示し、
 * NOW/NEXTを取得済みの今日の予定から端末側で再計算する(pages/today/todayModel.ts)。
 * 到着予定へ向かう移動区間の出発時刻・遅延/運休(登録済みの経路区間の
 * realtime_status)を表示し、通信できない場合は端末に保存した直近の当日情報
 * からNOW/NEXTを表示する(FR-032、最終取得時刻を明示)。
 *
 * [Gate G10-UX] UX-5 当日の画面の作り直し(DOC-04 §1・§14・§16):
 * - 上: 今日の日付・現地時間の注記・つながりの状態(最新/保存済み、文字で示す)・更新
 * - 今(NOW): 残りの時間と進み・地図・チケット / 次(NEXT): 出発まで・遅延・地図・チケット
 * - この後の予定・今日の済んだ数(「簡易表示」では今と次だけ。端末に覚える)
 * - スマホでは「遅延・休業などの対応」「プランへ」を画面の下(親指の届く所)に固定する
 * - 色・面はデザインの決まりだけ(暗い見た目でも読める)
 *
 * [Gate TDay] 旅の当日「旅帖ライブ」(docs/ux/TDay_旅の当日_旅帖ライブ.md):
 * - 上に固定する「ライブ帯」(次の予定・出る時刻・遅延・雨)と、今日の道のりを一本の糸で見せる「旅の糸」
 * - NEXT は「出発の合図」(出る時刻を主役に。余裕あり/そろそろ/今出発/遅れ気味。概算は概算と書く)
 * - 次の場所のチラ見せ(画像・営業・着く頃の天気・予約)・空模様の時刻の線(雨にかかる屋外の予定→プランB)
 * - 当日の地図(済・NOW・NEXT・雨・寄り道)・寄り道チャンス(すきま時間・足す前に影響)
 * - 旅帖(着いた予定ごとに印。写真・ひとこと・声を綴じる)・同行者の到着予定(位置は送らない)
 * - 朝・旅の前・夜のふりかえり・旅の終わり、お助け、移動モード、画面の中の知らせ、当日の設定
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ListChecks, RefreshCw, WifiOff, CalendarDays, LifeBuoy, Camera, Navigation, Settings2, BookOpen } from 'lucide-react';
import Button from '@/components/common/Button';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import Surface from '@/components/design/Surface';
import PageHead from '@/components/shell/PageHead';
import { useTripContext } from '@/hooks/useTripContext';
import { getToday } from '@/services/api';
import type { TodayResponse } from '@/services/api';
import { currentOfflineSession } from '@/utils/offlineSession';
import {
  computeTodayFlow, computeTodayView, formatCountdown, formatTimeInZone, loadTodayCache, saveTodayCache,
} from './today/todayModel';
import { DayList, EventCard } from './today/TodayParts';
import TodaySwitchPanel from './today/TodaySwitchPanel';
import { GoNowBlock, JourneyThread, LiveBand } from './today/live/LivePieces';
import { NextTeaser, SkyLine } from './today/live/LiveCards';
import Detours from './today/live/Detours';
import { StampDialog, TabichoDialog, TabichoStrip } from './today/live/Tabicho';
import {
  BeforeTrip, CrewPanel, Dawn, DayRecap, HelpSheet, LiveNotices, SettingsDialog, TransitMode,
} from './today/live/LivePanels';
import { useTodayLive } from './today/live/useTodayLive';
import {
  dayPhase, goNowView, localHour, readDismissed, readSettings, skyAdvice, writeDismissed, writeSettings,
  type LiveNotice, type LiveSettings,
} from './today/live/todayLive';
import type { DetourCandidate } from '@/services/api/travelDay';

// [Gate TDay] 当日の地図は Leaflet を使うため後から読む(当日の画面の最初の読み込みを重くしない)
const TodayMap = React.lazy(() => import('./today/live/TodayMap'));
import { errorDetailMessage } from '@/utils/apiErrorDetail';

// [Gate L1] DOC-04 §16に準拠し、当日画面は一定間隔で自動更新する
// (旅行者がアプリを開いたままにする想定のため、明示的なreloadを要求しない)。
const REFRESH_INTERVAL_MS = 30_000;
// [Gate L1b] 再取得の合間もNOW/NEXT・カウントダウンを進めるための再計算間隔。
const TICK_INTERVAL_MS = 15_000;
/** [Gate G10-UX] 簡易表示(今と次だけ)をこの端末に覚える */
const SIMPLE_KEY = 'tc.today.simple';

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function readSimple(): boolean {
  try {
    return window.localStorage.getItem(SIMPLE_KEY) === '1';
  } catch {
    return false;
  }
}

interface Snapshot {
  data: TodayResponse;
  /** server_time - 端末時刻(ms)。端末の時計のずれを補正する。 */
  offsetMs: number;
  /** 取得した時刻(端末時刻、ms) */
  fetchedAt: number;
}

const Notice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Surface variant="solid" padding="lg" className="text-center text-ink-700 text-base">{children}</Surface>
);

const WEEKDAY_EN = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
/** 現地の日付(YYYY-MM-DD)の曜日・日 */
function dayParts(date: string | null): { weekday: string; day: string } | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T12:00:00Z`);
  return { weekday: WEEKDAY_EN[d.getUTCDay()] ?? '', day: String(d.getUTCDate()) };
}

const TodayPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const trip = useTripContext(planId);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [simple, setSimple] = useState<boolean>(readSimple);
  const snapshotRef = useRef<Snapshot | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const res = await getToday(planId);
      const fetchedAt = Date.now();
      const serverMs = Date.parse(res.server_time);
      const offsetMs = Number.isNaN(serverMs) ? 0 : serverMs - fetchedAt;
      const next = { data: res, offsetMs, fetchedAt };
      snapshotRef.current = next;
      setSnapshot(next);
      setIsStale(false);
      setError(null);
      setClock(fetchedAt);
      // [Gate K1] 端末内の保存は暗号化する(失敗しても表示は続ける)
      void saveTodayCache(currentOfflineSession(), planId, res, offsetMs);
    } catch (e: unknown) {
      // 取得に失敗しても、表示中または端末に保存済みの当日情報があればそれを表示し続ける
      let fallback = snapshotRef.current;
      if (!fallback) {
        const cached = await loadTodayCache(currentOfflineSession(), planId);
        fallback = cached ? { data: cached.payload, offsetMs: cached.offsetMs, fetchedAt: cached.savedAt } : null;
      }
      if (fallback) {
        snapshotRef.current = fallback;
        setSnapshot(fallback);
        setIsStale(true);
        setError(null);
      } else {
        setError(errorDetailMessage(e, '当日情報の取得に失敗しました'));
      }
      setClock(Date.now());
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    snapshotRef.current = null;
    setSnapshot(null);
    setIsStale(false);
    setIsLoading(true);
    load();
    const refresh = window.setInterval(load, REFRESH_INTERVAL_MS);
    const tick = window.setInterval(() => setClock(Date.now()), TICK_INTERVAL_MS);
    const onOnline = () => {
      load();
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(tick);
      window.removeEventListener('online', onOnline);
    };
  }, [load]);

  const toggleSimple = () => {
    setSimple((v) => {
      const next = !v;
      try {
        if (next) window.localStorage.setItem(SIMPLE_KEY, '1');
        else window.localStorage.removeItem(SIMPLE_KEY);
      } catch {
        // 保存できない環境では、この画面を開いている間だけ
      }
      return next;
    });
  };

  // [Gate TDay] 旅帖ライブの状態(手がかり・空模様・設定・閉じた知らせ・開いている面)
  const { guide, sky, reloadGuide } = useTodayLive(planId, snapshot?.data.today_date ?? null, isStale);
  const [settings, setSettingsState] = useState<LiveSettings>(readSettings);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [stampFor, setStampFor] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transit, setTransit] = useState(false);
  const [detourPins, setDetourPins] = useState<DetourCandidate[]>([]);
  const setSettings = (v: LiveSettings) => { setSettingsState(v); writeSettings(v); };
  const dismiss = (key: string) => setDismissed((prev) => {
    const next = new Set(prev);
    next.add(key);
    writeDismissed(next);
    return next;
  });
  const refreshAll = useCallback(() => { void load(); void reloadGuide(); }, [load, reloadGuide]);
  const goPlanB = useCallback(() => {
    const el = document.getElementById('today-planb');
    if (el && el.childElementCount > 0) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (planId) navigate(`/planner/${planId}`);
  }, [navigate, planId]);
  const stampsMemo = useMemo(() => guide?.stamps ?? {}, [guide]);

  if (!planId) {
    return (
      <div className="p-8 text-center text-ink-700">
        プランが選択されていません。
        <div className="mt-4">
          <Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button>
        </div>
      </div>
    );
  }

  const data = snapshot?.data ?? null;
  const nowMs = snapshot ? clock + snapshot.offsetMs : clock;
  const view = snapshot ? computeTodayView(snapshot.data, nowMs) : null;
  const flow = snapshot && view ? computeTodayFlow(snapshot.data, view, nowMs) : null;
  const timeZone = data?.timezone_id ?? null;
  const showZoneNote = !!timeZone && timeZone !== deviceTimeZone();
  const nextCountdown = view
    ? view.minutesUntilDeparture != null
      ? `出発 ${formatCountdown(view.minutesUntilDeparture)}`
      : formatCountdown(view.minutesUntilNext)
    : '';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  const parts = dayParts(data?.today_date ?? null);
  const nowLocal = data ? formatTimeInZone(new Date(nowMs).toISOString(), timeZone) : null;
  const syncedAt = snapshot ? formatTimeInZone(new Date(snapshot.fetchedAt).toISOString(), timeZone) : null;
  const allToday = data?.events ?? [];

  // ---- [Gate TDay] 旅帖ライブの計算 ----
  const g = guide && (guide.local_date === (data?.today_date ?? null) || !guide.day_id) ? guide : null;
  const gEvents = g?.events ?? {};
  const stamps = g ? stampsMemo : {};
  const nowEv = view?.nowEvent ?? null;
  const nextEv = view?.nextEvent ?? null;
  const go = view?.isCurrentDay ? goNowView(nextEv, nextEv ? gEvents[nextEv.id] : undefined, nowMs) : null;
  const doneIds = new Set(flow?.doneIds ?? []);
  const visitedIds = new Set(Object.entries(stamps).filter(([, v]) => v.status === 'visited').map(([k]) => k));
  const nowHour = localHour(nowMs, timeZone);
  const hours = sky?.hours ?? [];
  const rainIds = new Set<string>((sky?.affected ?? []).map((a) => a.event_id));
  for (const e of allToday) {
    const fit = gEvents[e.id]?.fit;
    const h = e.start_at ? localHour(Date.parse(e.start_at), timeZone) : null;
    if ((fit === 'outdoor' || fit === 'partly') && h != null && hours.some((x) => x.hour === h && x.rainy)) rainIds.add(e.id);
  }
  const upcomingRain = allToday.find((e) => rainIds.has(e.id) && e.start_at && Date.parse(e.start_at) > nowMs) ?? null;
  const rainText = skyAdvice(hours, nowHour);
  const phase = view?.isCurrentDay ? dayPhase(g, allToday, nowMs, !!nowEv, !!nextEv) : 'none';
  const gap = g?.gaps.find((x) => Date.parse(x.end_at) > nowMs) ?? null;
  const lodging = [...allToday].reverse().find((e) => /accommodation|lodging|hotel/.test(e.event_type) || /ホテル|旅館|宿/.test(e.title)) ?? null;
  const arriveMs = go ? (go.expectedArrivalMs ?? (nextEv?.start_at ? Date.parse(nextEv.start_at) : null)) : (nextEv?.start_at ? Date.parse(nextEv.start_at) : null);
  const dayLabel = g?.day_index ? `DAY ${g.day_index} / ${g.day_count}` : null;
  const stampEvent = stampFor ? allToday.find((e) => e.id === stampFor) ?? null : null;
  const delayed = allToday.some((e) => e.transport_status === 'delayed' || e.transport_status === 'cancelled');
  const dateKey = data?.today_date ?? '';

  const notices: LiveNotice[] = [];
  if (view?.isCurrentDay && !simple) {
    if (settings.notices.delay && nextEv && (nextEv.transport_status === 'delayed' || nextEv.transport_status === 'cancelled')) {
      notices.push({ key: `${dateKey}:delay:${nextEv.id}`, kind: 'delay', title: nextEv.transport_status === 'cancelled' ? '移動の便が運休' : '移動の便が遅れています',
        sub: `${nextEv.title} へ向かう経路`, action: '組み直す', onAction: () => navigate(`/planner/${planId}/alerts`) });
    }
    if (settings.notices.go && go && nextEv && (go.stage === 'soon' || go.stage === 'now')) {
      notices.push({ key: `${dateKey}:go:${nextEv.id}:${go.stage}`, kind: 'go', title: go.stage === 'now' ? '今が出発の時間' : 'そろそろ出発の時間',
        sub: `${formatTimeInZone(go.leaveBy, timeZone)} に出ると ${formatTimeInZone(nextEv.start_at, timeZone)} 着`, action: '移動モード',
        onAction: () => setTransit(true) });
    }
    if (settings.notices.arrive && nowEv && stamps[nowEv.id] && stamps[nowEv.id]!.status !== 'visited') {
      notices.push({ key: `${dateKey}:arrive:${nowEv.id}`, kind: 'arrive', title: '着きましたか?', sub: `${nowEv.title} ・ 旅帖に印を押せます`,
        action: '押す', onAction: () => setStampFor(nowEv.id) });
    }
    if (settings.notices.rain && upcomingRain && upcomingRain.start_at && Date.parse(upcomingRain.start_at) - nowMs < 2 * 3600_000) {
      notices.push({ key: `${dateKey}:rain:${upcomingRain.id}`, kind: 'rain', title: 'この後、雨の可能性',
        sub: `${formatTimeInZone(upcomingRain.start_at, timeZone)} ${upcomingRain.title} は屋外です`, action: 'プランB', onAction: goPlanB });
    }
  }
  const shownNotices = notices.filter((n) => !dismissed.has(n.key)).slice(0, 3);

  return (
    <div className="tc-page tc-today" data-testid="today">
      {/* [Gate MockScreens] モックの今日: page-head(つながりの状態・最終同期)・live-hero・NOW/NEXT・今日の旅程・旅の操作 */}
      <PageHead
        eyebrow="LIVE · 当日"
        title="今日"
        sub={data ? (
          <>
            {data.today_date && <span>{data.today_date}</span>}
            {nowLocal && <span>{` · 現地 ${nowLocal}`}</span>}
            {showZoneNote && <span>{` ・ 時刻は現地時間(${timeZone})`}</span>}
            {syncedAt && <span>{` · 最終同期 ${syncedAt}`}</span>}
          </>
        ) : '今いる予定と次の予定を、現地の時刻で出します。'}
        actions={<>
          {data && (
            <span className={`tc-pill ${isStale ? 'tc-pill--warn' : 'tc-pill--good'}`} data-testid="today-sync">
              {isStale ? <WifiOff size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
              {isStale ? '保存済み' : '最新'}
            </span>
          )}
          <button type="button" onClick={refreshAll} aria-label="更新" className="tc-focus-ring tc-mbtn tc-mbtn--sm">
            <RefreshCw size={15} aria-hidden="true" /><span aria-hidden="true">更新</span>
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="当日の設定" className="tc-focus-ring tc-mbtn tc-mbtn--sm">
            <Settings2 size={15} aria-hidden="true" />
          </button>
        </>}
      />

      {data && view?.isCurrentDay && (nowEv || nextEv) && (
        <LiveBand nowLocal={nowLocal} next={nextEv} timeZone={timeZone} go={go} rainText={rainText} delayed={delayed} stale={isStale} />
      )}

      {isStale && snapshot && (
        <div role="status" className="mb-4 p-3 rounded-lg bg-warning-soft text-warning border border-warning text-sm flex items-start gap-2">
          <WifiOff size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            {offline ? 'オフラインのため、' : '最新の当日情報を取得できないため、'}
            保存済みの情報を表示しています(最終取得 {formatTimeInZone(new Date(snapshot.fetchedAt).toISOString(), timeZone)})
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 p-3 rounded-lg bg-danger-soft text-danger border border-danger text-sm">{error}</div>
      )}

      {data && view?.isCurrentDay && (data.today_date || view.nowEvent) && (
        <section className="tc-live-hero" aria-label="今日の旅" data-day={parts?.day ?? ''}>
          <p className="tc-eyebrow">
            {[dayLabel, parts?.weekday, trip.destination?.toUpperCase()].filter(Boolean).join(' · ') || 'TODAY'}
          </p>
          <p className="tc-live-title">{g?.day_title || trip.title || '今日の旅'}</p>
          {g?.day_title && trip.title && <p className="tc-live-meta">{trip.title}</p>}
          <p className="tc-live-meta">
            {`今日の予定 ${allToday.length}件`}
            {flow && flow.doneCount > 0 ? ` · 済んだ予定 ${flow.doneCount}件` : ''}
            {visitedIds.size > 0 ? ` · 旅帖の印 ${visitedIds.size}` : ''}
          </p>
          <span className="tc-live-sync">{isStale ? '● 保存済み' : '● 同期済'}</span>
          {!simple && allToday.length > 0 && (
            <JourneyThread events={allToday} timeZone={timeZone} nowId={nowEv?.id ?? null} nextId={nextEv?.id ?? null}
              doneIds={doneIds} stamps={stamps} rainIds={rainIds} />
          )}
        </section>
      )}

      <LiveNotices items={shownNotices} onDismiss={dismiss} />

      {isLoading ? (
        <div className="flex justify-center py-16" role="status" aria-label="読み込み中"><LoadingSpinner size="lg" /></div>
      ) : !data || !view ? null : !view.isCurrentDay ? (
        <Notice>保存済みの当日情報は{data.today_date}のものです。通信できる場所で更新してください。</Notice>
      ) : !data.today_date && !view.nowEvent ? (
        g?.upcoming ? (
          <BeforeTrip planId={planId} upcoming={g.upcoming} title={trip.title ?? 'この旅行'} />
        ) : (
          <div className="tc-card tc-today-empty">
            <CalendarDays size={28} aria-hidden="true" />
            <p className="font-semibold text-ink-900">今日の日程は登録されていません。</p>
            <p className="text-sm text-ink-500">旅行の日付の当日になると、今いる予定と次の予定がここに出ます。</p>
          </div>
        )
      ) : (
        <>
          {phase === 'morning' && nextEv && !simple && (
            <div style={{ marginBottom: 16 }}>
              <Dawn planId={planId} title={g?.day_title || trip.title || '旅の日'} first={nextEv} go={go} sky={rainText}
                timeZone={timeZone} dayLabel={dayLabel} />
            </div>
          )}
          {(phase === 'night' || phase === 'finished') && g && !simple && (
            <div style={{ marginBottom: 16 }}>
              <DayRecap planId={planId} guide={g} events={allToday} finished={phase === 'finished'} next={g.next_day}
                onBook={() => setBookOpen(true)} />
            </div>
          )}
          <div className="tc-today-summary-row">
            <p className="text-sm text-ink-700" data-testid="today-summary">
              {flow && flow.doneCount > 0 ? `済んだ予定 ${flow.doneCount}件` : '今日の予定'}
              {flow && !simple && flow.later.length > 0 ? ` ・ この後 ${flow.later.length}件` : ''}
            </p>
            <button
              type="button"
              onClick={toggleSimple}
              aria-pressed={simple}
              className="tc-focus-ring tc-mbtn tc-mbtn--sm"
            >
              <ListChecks size={15} aria-hidden="true" />
              {simple ? '簡易表示: 入' : '簡易表示'}
            </button>
          </div>
          <div className={`tc-today-grid ${simple ? 'is-simple' : ''}`}>
            <div className="tc-today-main">
              {view.nowEvent ? (
                <EventCard kind="now" event={view.nowEvent} timeZone={timeZone} planId={planId} progress={flow?.nowProgress}>
                  {!simple && (
                    <div className="tc-live-actions">
                      <button type="button" className={`tc-focus-ring tc-mbtn ${visitedIds.has(view.nowEvent.id) ? '' : 'tc-mbtn--primary'}`}
                        onClick={() => setStampFor(view.nowEvent!.id)}>
                        <BookOpen size={16} aria-hidden="true" />
                        {visitedIds.has(view.nowEvent.id) ? '旅帖に綴じる' : '着いた・印を押す'}
                      </button>
                    </div>
                  )}
                </EventCard>
              ) : (
                <Notice>現在進行中の予定はありません</Notice>
              )}

              {view.nextEvent ? (
                <EventCard kind="next" event={view.nextEvent} timeZone={timeZone} countdown={nextCountdown} planId={planId}>
                  {go && <GoNowBlock view={go} title={view.nextEvent.title} timeZone={timeZone} />}
                  {!simple && (
                    <div className="tc-live-actions">
                      <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => setTransit(true)}>
                        <Navigation size={16} aria-hidden="true" />移動モード
                      </button>
                    </div>
                  )}
                </EventCard>
              ) : data.today_date ? (
                <Notice>本日、これ以降の予定はありません</Notice>
              ) : null}
            </div>
            {!simple && allToday.length > 0 && (
              <DayList events={allToday} timeZone={timeZone} nowId={view.nowEvent?.id ?? null}
                nextId={view.nextEvent?.id ?? null} doneIds={doneIds} />
            )}
          </div>

          {!simple && allToday.length > 0 && (
            <div className="tc-today-live-grid">
              <div className="tc-live-stack">
                {nextEv && <NextTeaser planId={planId} event={nextEv} guide={gEvents[nextEv.id]} hours={hours} timeZone={timeZone} />}
                {hours.length > 0 && (
                  <SkyLine hours={hours} events={allToday} timeZone={timeZone} nowMs={nowMs} doneIds={doneIds} nowId={nowEv?.id ?? null}
                    rainIds={rainIds} affectedTitle={upcomingRain ? `${formatTimeInZone(upcomingRain.start_at, timeZone)} ${upcomingRain.title}` : null}
                    hasRainVariant={!!sky?.hasRainVariant} onPlanB={goPlanB} source={sky?.source ?? 'Open-Meteo'} />
                )}
                {gap && !isStale && (
                  <Detours planId={planId} dayId={g?.day_id ?? null} gap={gap} events={allToday} timeZone={timeZone} canEdit
                    onFound={setDetourPins} onAdded={refreshAll} />
                )}
              </div>
              <div className="tc-live-stack">
                <Suspense fallback={<div className="tc-live-card" aria-busy="true" style={{ minHeight: 120 }}>地図を読み込み中…</div>}>
                  <TodayMap events={allToday} timeZone={timeZone} nowId={nowEv?.id ?? null} nextId={nextEv?.id ?? null}
                    doneIds={doneIds} visitedIds={visitedIds} rainIds={rainIds} detours={detourPins}
                    onSelect={(id) => setStampFor(id)} />
                </Suspense>
                <TabichoStrip events={allToday} stamps={stamps} nowId={nowEv?.id ?? null} timeZone={timeZone}
                  onOpen={(id) => setStampFor(id)} onBook={() => setBookOpen(true)} />
                <CrewPanel planId={planId} next={nextEv} arriveMs={arriveMs} dayEndAt={data.day_end_at} timeZone={timeZone} offline={isStale} />
              </div>
            </div>
          )}
          {/* [Gate PlanB-P6] 控えの案がある日だけ出る(通信できない時は出さない) */}
          <div id="today-planb">
            {planId && (
              <TodaySwitchPanel planId={planId} date={data.today_date} events={allToday} offline={isStale}
                onSwitched={() => { refreshAll(); }} />
            )}
          </div>
        </>
      )}

      {/* モックの「旅の操作をひとつに」。親指の届く所(スマホでは画面の下に固定。広い画面では本文の下) */}
      <nav aria-label="当日の操作" className="tc-today-actions"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <p className="tc-section-title hidden sm:block">旅の操作をひとつに</p>
        <div className="flex gap-2 flex-wrap">
          {view?.isCurrentDay && (nowEv || nextEv) && (
            <Button variant="primary" size="lg" className="flex-1 sm:flex-none" icon={<Camera size={20} />}
              onClick={() => setStampFor((nowEv ?? nextEv)!.id)}>
              写真・ひとこと
            </Button>
          )}
          <Button variant="outline" size="lg" className="flex-1 sm:flex-none" icon={<LifeBuoy size={20} />} onClick={() => setHelpOpen(true)}>
            お助け
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="flex-1 sm:flex-none"
            icon={<AlertTriangle size={20} />}
            onClick={() => navigate(`/planner/${planId}/alerts`)}
          >
            遅延・休業などの対応
          </Button>
          <Button variant="secondary" size="lg" className="sm:flex-none" onClick={() => navigate(`/planner/${planId}`)}>
            プランへ
          </Button>
        </div>
      </nav>

      {stampEvent && (
        <StampDialog planId={planId} dayId={g?.day_id ?? null} event={stampEvent} stamp={stamps[stampEvent.id]} canEdit
          voice={settings.voice} timeZone={timeZone} onClose={() => setStampFor(null)} onChanged={() => { void reloadGuide(); }} />
      )}
      <TabichoDialog open={bookOpen} onClose={() => setBookOpen(false)} title={g?.day_title || trip.title || '今日の旅'}
        dateLabel={[data?.today_date, dayLabel].filter(Boolean).join(' ・ ')} events={allToday} stamps={stamps} timeZone={timeZone}
        onOpen={(id) => { setBookOpen(false); setStampFor(id); }} planId={planId} />
      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} planId={planId} next={nextEv} lodging={lodging}
        phone={nextEv ? gEvents[nextEv.id]?.phone ?? null : null} onPlanB={goPlanB} onTransit={() => setTransit(true)}
        onTabicho={() => setBookOpen(true)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={setSettings}
        simple={simple} onSimple={toggleSimple} />
      {transit && nextEv && (
        <TransitMode next={nextEv} go={go} nowMs={nowMs} timeZone={timeZone} voice={settings.voice} onClose={() => setTransit(false)} />
      )}
    </div>
  );
};

export default TodayPage;
