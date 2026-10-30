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
  const start = formatTimeInZone(event.start_at, timeZone);
  const end = event.end_at ? formatTimeInZone(event.end_at, timeZone) : null;
  return (
    <section
      className={`tc-card tc-now-card ${kind === 'next' ? 'is-next' : ''}`}
      aria-labelledby={headingId}
      data-testid={`today-${kind}`}
    >
      {/* [Gate MockScreens] モックの now-card: 小見出し・大きな時刻・題・場所と時間・状態・主な操作 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tc-label">{kind === 'now' ? 'NOW · いま' : 'NEXT · 次に向かう場所'}<span className="sr-only">{`(${k.note})`}</span></p>
        {countdown && (
          <span className="tc-now-countdown" data-testid="today-countdown">
            <Clock size={16} aria-hidden="true" />
            {countdown}
          </span>
        )}
      </div>
      {kind === 'now' && <div className="tc-big-time">{start}</div>}
      <h2 id={headingId} className="tc-now-title">{event.title}</h2>
      <p className="tc-now-meta">
        {kind === 'now' ? (end ? <span>{`〜 ${end}`}</span> : null) : <span>{timeRange(event, timeZone)}</span>}
        {event.address && (
          <span className="inline-flex items-start gap-1"><MapPin size={14} aria-hidden="true" className="mt-0.5 shrink-0" />{event.address}</span>
        )}
      </p>
      {event.departure_at && (
        <p className="tc-now-depart">出発 {formatTimeInZone(event.departure_at, timeZone)}</p>
      )}
      {transport && (
        <span className={`tc-pill ${transport.tone}`}>{transport.text}</span>
      )}
      {progress && (
        <div className="mt-3">
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
      {(map || (event.has_ticket && event.reservation_id)) && (
        <div className="tc-now-actions">
          {map && (
            <button type="button" className={`tc-focus-ring tc-mbtn ${kind === 'now' ? 'tc-mbtn--coral' : ''}`}
              onClick={() => window.open(safeExternalUrl(map) ?? undefined, '_blank', 'noopener,noreferrer')}>
              <Navigation size={18} aria-hidden="true" />地図<span className="sr-only">(外の地図を新しいタブで開く)</span>
            </button>
          )}
          {event.has_ticket && event.reservation_id && (
            <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => navigate(`/planner/${planId}/reservations`)}>
              <TicketIcon size={18} aria-hidden="true" />チケット
            </button>
          )}
        </div>
      )}
    </section>
  );
};

/**
 * [Gate MockScreens] モックの「今日の旅程」: 今日の予定の全て(済・NOW・NEXT・チケットは文字で示す)。
 * 簡易表示では出さない。
 */
export const DayList: React.FC<{
  events: TodayEvent[];
  timeZone: string | null;
  nowId: string | null;
  nextId: string | null;
  doneIds: Set<string>;
}> = ({ events, timeZone, nowId, nextId, doneIds }) => (
  <section className="tc-card tc-today-list" aria-labelledby="today-list-title" data-testid="today-later">
    <div className="tc-section-row">
      <h2 id="today-list-title" className="tc-section-title">今日の旅程</h2>
      <span className="tc-pill">{`${events.length}件`}</span>
    </div>
    <ol aria-label="今日の旅程">
      {events.map((e) => {
        const state = e.id === nowId ? 'NOW' : e.id === nextId ? 'NEXT' : doneIds.has(e.id) ? '済' : null;
        return (
          <li key={e.id} data-state={state ?? undefined}>
            <span className="tc-today-time">{timeRange(e, timeZone)}</span>
            <span className="min-w-0">
              <b>{e.title}</b>
              {e.address && <small>{e.address}</small>}
            </span>
            <span className="tc-today-tags">
              {state && <span className={`tc-pill ${state === 'NOW' ? 'tc-pill--coral' : state === 'NEXT' ? 'tc-pill--blue' : ''}`}>{state}</span>}
              {e.has_ticket && <span className="tc-pill tc-pill--good">チケット</span>}
            </span>
          </li>
        );
      })}
    </ol>
  </section>
);
