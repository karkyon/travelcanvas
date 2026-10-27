/**
 * [Gate G9] UX-4 文脈型ダッシュボードの部品(表紙・NOW/NEXT・準備・遅延と休業・操作・旅行の一覧)。
 *
 * 色・面はデザインの決まり(tokens・Surface)だけを使う。暗い見た目(data-theme="dark")でも同じ部品で読める。
 * 状態は色だけで伝えず、文字(「重要」「対応中」など)を必ず添える。
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, ListChecks, Ticket, Users } from 'lucide-react';
import Surface from '@/components/design/Surface';
import TripCover from '@/components/trip/TripCover';
import { safeInternalPath } from '@/utils/safeNavigation';
import type { DashboardFocus, DashboardTrip } from '@/services/api/types/g9';
import {
  PHASE_LABEL, ROLE_LABEL, TRANSPORT_STATUS_LABEL, eventTime, groupTrips, minutesLabel, quickActions, statusLabel,
  tripDateLabel,
} from './dashboardModel';

const onCoverLink = 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-cloud-0 text-ink-900 '
  + 'hover:bg-cloud-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
const actionLink = 'tc-focus-ring flex items-center justify-between gap-2 rounded-lg border border-cloud-200 bg-cloud-0 '
  + 'px-4 py-3 text-sm font-medium text-ink-900 hover:bg-cloud-100';

const SEVERITY_LABEL: Record<string, string> = { high: '重要', medium: '確認', low: '参考' };

// ------------------------------------------------------------------ 表紙(最上段)

export const EmptyHero: React.FC<{ isGuest: boolean }> = ({ isGuest }) => (
  <TripCover as="section" size="hero" tripTitle="travelcanvas" aria-labelledby="dash-hero-empty" data-testid="dashboard-hero">
    <p className="text-sm font-medium">ようこそ</p>
    <h2 id="dash-hero-empty" className="mt-1 text-2xl sm:text-3xl font-bold" style={{ fontFamily: 'var(--tc-font-display)' }}>
      最初の旅行を始めましょう
    </h2>
    <p className="mt-2 text-sm max-w-xl">
      行き先と日付だけで始められます。予約・チケット・準備・費用は、あとから同じ旅行にまとまります。
    </p>
    <div className="mt-4 flex flex-wrap gap-2">
      <Link to="/planner" className={onCoverLink}>旅行を作る</Link>
      {isGuest && <Link to="/guest/upgrade" className={onCoverLink}>アカウントを作って保存する</Link>}
    </div>
  </TripCover>
);

export const TripHero: React.FC<{ trip: DashboardTrip }> = ({ trip }) => {
  const primary = trip.phase === 'ongoing'
    ? { to: `/planner/${trip.id}/today`, label: '今日の予定を見る' }
    : { to: `/planner/${trip.id}`, label: '旅程を開く' };
  return (
    <TripCover as="section" size="hero" destination={trip.destination} tripTitle={trip.title} startDate={trip.start_date}
      aria-labelledby="dash-hero-title" data-testid="dashboard-hero" data-phase={trip.phase}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <span className="rounded-full border border-white px-2 py-0.5" data-testid="dashboard-phase">{PHASE_LABEL[trip.phase]}</span>
        <span>{statusLabel(trip)}</span>
      </p>
      <h2 id="dash-hero-title" className="mt-2 text-2xl sm:text-3xl font-bold break-words"
        style={{ fontFamily: 'var(--tc-font-display)' }}>
        {trip.title}
      </h2>
      <p className="mt-1 text-sm">
        {[trip.destination, tripDateLabel(trip)].filter(Boolean).join('・')}
      </p>
      <p className="mt-1 text-sm flex items-center gap-1">
        <Users size={14} aria-hidden="true" />
        {`${trip.member_count}人・あなたは${ROLE_LABEL[trip.role]}`}
      </p>
      <div className="mt-4">
        <Link to={safeInternalPath(primary.to) ?? '/dashboard'} className={onCoverLink}>{primary.label}</Link>
      </div>
    </TripCover>
  );
};

// ------------------------------------------------------------------ 焦点の旅行の要約

const NowNextCard: React.FC<{ focus: DashboardFocus; trip: DashboardTrip }> = ({ focus, trip }) => {
  const t = focus.today;
  const tz = t?.timezone_id ?? trip.timezone_id;
  const row = (label: string, ev: NonNullable<typeof t>['now_event']) => ev && (
    <li className="py-2">
      <p className="text-xs font-semibold text-ink-700">{label}</p>
      <p className="font-medium text-ink-900">
        <span className="tc-numeric mr-2">{eventTime(ev, tz) ?? '時刻未定'}</span>{ev.title}
      </p>
      <p className="text-xs text-ink-700">
        {[ev.has_ticket ? 'チケットあり' : null,
          ev.transport_status ? `移動: ${TRANSPORT_STATUS_LABEL[ev.transport_status] ?? ev.transport_status}` : null]
          .filter(Boolean).join('・')}
      </p>
    </li>
  );
  return (
    <Surface as="section" aria-labelledby="dash-nownext" data-testid="dashboard-nownext">
      <h3 id="dash-nownext" className="font-semibold text-ink-900 flex items-center gap-2">
        <CalendarClock size={18} aria-hidden="true" />今と次
      </h3>
      {!t ? (
        <p className="mt-2 text-sm text-ink-700">今日の予定を読み込めませんでした。今日の画面で確かめてください。</p>
      ) : !t.now_event && !t.next_event ? (
        <p className="mt-2 text-sm text-ink-700">今日の時刻つきの予定はありません。</p>
      ) : (
        <ul className="mt-1 divide-y divide-cloud-200">
          {row('今', t.now_event)}
          {row(`次${minutesLabel(t.minutes_until_next) ? `(${minutesLabel(t.minutes_until_next)})` : ''}`, t.next_event)}
        </ul>
      )}
      <p className="mt-2 text-xs text-ink-700">{`時刻は旅行先の時刻(${tz})です。`}</p>
      <Link to={`/planner/${trip.id}/today`} className="tc-focus-ring mt-2 inline-block text-sm font-medium text-accent underline">
        今日の画面を開く
      </Link>
    </Surface>
  );
};

const ReadinessCard: React.FC<{ focus: DashboardFocus; trip: DashboardTrip }> = ({ focus, trip }) => {
  const r = focus.readiness;
  return (
    <Surface as="section" aria-labelledby="dash-readiness" data-testid="dashboard-readiness">
      <h3 id="dash-readiness" className="font-semibold text-ink-900 flex items-center gap-2">
        <ListChecks size={18} aria-hidden="true" />準備
      </h3>
      {!r ? (
        <p className="mt-2 text-sm text-ink-700">準備の状況を読み込めませんでした。</p>
      ) : r.is_ready ? (
        <p className="mt-2 text-sm text-success font-medium flex items-center gap-1">
          <CheckCircle2 size={16} aria-hidden="true" />確認が要る項目はありません
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-900">
            {`確認が要る項目 ${r.total}件`}{r.high ? <span className="text-danger font-semibold">{`(重要 ${r.high}件)`}</span> : null}
          </p>
          <ul className="mt-1 space-y-1 text-sm" aria-label="確認が要る項目(上位)">
            {r.top.map((i, n) => (
              <li key={`${i.title}-${n}`} className="text-ink-900">
                <span className={`mr-1 text-xs font-semibold ${i.severity === 'high' ? 'text-danger' : 'text-ink-700'}`}>
                  {`[${SEVERITY_LABEL[i.severity ?? ''] ?? '確認'}]`}
                </span>
                {i.title}
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to={`/planner/${trip.id}/preparation`} className="tc-focus-ring mt-2 inline-block text-sm font-medium text-accent underline">
        準備の画面を開く
      </Link>
    </Surface>
  );
};

const AlertsCard: React.FC<{ focus: DashboardFocus; trip: DashboardTrip }> = ({ focus, trip }) => {
  const a = focus.alerts;
  const count = a ? a.active + a.detected : 0;
  return (
    <Surface as="section" variant={count ? 'critical' : 'solid'} aria-labelledby="dash-alerts" data-testid="dashboard-alerts">
      <h3 id="dash-alerts" className="font-semibold text-ink-900 flex items-center gap-2">
        <AlertTriangle size={18} aria-hidden="true" />遅延・休業
      </h3>
      {!a ? (
        <p className="mt-2 text-sm text-ink-700">遅延・休業の状況を読み込めませんでした。</p>
      ) : count === 0 ? (
        <p className="mt-2 text-sm text-ink-700">対応が要る遅延・休業の知らせはありません。</p>
      ) : (
        <>
          <p className="mt-2 text-sm font-semibold text-danger" role="note">
            {`対応中 ${a.active}件・運行の変化 ${a.detected}件`}
          </p>
          <ul className="mt-1 space-y-1 text-sm text-ink-900">
            {a.top.map((x, n) => (
              <li key={n}>
                {`${x.kind_label ?? '知らせ'}${x.event_title ? `: ${x.event_title}` : ''}`}
                {x.delay_minutes ? `(${x.delay_minutes}分)` : ''}{x.is_stale ? '(情報が古い)' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to={`/planner/${trip.id}/alerts`} className="tc-focus-ring mt-2 inline-block text-sm font-medium text-accent underline">
        遅延・休業の画面を開く
      </Link>
    </Surface>
  );
};

const AfterTripCard: React.FC<{ trip: DashboardTrip }> = ({ trip }) => (
  <Surface as="section" aria-labelledby="dash-after" data-testid="dashboard-after">
    <h3 id="dash-after" className="font-semibold text-ink-900 flex items-center gap-2">
      <Ticket size={18} aria-hidden="true" />旅行のあとに
    </h3>
    <p className="mt-2 text-sm text-ink-700">
      {`「${trip.title}」の費用の精算・写真と旅行記・訪問した場所の確認を済ませましょう。記録は次の旅行の提案にも使われます。`}
    </p>
  </Surface>
);

export const FocusPanels: React.FC<{ focus: DashboardFocus; trip: DashboardTrip }> = ({ focus, trip }) => (
  <div className="grid gap-4 md:grid-cols-3" data-testid="dashboard-focus">
    {focus.phase === 'ongoing' && <NowNextCard focus={focus} trip={trip} />}
    {focus.phase !== 'past' && <ReadinessCard focus={focus} trip={trip} />}
    {(focus.phase === 'ongoing' || focus.phase === 'upcoming') && <AlertsCard focus={focus} trip={trip} />}
    {focus.phase === 'past' && <AfterTripCard trip={trip} />}
  </div>
);

export const QuickActions: React.FC<{ trip: DashboardTrip }> = ({ trip }) => {
  const actions = quickActions(trip);
  if (actions.length === 0) return null;
  return (
    <nav aria-label="この旅行の操作" className="mt-4">
      <ul className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((a) => (
          <li key={a.key}>
            <Link to={safeInternalPath(a.to) ?? '/dashboard'} className={actionLink}>
              <span>{a.label}</span><span aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

// ------------------------------------------------------------------ 旅行の一覧

const INITIAL_VISIBLE = 9;

export const TripList: React.FC<{ trips: DashboardTrip[] }> = ({ trips }) => {
  const [all, setAll] = useState(false);
  const groups = groupTrips(trips);
  let shown = 0;
  return (
    <section aria-labelledby="dash-trips" className="mt-8">
      <h2 id="dash-trips" className="text-lg font-semibold text-ink-900">旅行</h2>
      {groups.map((g) => {
        const visible = all ? g.trips : g.trips.slice(0, Math.max(0, INITIAL_VISIBLE - shown));
        shown += visible.length;
        if (visible.length === 0) return null;
        return (
          <div key={g.phase} className="mt-3">
            <h3 className="text-sm font-semibold text-ink-700">{`${PHASE_LABEL[g.phase]}(${g.trips.length})`}</h3>
            <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={`${PHASE_LABEL[g.phase]}の旅行`}>
              {visible.map((t) => (
                <li key={t.id}>
                  <Link to={`/planner/${t.id}`} aria-label={`${t.title}(${PHASE_LABEL[t.phase]}・${tripDateLabel(t)})を開く`}
                    className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                    <TripCover size="card" destination={t.destination} tripTitle={t.title} startDate={t.start_date}
                      data-testid={`trip-card-${t.id}`}>
                      <p className="font-semibold break-words">{t.title}</p>
                      <p className="text-xs mt-1">{tripDateLabel(t)}</p>
                      <p className="text-xs mt-1">{`${statusLabel(t)}・${ROLE_LABEL[t.role]}`}</p>
                    </TripCover>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!all && trips.length > INITIAL_VISIBLE && (
        <button type="button" onClick={() => setAll(true)}
          className="tc-focus-ring mt-3 rounded-lg border border-cloud-200 bg-cloud-0 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-cloud-100">
          {`すべての旅行を表示(${trips.length}件)`}
        </button>
      )}
    </section>
  );
};
