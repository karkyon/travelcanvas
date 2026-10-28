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
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ListChecks, RefreshCw, WifiOff } from 'lucide-react';
import Button from '@/components/common/Button';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import Surface from '@/components/design/Surface';
import { getToday } from '@/services/api';
import type { TodayResponse } from '@/services/api';
import { currentOfflineSession } from '@/utils/offlineSession';
import {
  computeTodayFlow, computeTodayView, formatCountdown, formatTimeInZone, loadTodayCache, saveTodayCache,
} from './today/todayModel';
import { EventCard, LaterList } from './today/TodayParts';
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
  <Surface variant="solid" padding="lg" className="text-center text-ink-700 text-lg">{children}</Surface>
);

const TodayPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

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

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-cloud-50 text-ink-900" data-testid="today">
      <div className="max-w-2xl mx-auto px-4 pt-4 pb-28 sm:pb-8">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-1 -ml-2">
              ← プランへ戻る
            </Button>
            <h1 className="text-2xl font-bold text-ink-900">今日</h1>
            {data?.today_date && (
              <p className="text-sm text-ink-700 mt-1">
                {data.today_date}
                {showZoneNote && ` ・ 時刻は現地時間(${timeZone})`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {data && (
              <span
                className={`inline-flex items-center gap-1 text-sm font-medium px-2 py-1 rounded-full border ${isStale
                  ? 'bg-warning-soft text-warning border-warning' : 'bg-success-soft text-success border-success'}`}
                data-testid="today-sync"
              >
                {isStale ? <WifiOff size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
                {isStale ? '保存済み' : '最新'}
              </span>
            )}
            <button
              type="button"
              onClick={load}
              aria-label="更新"
              className="tc-focus-ring inline-flex items-center justify-center w-11 h-11 rounded-lg text-ink-700 hover:bg-cloud-100"
            >
              <RefreshCw size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

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

        {isLoading ? (
          <div className="flex justify-center py-16" role="status" aria-label="読み込み中"><LoadingSpinner size="lg" /></div>
        ) : !data || !view ? null : !view.isCurrentDay ? (
          <Notice>保存済みの当日情報は{data.today_date}のものです。通信できる場所で更新してください。</Notice>
        ) : !data.today_date && !view.nowEvent ? (
          <Notice>今日の日程は登録されていません。</Notice>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-700" data-testid="today-summary">
                {flow && flow.doneCount > 0 ? `済んだ予定 ${flow.doneCount}件` : '今日の予定'}
                {flow && !simple && flow.later.length > 0 ? ` ・ この後 ${flow.later.length}件` : ''}
              </p>
              <button
                type="button"
                onClick={toggleSimple}
                aria-pressed={simple}
                className="tc-focus-ring inline-flex items-center gap-1 min-h-11 px-3 rounded-lg border border-cloud-200 bg-cloud-0 text-sm text-ink-900 hover:bg-cloud-100"
              >
                <ListChecks size={16} aria-hidden="true" />
                {simple ? '簡易表示: 入' : '簡易表示'}
              </button>
            </div>

            {view.nowEvent ? (
              <EventCard kind="now" event={view.nowEvent} timeZone={timeZone} planId={planId} progress={flow?.nowProgress} />
            ) : (
              <Notice>現在進行中の予定はありません</Notice>
            )}

            {view.nextEvent ? (
              <EventCard kind="next" event={view.nextEvent} timeZone={timeZone} countdown={nextCountdown} planId={planId} />
            ) : data.today_date ? (
              <Notice>本日、これ以降の予定はありません</Notice>
            ) : null}

            {!simple && flow && <LaterList events={flow.later} timeZone={timeZone} />}
          </div>
        )}

        {/* 親指の届く所(スマホでは画面の下に固定。広い画面では本文の下) */}
        <nav
          aria-label="当日の操作"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-cloud-200 bg-cloud-0/95 px-4 py-3 sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-2xl mx-auto flex gap-2">
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
      </div>
    </div>
  );
};

export default TodayPage;
