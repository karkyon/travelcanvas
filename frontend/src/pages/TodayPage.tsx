/**
 * TodayPage (SC-07) - FR-029当日モードのNOW/NEXT画面。
 *
 * [Gate L1] backend/app/api/v1/plans.py の GET /plans/{planId}/today を
 * 表示する。DOC-02 FR-029「起動直後に今日、NOW、NEXT、出発まで、遅延、
 * 必要チケットを表示する」/ DOC-04 UI設計原則3「重要情報1操作: NOW/NEXT
 * から地図、予約、チケット、電話へ1操作」に対応する最小実装。
 *
 * 本Gateのスコープ: NOW/NEXT表示、出発までのカウントダウン、チケット有無
 * のバッジと1操作導線(地図・予約詳細)。
 *
 * [Gate L1b] 時刻を端末ではなく日程のIANAタイムゾーンの現地時刻で表示し、
 * NOW/NEXTを取得済みの今日の予定から端末側で再計算する(pages/today/todayModel.ts)。
 * 到着予定へ向かう移動区間の出発時刻・遅延/運休(登録済みの経路区間の
 * realtime_status)を表示し、通信できない場合は端末に保存した直近の当日情報
 * からNOW/NEXTを表示する(FR-032、最終取得時刻を明示)。外部providerからの
 * 遅延情報の取得自体は別Gateとする。DOC-04 §16「アクセシブル当日モード」の完全な読み上げ順
 * 最適化・触覚通知等も別Gateとし、本Gateでは大きな文字・高コントラスト
 * の基本方針(text-2xl以上、明確な状態色)のみ適用する。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, Ticket as TicketIcon, RefreshCw, Clock, WifiOff } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getToday } from '@/services/api';
import type { TodayEvent, TodayResponse } from '@/services/api';
import {
  TRANSPORT_LABELS, computeTodayView, formatCountdown, formatTimeInZone, loadTodayCache, saveTodayCache,
} from './today/todayModel';

// [Gate L1] DOC-04 §16に準拠し、当日画面は一定間隔で自動更新する
// (旅行者がアプリを開いたままにする想定のため、明示的なreloadを要求しない)。
const REFRESH_INTERVAL_MS = 30_000;
// [Gate L1b] 再取得の合間もNOW/NEXT・カウントダウンを進めるための再計算間隔。
const TICK_INTERVAL_MS = 15_000;

function mapUrl(event: TodayEvent): string | null {
  if (event.latitude == null || event.longitude == null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`;
}

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

const EventCard: React.FC<{
  label: string;
  labelColor: string;
  event: TodayEvent;
  timeZone: string | null;
  countdown?: string;
  planId: string;
}> = ({ label, labelColor, event, timeZone, countdown, planId }) => {
  const navigate = useNavigate();
  const map = mapUrl(event);
  const transport = event.transport_status ? TRANSPORT_LABELS[event.transport_status] : undefined;

  return (
    <Card padding="lg" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold px-3 py-1 rounded-full ${labelColor}`}>{label}</span>
          {transport && (
            <span className={`text-sm font-bold px-3 py-1 rounded-full ${transport.className}`}>
              {transport.text}
            </span>
          )}
        </div>
        {countdown && (
          <span className="flex items-center gap-1 text-gray-600 text-lg">
            <Clock size={18} aria-hidden="true" />
            {countdown}
          </span>
        )}
      </div>
      <div>
        <div className="text-3xl font-bold text-gray-900 break-words">{event.title}</div>
        <div className="text-xl text-gray-600 mt-1">
          {formatTimeInZone(event.start_at, timeZone)}
          {event.end_at && ` 〜 ${formatTimeInZone(event.end_at, timeZone)}`}
        </div>
        {event.departure_at && (
          <div className="text-lg text-gray-700 mt-1">出発 {formatTimeInZone(event.departure_at, timeZone)}</div>
        )}
        {event.address && (
          <div className="text-lg text-gray-600 mt-1 break-words">{event.address}</div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 pt-2">
        {map && (
          <Button
            variant="primary"
            size="lg"
            icon={<MapPin size={20} />}
            onClick={() => window.open(map, '_blank', 'noopener,noreferrer')}
          >
            地図
          </Button>
        )}
        {event.has_ticket && event.reservation_id && (
          <Button
            variant="outline"
            size="lg"
            icon={<TicketIcon size={20} />}
            onClick={() => navigate(`/planner/${planId}/reservations`)}
          >
            チケット
          </Button>
        )}
      </div>
    </Card>
  );
};

interface Snapshot {
  data: TodayResponse;
  /** server_time - 端末時刻(ms)。端末の時計のずれを補正する。 */
  offsetMs: number;
  /** 取得した時刻(端末時刻、ms) */
  fetchedAt: number;
}

const TodayPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
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
      saveTodayCache(planId, res, offsetMs);
    } catch (e: unknown) {
      // 取得に失敗しても、表示中または端末に保存済みの当日情報があればそれを表示し続ける
      const fallback =
        snapshotRef.current ??
        (() => {
          const cached = loadTodayCache(planId);
          return cached ? { data: cached.payload, offsetMs: cached.offsetMs, fetchedAt: cached.savedAt } : null;
        })();
      if (fallback) {
        snapshotRef.current = fallback;
        setSnapshot(fallback);
        setIsStale(true);
        setError(null);
      } else {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(typeof detail === 'string' && detail ? detail : '当日情報の取得に失敗しました');
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

  if (!planId) {
    return (
      <div className="p-8 text-center text-gray-500">
        プランが選択されていません。
        <div className="mt-4">
          <Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button>
        </div>
      </div>
    );
  }

  const data = snapshot?.data ?? null;
  const view = snapshot ? computeTodayView(snapshot.data, clock + snapshot.offsetMs) : null;
  const timeZone = data?.timezone_id ?? null;
  const showZoneNote = !!timeZone && timeZone !== deviceTimeZone();
  const nextCountdown = view
    ? view.minutesUntilDeparture != null
      ? `出発 ${formatCountdown(view.minutesUntilDeparture)}`
      : formatCountdown(view.minutesUntilNext)
    : '';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">
            ← プランへ戻る
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">今日</h1>
          {data?.today_date && (
            <p className="text-sm text-gray-600 mt-1">
              {data.today_date}
              {showZoneNote && ` ・ 時刻は現地時間(${timeZone})`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          aria-label="更新"
          className="text-gray-500 hover:text-blue-600 p-2"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {isStale && snapshot && (
        <div role="status" className="mb-4 p-3 rounded-lg bg-amber-50 text-amber-900 text-sm flex items-start gap-2">
          <WifiOff size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            {offline ? 'オフラインのため、' : '最新の当日情報を取得できないため、'}
            保存済みの情報を表示しています(最終取得 {formatTimeInZone(new Date(snapshot.fetchedAt).toISOString(), timeZone)})
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : !data || !view ? null : !view.isCurrentDay ? (
        <Card padding="lg" className="text-center text-gray-600 text-lg">
          保存済みの当日情報は{data.today_date}のものです。通信できる場所で更新してください。
        </Card>
      ) : !data.today_date && !view.nowEvent ? (
        <Card padding="lg" className="text-center text-gray-600 text-lg">
          今日の日程は登録されていません。
        </Card>
      ) : (
        <div className="space-y-4">
          {view.nowEvent ? (
            <EventCard
              label="NOW"
              labelColor="bg-green-100 text-green-800"
              event={view.nowEvent}
              timeZone={timeZone}
              planId={planId}
            />
          ) : (
            <Card padding="lg" className="text-center text-gray-600 text-lg">
              現在進行中の予定はありません
            </Card>
          )}

          {view.nextEvent ? (
            <EventCard
              label="NEXT"
              labelColor="bg-blue-100 text-blue-800"
              event={view.nextEvent}
              timeZone={timeZone}
              countdown={nextCountdown}
              planId={planId}
            />
          ) : data.today_date ? (
            <Card padding="lg" className="text-center text-gray-600 text-lg">
              本日、これ以降の予定はありません
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default TodayPage;
