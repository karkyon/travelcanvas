/**
 * TodayPage (SC-07) - FR-029当日モードのNOW/NEXT画面。
 *
 * [Gate L1] backend/app/api/v1/plans.py の GET /plans/{planId}/today を
 * 表示する。DOC-02 FR-029「起動直後に今日、NOW、NEXT、出発まで、遅延、
 * 必要チケットを表示する」/ DOC-04 UI設計原則3「重要情報1操作: NOW/NEXT
 * から地図、予約、チケット、電話へ1操作」に対応する最小実装。
 *
 * 本Gateのスコープ: NOW/NEXT表示、出発までのカウントダウン、チケット有無
 * のバッジと1操作導線(地図・予約詳細)。外部の遅延情報統合(FR-030)・
 * オフライン表示(FR-032、既存のofflinePack機能と組み合わせて別途対応)は
 * 別Gateとする。DOC-04 §16「アクセシブル当日モード」の完全な読み上げ順
 * 最適化・触覚通知等も別Gateとし、本Gateでは大きな文字・高コントラスト
 * の基本方針(text-2xl以上、明確な状態色)のみ適用する。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, Ticket as TicketIcon, RefreshCw, Clock } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getToday } from '@/services/api';
import type { TodayEvent, TodayResponse } from '@/services/api';

// [Gate L1] DOC-04 §16に準拠し、当日画面は一定間隔で自動更新する
// (旅行者がアプリを開いたままにする想定のため、明示的なreloadを要求しない)。
const REFRESH_INTERVAL_MS = 30_000;

function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function formatCountdown(minutes: number | null): string {
  if (minutes == null) return '';
  if (minutes <= 0) return 'まもなく';
  if (minutes < 60) return `${minutes}分後`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間後` : `${h}時間${m}分後`;
}

function mapUrl(event: TodayEvent): string | null {
  if (event.latitude == null || event.longitude == null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`;
}

const EventCard: React.FC<{
  label: string;
  labelColor: string;
  event: TodayEvent;
  countdown?: string;
  planId: string;
}> = ({ label, labelColor, event, countdown, planId }) => {
  const navigate = useNavigate();
  const map = mapUrl(event);

  return (
    <Card padding="lg" className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={`text-sm font-bold px-3 py-1 rounded-full ${labelColor}`}>{label}</span>
        {countdown && (
          <span className="flex items-center gap-1 text-gray-500 text-lg">
            <Clock size={18} />
            {countdown}
          </span>
        )}
      </div>
      <div>
        <div className="text-3xl font-bold text-gray-900 break-words">{event.title}</div>
        <div className="text-xl text-gray-600 mt-1">
          {formatTime(event.start_at)}
          {event.end_at && ` 〜 ${formatTime(event.end_at)}`}
        </div>
        {event.address && (
          <div className="text-lg text-gray-500 mt-1 break-words">{event.address}</div>
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

const TodayPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<TodayResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    setError(null);
    try {
      const res = await getToday(planId);
      setData(res);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || '当日情報の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">
            ← プランへ戻る
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">今日</h1>
        </div>
        <button
          type="button"
          onClick={load}
          aria-label="更新"
          className="text-gray-400 hover:text-blue-600 p-2"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : !data || !data.today_date ? (
        <Card padding="lg" className="text-center text-gray-500 text-lg">
          今日の日程は登録されていません。
        </Card>
      ) : (
        <div className="space-y-4">
          {data.now_event ? (
            <EventCard
              label="NOW"
              labelColor="bg-green-100 text-green-800"
              event={data.now_event}
              planId={planId}
            />
          ) : (
            <Card padding="lg" className="text-center text-gray-400 text-lg">
              現在進行中の予定はありません
            </Card>
          )}

          {data.next_event ? (
            <EventCard
              label="NEXT"
              labelColor="bg-blue-100 text-blue-800"
              event={data.next_event}
              countdown={formatCountdown(data.minutes_until_next)}
              planId={planId}
            />
          ) : (
            <Card padding="lg" className="text-center text-gray-400 text-lg">
              本日、これ以降の予定はありません
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default TodayPage;
