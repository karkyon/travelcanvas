/**
 * [Gate G10-UX] UX-5 当日の画面(SC-07)の部品。DOC-04 §1(重要情報1操作)・§14(片手・親指の届く所)・§16(アクセシブル当日モード)。
 *
 * - 読み上げの順: 今(NOW)→ 次(NEXT。出発まで)→ この後の予定。時刻・場所・次の行動を先頭に
 * - 状態は色だけで伝えない(NOW・NEXT・遅延・保存済み は必ず文字を付ける)
 * - 主な操作(地図・チケット)は 48px 以上の高さ。スマホでは画面の下に「対応・プラン」の帯を固定する
 * - 色・面はデザインの決まり(tokens・Surface)だけ。暗い見た目でも同じ部品で読める
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, MapPin, Navigation, Ticket as TicketIcon } from 'lucide-react';
import Button from '@/components/common/Button';
import Surface from '@/components/design/Surface';
import type { TodayEvent } from '@/services/api';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { TRANSPORT_LABELS, formatTimeInZone, mapUrl, timeRange } from './todayModel';

const KIND = {
  now: { label: 'NOW', note: '進行中', chip: 'bg-success-soft text-success border border-success' },
  next: { label: 'NEXT', note: '次の予定', chip: 'bg-info-soft text-info border border-info' },
} as const;

export const EventCard: React.FC<{
  kind: 'now' | 'next';
  event: TodayEvent;
  timeZone: string | null;
  planId: string;
  countdown?: string;
  progress?: { minutesLeft: number; percent: number } | null;
}> = ({ kind, event, timeZone, planId, countdown, progress }) => {
  const navigate = useNavigate();
  const map = mapUrl(event);
  const transport = event.transport_status ? TRANSPORT_LABELS[event.transport_status] : undefined;
  const k = KIND[kind];
  const headingId = `today-${kind}-title`;
  return (
    <Surface
      as="section"
      variant="solid"
      padding="lg"
      className={`space-y-3 ${kind === 'now' ? 'border-l-4 border-l-success' : 'border-l-4 border-l-info'}`}
      aria-labelledby={headingId}
      data-testid={`today-${kind}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-bold px-3 py-1 rounded-full ${k.chip}`}>{k.label}</span>
          <span className="text-sm text-ink-700">{k.note}</span>
          {transport && (
            <span className={`text-sm font-bold px-3 py-1 rounded-full ${transport.className}`}>{transport.text}</span>
          )}
        </div>
        {countdown && (
          <span className="flex items-center gap-1 text-xl font-bold text-ink-900" data-testid="today-countdown">
            <Clock size={20} aria-hidden="true" />
            {countdown}
          </span>
        )}
      </div>
      <div>
        <h2 id={headingId} className="text-3xl font-bold text-ink-900 wrap-break-word">{event.title}</h2>
        <div className="text-xl text-ink-700 mt-1">{timeRange(event, timeZone)}</div>
        {event.departure_at && (
          <div className="text-lg text-ink-900 mt-1 font-medium">出発 {formatTimeInZone(event.departure_at, timeZone)}</div>
        )}
        {event.address && (
          <div className="text-lg text-ink-700 mt-1 wrap-break-word flex items-start gap-1">
            <MapPin size={18} aria-hidden="true" className="mt-1 shrink-0" />
            <span>{event.address}</span>
          </div>
        )}
      </div>
      {progress && (
        <div>
          <div className="flex justify-between text-sm text-ink-700 mb-1">
            <span>{`残り ${progress.minutesLeft}分`}</span>
            <span>{`${progress.percent}%`}</span>
          </div>
          <div
            className="h-2 rounded-full bg-cloud-200 overflow-hidden"
            role="progressbar"
            aria-label="今の予定の進み"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
          >
            <div className="h-full bg-success" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {map && (
          <Button
            variant="primary"
            size="lg"
            icon={<Navigation size={20} />}
            onClick={() => window.open(safeExternalUrl(map) ?? undefined, '_blank', 'noopener,noreferrer')}
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
    </Surface>
  );
};

/** NEXT の後の今日の予定(簡易表示では出さない) */
export const LaterList: React.FC<{ events: TodayEvent[]; timeZone: string | null }> = ({ events, timeZone }) => {
  if (events.length === 0) return null;
  return (
    <Surface as="section" variant="quiet" padding="md" aria-labelledby="today-later-title" data-testid="today-later">
      <h2 id="today-later-title" className="text-lg font-semibold text-ink-900 mb-2">この後の予定</h2>
      <ol className="divide-y divide-cloud-200" aria-label="この後の予定">
        {events.map((e) => (
          <li key={e.id} className="py-2 flex items-baseline gap-3">
            <span className="text-base font-semibold text-ink-900 tabular-nums w-28 shrink-0">{timeRange(e, timeZone)}</span>
            <span className="text-base text-ink-900 wrap-break-word min-w-0">{e.title}</span>
            {e.has_ticket && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-accent-soft text-accent-strong shrink-0">チケット</span>}
          </li>
        ))}
      </ol>
    </Surface>
  );
};
