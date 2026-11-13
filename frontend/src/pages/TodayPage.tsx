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
 *
 * [Gate TDay-Mock] モックアップ(36 画面)どおりの並び: スマホは 1 列 + 下の操作(写真・ひとこと/お助け/チケット)と
 * 「当日の画面」(今日/地図/旅帖/旅程)、タブレットは 2 列、タブレット横は左の列 + 地図、PC は 3 列 + 旅帖・お助け。
 * 開く画面(出発の合図・移動モード・次の場所・印・この場所に残す・旅帖・旅程・地図・寄り道・雨の兆し・遅れの知らせ・
 * チケット・出発前のチェック・写真を集める・宿・宿へ帰る・同行者・お助け・設定)は URL の ?v= で開き、戻るで閉じる。
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Camera, Luggage, PartyPopper } from 'lucide-react';
import Button from '@/components/common/Button';
import Surface from '@/components/design/Surface';
import { useTripContext } from '@/hooks/useTripContext';
import { getToday } from '@/services/api';
import type { TodayResponse } from '@/services/api';
import { currentOfflineSession } from '@/utils/offlineSession';
import { loadQueue } from '@/utils/syncQueue';
import { flushMemoQueue, loadMemoQueue } from '@/utils/memoQueue';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  computeTodayFlow, computeTodayView, formatTimeInZone, loadTodayCache, saveTodayCache,
} from './today/todayModel';
import { useTodayLive } from './today/live/useTodayLive';
import {
  addTrailPoint, dayPhase, distanceKm, goNowView, localHour, readDayFlag, readDismissed, readSettings, readTrail,
  writeDayFlag, writeDismissed, writeSettings, type LiveNotice, type LiveSettings, type TrailPoint,
} from './today/live/todayLive';
import type { DetourCandidate } from '@/services/api/travelDay';
import { LiveNotices } from './today/live/LivePanels';
import { CrewCard, DetourCard, GoCard, HelpCard, MapCard, NowCard, RainCard, SkyCard, TabichoCard, TeaserCard, TodayBand, TodayDock, TodayHero, TodayToolbar } from './today/live/TodayDash';
import { shareMyEta, useCrew } from './today/live/todayHelpers';
import {
  BeforeTripView, FinishView, FreeDayView, LoadFailedView, LoadingView, MorningView, NightView, OfflineBar, OfflineView, SimpleView,
} from './today/live/TodayViews';
import { TAB_SCREENS, TODAY_SCREENS, type TodayCtx, type TodayScreen } from './today/live/todayCtx';
import { localToday, tripDayHeading } from './today/tripDayModel';

// [Gate TDay-Mock] 開く画面は後から読む(当日の画面の最初の読み込みを重くしない)
const TodayScreens = React.lazy(() => import('./today/live/TodayScreens'));

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

const TodayPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const trip = useTripContext(planId);
  const [params, setParams] = useSearchParams();

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [simple, setSimple] = useState<boolean>(readSimple);
  const [memoPending, setMemoPending] = useState(0);
  const [memoSent, setMemoSent] = useState(0);
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
      // [Gate Remaining-1] 通信できない間に置いた写真・ひとことを送る
      void flushMemoQueue(currentOfflineSession(), planId).then((r) => {
        setMemoPending(r.left);
        if (r.sent > 0) setMemoSent((n) => n + r.sent);
      }).catch(() => undefined);
    } catch (e: unknown) {
      // 取得に失敗しても、表示中または端末に保存済みの当日情報があればそれを表示し続ける
      let fallback = snapshotRef.current;
      if (!fallback) {
        const cached = await loadTodayCache(currentOfflineSession(), planId);
        fallback = cached ? { data: cached.payload, offsetMs: cached.offsetMs, fetchedAt: cached.savedAt } : null;
      }
      void loadMemoQueue(currentOfflineSession(), planId).then((q) => setMemoPending(q.length)).catch(() => undefined);
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

  const toggleSimple = useCallback(() => {
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
  }, []);

  // [Gate TDay] 旅帖ライブの状態(手がかり・空模様・設定・閉じた知らせ)
  const { guide, sky, reloadGuide } = useTodayLive(planId, snapshot?.data.today_date ?? null, isStale);
  const [settings, setSettingsState] = useState<LiveSettings>(readSettings);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [detourPins, setDetourPins] = useState<DetourCandidate[]>([]);
  const [flagTick, setFlagTick] = useState(0);
  const setSettings = useCallback((v: LiveSettings) => { setSettingsState(v); writeSettings(v); }, []);
  const dismiss = (key: string) => setDismissed((prev) => {
    const next = new Set(prev);
    next.add(key);
    writeDismissed(next);
    return next;
  });
  const refreshAll = useCallback(() => { void load(); void reloadGuide(); }, [load, reloadGuide]);
  // 置いていた写真・ひとことを送れたら、旅帖の手がかりを読み直す
  useEffect(() => { if (memoSent > 0) void reloadGuide(); }, [memoSent, reloadGuide]);
  const crew = useCrew(planId ?? '', isStale || !planId);

  // [Gate TDay-Mock] 開く画面(?v=画面&e=予定)。開いた数を覚え、閉じる時は戻る(ブラウザの戻ると同じ)
  const rawScreen = params.get('v');
  const screen = rawScreen && (TODAY_SCREENS as string[]).includes(rawScreen) ? (rawScreen as TodayScreen) : null;
  const screenArg = params.get('e');
  const depth = useRef(0);
  useEffect(() => { if (!screen) depth.current = 0; }, [screen]);
  const openScreen = useCallback((s: TodayScreen, eventId?: string | null) => {
    const p = new URLSearchParams(params);
    p.set('v', s);
    if (eventId) p.set('e', eventId); else p.delete('e');
    const swap = !!screen && TAB_SCREENS.includes(screen) && TAB_SCREENS.includes(s);
    if (!swap) depth.current += 1;
    setParams(p, { replace: swap });
  }, [params, screen, setParams]);
  const closeScreen = useCallback(() => {
    if (depth.current > 0) {
      depth.current -= 1;
      navigate(-1);
      return;
    }
    const p = new URLSearchParams(params);
    p.delete('v');
    p.delete('e');
    setParams(p, { replace: true });
  }, [navigate, params, setParams]);

  // [Gate TDay-Mock] 位置(既定は OFF)。ON にした人だけ、この端末の中で足跡を描き・着いた提案に使う(送らない)
  const dateKey = snapshot?.data.today_date ?? '';
  const [trail, setTrail] = useState<TrailPoint[]>(() => (planId ? readTrail(planId, snapshot?.data.today_date ?? null) : []));
  const [here, setHere] = useState<[number, number] | null>(null);
  useEffect(() => { if (planId) setTrail(readTrail(planId, dateKey || null)); }, [planId, dateKey]);
  useEffect(() => {
    if (!planId || !dateKey || !(settings.location.trail || settings.location.arrive)) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition((pos) => {
      const pt: TrailPoint = [pos.coords.latitude, pos.coords.longitude, Date.now()];
      setHere([pt[0], pt[1]]);
      if (settings.location.trail) setTrail(addTrailPoint(planId, dateKey, pt));
    }, () => undefined, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [planId, dateKey, settings.location.trail, settings.location.arrive]);

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
  const phase = view?.isCurrentDay ? dayPhase(g, allToday, nowMs, !!nowEv, !!nextEv) : 'none';
  const gap = g?.gaps.find((x) => Date.parse(x.end_at) > nowMs) ?? null;
  const lodging = g?.lodging ?? null;
  const lodgingEvent = (lodging ? allToday.find((e) => e.id === lodging.event_id) : null)
    ?? [...allToday].reverse().find((e) => /accommodation|lodging|hotel/.test(e.event_type)) ?? null;
  const dayLabel = g?.day_index ? `DAY ${g.day_index} / ${g.day_count}` : null;
  const delayed = allToday.some((e) => e.transport_status === 'delayed' || e.transport_status === 'cancelled');
  void flagTick;
  // [Gate TripDayNav] 見出しは「今日」ではなく、旅の当日らしく(何日目か・当日まであと何日か・旅のあと)
  const heading = tripDayHeading({ todayDate: data?.today_date ?? null, start: trip.startDate, end: trip.endDate,
    deviceToday: localToday(new Date(nowMs)) });

  const ctx: TodayCtx | null = data ? {
    planId, data, events: allToday, timeZone, nowMs, nowLocal, nowEv, nextEv, flow, go, guide: g, gEvents, stamps, doneIds,
    visitedIds, rainIds, sky, hours, nowHour, upcomingRain, gap, lodging, lodgingEvent, dayLabel,
    dayTitle: g?.day_title || trip.title || '今日の旅', tripTitle: trip.title ?? null, destination: trip.destination ?? null,
    stale: isStale, fetchedAt: snapshot?.fetchedAt ?? null, delayed, settings, setSettings, simple, toggleSimple,
    detourPins, setDetourPins, trail, pendingCount: loadQueue(planId).length + memoPending, memoPending,
    onMemoQueued: setMemoPending,
    open: openScreen, close: closeScreen, refresh: refreshAll, reloadGuide: () => { void reloadGuide(); },
  } : null;

  const notices: LiveNotice[] = [];
  if (ctx && view?.isCurrentDay && !simple && !screen) {
    if (settings.notices.delay && nextEv && (nextEv.transport_status === 'delayed' || nextEv.transport_status === 'cancelled')) {
      notices.push({ key: `${dateKey}:delay:${nextEv.id}`, kind: 'delay', title: nextEv.transport_status === 'cancelled' ? '移動の便が運休' : '移動の便が遅れています',
        sub: `${nextEv.title} へ向かう経路`, action: '組み直す', onAction: () => openScreen('delay') });
    }
    if (settings.notices.go && go && nextEv && (go.stage === 'soon' || go.stage === 'now')) {
      notices.push({ key: `${dateKey}:go:${nextEv.id}:${go.stage}`, kind: 'go', title: go.stage === 'now' ? '今が出発の時間' : 'そろそろ出発の時間',
        sub: `${formatTimeInZone(go.leaveBy, timeZone)} に出ると ${formatTimeInZone(nextEv.start_at, timeZone)} 着`, action: '案内',
        onAction: () => openScreen('go') });
    }
    const near = here && settings.location.arrive
      ? [nowEv, nextEv].find((e) => e && !visitedIds.has(e.id) && (distanceKm({ latitude: here[0], longitude: here[1] }, e) ?? 9) < 0.15) ?? null
      : null;
    const arriveEv = near ?? (nowEv && stamps[nowEv.id] && stamps[nowEv.id]!.status !== 'visited' ? nowEv : null);
    if (settings.notices.arrive && arriveEv) {
      notices.push({ key: `${dateKey}:arrive:${arriveEv.id}`, kind: 'arrive', title: '着きましたか?', sub: `${arriveEv.title} ・ 印を押せます`,
        action: '押す', onAction: () => openScreen('stamp', arriveEv.id) });
    }
    if (settings.notices.rain && upcomingRain && upcomingRain.start_at && Date.parse(upcomingRain.start_at) - nowMs < 2 * 3600_000) {
      const hrs = Math.max(1, Math.round((Date.parse(upcomingRain.start_at) - nowMs) / 3600_000));
      notices.push({ key: `${dateKey}:rain:${upcomingRain.id}`, kind: 'rain', title: `${hrs}時間後に雨の可能性`,
        sub: `${formatTimeInZone(upcomingRain.start_at, timeZone)} ${upcomingRain.title}は屋外です`, action: 'プランB', onAction: () => openScreen('rain') });
    }
    if (settings.notices.detour && gap && !isStale && Date.parse(gap.start_at) - nowMs < 30 * 60_000) {
      notices.push({ key: `${dateKey}:detour:${gap.after_event_id}`, kind: 'detour', title: '寄り道チャンス',
        sub: `${formatTimeInZone(gap.start_at, timeZone)}〜${formatTimeInZone(gap.end_at, timeZone)} に${gap.minutes}分の空き`, action: '見る',
        onAction: () => openScreen('detour') });
    }
  }
  const shownNotices = notices.filter((n) => !dismissed.has(n.key)).slice(0, 3);
  const shareEta = async () => {
    if (!ctx) return;
    try {
      crew.setShares(await shareMyEta(ctx));
      openScreen('crew');
    } catch {
      openScreen('crew');
    }
  };
  const flagKey = (k: string) => `${k}.${planId}.${dateKey}`;
  const dropFlag = (k: string) => { writeDayFlag(flagKey(k)); setFlagTick((v) => v + 1); };
  const live = !!(ctx && view?.isCurrentDay && allToday.length > 0);
  const tabCurrent = screen && TAB_SCREENS.includes(screen) ? screen : 'today';

  let main: React.ReactNode = null;
  // [Gate TDay-Mock] 自分の見出し(h1)を持たない表示(読み込み中・取得できない・旅の前・日程が無い)は、読み上げ用に「今日」を置く
  let ownHeading = false;
  if (isLoading) main = <LoadingView />;
  else if (error && !data) main = <LoadFailedView planId={planId} error={error} onRetry={() => { setIsLoading(true); void load(); }} />;
  else if (!data || !view || !ctx) main = null;
  else if (!view.isCurrentDay) main = <Notice>保存済みの当日情報は{data.today_date}のものです。通信できる場所で更新してください。</Notice>;
  else if (!data.today_date && !view.nowEvent) {
    ownHeading = !!g?.upcoming;
    main = g?.upcoming ? <BeforeTripView planId={planId} upcoming={g.upcoming} title={trip.title ?? 'この旅行'} destination={trip.destination ?? null} /> : (
      <div className={`tc-card tc-today-empty is-${heading.phase}`} data-testid="today-empty" data-phase={heading.phase}>
        {heading.phase === 'after' ? <Camera size={28} aria-hidden="true" />
          : heading.phase === 'before' ? <PartyPopper size={28} aria-hidden="true" /> : <CalendarDays size={28} aria-hidden="true" />}
        {heading.phase === 'before' ? (
          <>
            {heading.daysLeft !== null && (
              <p className="tc-today-countdown" data-testid="today-days-left"><b>{heading.daysLeft}</b><span>日</span></p>
            )}
            <p className="font-semibold text-ink-900">この日のために準備してきた旅、もうすぐです！</p>
            <p className="text-sm text-ink-500">当日になると、今いる予定・次の予定・出発までの時間がここに出ます。</p>
            <div className="tc-today-empty-actions">
              <Button variant="primary" icon={<CalendarDays size={16} />} onClick={() => navigate(`/planner/${planId}`)}>旅程を見直す</Button>
              <Button variant="outline" icon={<Luggage size={16} />} onClick={() => navigate(`/planner/${planId}/preparation`)}>持ち物・準備</Button>
            </div>
          </>
        ) : heading.phase === 'after' ? (
          <>
            <p className="font-semibold text-ink-900">楽しい旅でしたか？ 写真や記録を思い出にまとめましょう。</p>
            <div className="tc-today-empty-actions">
              <Button variant="primary" icon={<Camera size={16} />} onClick={() => navigate(`/planner/${planId}/memories`)}>旅の記録と思い出</Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-semibold text-ink-900">今日の日程は登録されていません。</p>
            <p className="text-sm text-ink-500">旅行の日付の当日になると、今いる予定と次の予定がここに出ます。</p>
          </>
        )}
      </div>
    );
  } else if (allToday.length === 0) { main = <FreeDayView ctx={ctx} />; ownHeading = true; }
  else if (simple) { main = <SimpleView ctx={ctx} />; ownHeading = true; }
  else if (isStale) main = <OfflineView ctx={ctx} />;
  else if (phase === 'morning' && nextEv && !readDayFlag(flagKey('morning'))) { main = <MorningView ctx={ctx} onToday={() => dropFlag('morning')} />; ownHeading = true; }
  else if (phase === 'finished' && g && !readDayFlag(flagKey('night'))) { main = <FinishView ctx={ctx} onToday={() => dropFlag('night')} />; ownHeading = true; }
  else if (phase === 'night' && g && !readDayFlag(flagKey('night'))) { main = <NightView ctx={ctx} onToday={() => dropFlag('night')} />; ownHeading = true; }
  else {
    ownHeading = true;
    main = (
      <>
        <TodayHero ctx={ctx} showZoneNote={showZoneNote} />
        <div className="tl-grid">
          <div className="tl-col tl-col--a">
            {nextEv ? <GoCard ctx={ctx} onShareEta={() => void shareEta()} />
              : <section className="tl-card tl-ord-go" data-testid="today-next-none"><p className="tl-small">本日、これ以降の予定はありません</p></section>}
            <NowCard ctx={ctx} />
            <CrewCard ctx={ctx} crew={crew} />
          </div>
          <div className="tl-col tl-col--b">
            <TeaserCard ctx={ctx} />
            <span className="tl-pc-block"><SkyCard ctx={ctx} /></span>
            <RainCard ctx={ctx} />
          </div>
          <div className="tl-col tl-col--c">
            <MapCard ctx={ctx} />
            <DetourCard ctx={ctx} />
          </div>
          <div className="tl-col tl-col--d">
            <TabichoCard ctx={ctx} />
            <HelpCard ctx={ctx} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className={`tc-page tc-today tl-page${live && !simple ? ' has-dock' : ''}`} data-testid="today">
      {!ownHeading && (
        <div className="tl-page__head">
          <p className="tl-lbl">{heading.eyebrow}</p>
          <h1 className="tl-title tl-title--lg tl-page__h1">{heading.title}</h1>
        </div>
      )}
      {ctx && view?.isCurrentDay && (nowEv || nextEv) && <TodayBand ctx={ctx} />}
      {ctx && <TodayToolbar ctx={ctx} syncedAt={syncedAt} />}
      {ctx && isStale && <OfflineBar ctx={ctx} />}
      {error && data && <div role="alert" className="tl-card tl-card--warn tl-small">{error}</div>}
      <LiveNotices items={shownNotices} onDismiss={dismiss} />
      {main}
      {live && !simple && ctx && <TodayDock ctx={ctx} current={tabCurrent} />}
      {ctx && screen && (
        <Suspense fallback={<div className="tl-screen tl-screen--loading" role="status" aria-busy="true">読み込み中…</div>}>
          <TodayScreens ctx={ctx} screen={screen} arg={screenArg} crew={crew}
            onPrepared={() => { dropFlag('morning'); closeScreen(); }} />
        </Suspense>
      )}
    </div>
  );
};

export default TodayPage;
