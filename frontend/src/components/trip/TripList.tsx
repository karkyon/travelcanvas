/**
 * [Gate TripsWish] 旅行の一覧(/planner)。
 *
 * 旅行ごとのカードに、表紙(写真、無ければ行き先の色の絵)・状態(あと○日 / 旅行中 / 行った)・出発日と最終日(曜日)・
 * 泊数と日数・人数・メンバーの数・予定と写真の数・備考を出す。上で状態(計画中 / 検討中 / 行った旅 / 見送り)を切り替える。
 *
 * 日付・状態・表紙・数はホームと同じ集約(GET /dashboard の trips)から、人数(preferences.party_size)・備考(description)は
 * 旅行の一覧(GET /travel-plans/)から取る。集約を読めない時は旅行の一覧の値だけで出す(値を作らない)。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Ban, CalendarClock, CalendarDays, Camera, CircleCheckBig, Copy, LayoutGrid, Lightbulb, MapPin, NotebookPen, Trash2, UserRound, Users, type LucideIcon } from 'lucide-react';
import TripCover from '@/components/trip/TripCover';
import { useCoverPhoto } from '@/hooks/useCoverPhoto';
import { getDashboard } from '@/services/api/g9';
import type { DashboardTrip, TripShelf } from '@/services/api/types/g9';
import { ROLE_LABEL, spanTitle, statusLabel } from '@/pages/dashboard/dashboardModel';
import type { TravelPlan } from '@/types';
import { dateWithDay, partySize, stayLabel, tripSpan } from './tripListModel';

type Tab = 'all' | TripShelf;
/** [Gate TripShelfLook] 状態ごとの名前・アイコン(色は lists.css の data-shelf。色だけに頼らず、アイコンと文字でも示す) */
const SHELF: Record<TripShelf, { label: string; icon: LucideIcon }> = {
  planning: { label: '計画中', icon: CalendarClock },
  considering: { label: '検討中', icon: Lightbulb },
  visited: { label: '行った旅', icon: CircleCheckBig },
  cancelled: { label: '見送り・中止', icon: Ban },
};
const TABS: Array<[Tab, string, LucideIcon]> = [
  ['all', 'すべて', LayoutGrid],
  ...(Object.entries(SHELF) as Array<[TripShelf, { label: string; icon: LucideIcon }]>).map(([k, v]) => [k, v.label, v.icon] as [Tab, string, LucideIcon]),
];
const TAB_KEY = 'tc.tripListTab';
export interface TripRow { plan: TravelPlan | undefined; trip: DashboardTrip | undefined; id: string; title: string }

interface Props {
  plans: TravelPlan[];
  onOpen: (id: string) => void;
  onClone: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  cloningId: string | null;
}

const TripCard: React.FC<{ row: TripRow } & Omit<Props, 'plans'>> = ({ row, onOpen, onClone, onDelete, cloningId }) => {
  const { plan, trip, id, title } = row;
  const cover = useCoverPhoto(trip ? id : null, trip?.cover ?? null);
  const { start, end, totalDays } = tripSpan(plan, trip);
  const stay = stayLabel(totalDays);
  const party = partySize(plan);
  const note = (plan?.description ?? '').trim();
  const destination = trip?.destination ?? plan?.destination ?? null;
  const shared = trip && trip.role !== 'owner';
  return (
    <li aria-label={title} className="tc-lcard" data-testid={`trip-list-${id}`} data-shelf={trip?.shelf}>
      <TripCover size="card" destination={destination} tripTitle={title} startDate={start}
        photo={cover.photo} onPhotoError={cover.onError} className="tc-lcard-cover">
        <span className="tc-trip-chip" title={trip ? spanTitle(trip) : undefined}>{trip ? statusLabel(trip) : (start ? '日付あり' : '日付は未定')}</span>
        {shared && <span className="tc-trip-chip tc-trip-chip--role">{`共有・${ROLE_LABEL[trip.role]}`}</span>}
      </TripCover>
      <div className="tc-lcard-body">
        {trip?.shelf && (() => {
          const S = SHELF[trip.shelf];
          return (
            <p className="tc-shelf-badge" data-shelf={trip.shelf} data-testid={`trip-shelf-${id}`}>
              <S.icon size={13} aria-hidden="true" />{S.label}
            </p>
          );
        })()}
        <h3>
          <button type="button" className="tc-focus-ring" aria-label={`「${title}」を開く`} onClick={() => onOpen(id)}>{title}</button>
        </h3>
        {destination && <p className="tc-trip-dest"><MapPin size={14} aria-hidden="true" />{destination}</p>}
        <div className="tc-trip-dates">
          <CalendarDays size={15} aria-hidden="true" />
          {start ? (
            <dl>
              <div><dt>出発</dt><dd>{dateWithDay(start)}</dd></div>
              {end && end !== start && <div><dt>最終日</dt><dd>{dateWithDay(end)}</dd></div>}
            </dl>
          ) : <span>日付は未定</span>}
          {stay && <em>{stay}</em>}
        </div>
        <ul className="tc-trip-stats" aria-label="旅行の数">
          <li title="人数(基本情報で入れた人数)"><UserRound size={14} aria-hidden="true" />{party ? `${party}人` : '人数 未入力'}</li>
          {trip && <li title="一緒に編集・閲覧するメンバー(自分を含む)"><Users size={14} aria-hidden="true" />{`メンバー ${trip.member_count}`}</li>}
          {trip?.event_count !== undefined && <li title="旅程の予定の数"><MapPin size={14} aria-hidden="true" />{`予定 ${trip.event_count}`}</li>}
          {trip?.photo_count !== undefined && <li title="旅の記録の写真"><Camera size={14} aria-hidden="true" />{`写真 ${trip.photo_count}`}</li>}
        </ul>
        {note && <p className="tc-trip-note"><NotebookPen size={14} aria-hidden="true" /><span>{note}</span></p>}
        <div className="tc-trip-actions">
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" onClick={() => onOpen(id)}
            aria-label={`「${title}」の旅程を開く`}>旅程を開く</button>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" aria-label={`「${title}」を複製`}
            disabled={cloningId === id} onClick={() => onClone(id, title)}>
            <Copy size={14} aria-hidden="true" />{cloningId === id ? '複製中…' : '複製'}
          </button>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-trip-del" aria-label={`「${title}」を削除`}
            onClick={() => onDelete(id)}>
            <Trash2 size={14} aria-hidden="true" />削除
          </button>
        </div>
      </div>
    </li>
  );
};

const TripList: React.FC<Props> = ({ plans, ...actions }) => {
  const [trips, setTrips] = useState<DashboardTrip[] | null>(null);
  // [Gate TripShelfLook] 既定は「計画中」(計画中が無ければ「すべて」)。選んだ状態は端末に覚える
  const [picked, setPicked] = useState<Tab | null>(() => {
    try {
      const v = window.localStorage.getItem(TAB_KEY);
      return v && (v === 'all' || v in SHELF) ? (v as Tab) : null;
    } catch { return null; }
  });
  const setTab = (v: Tab) => {
    setPicked(v);
    try { window.localStorage.setItem(TAB_KEY, v); } catch { /* 覚えられなくても切り替えは使える */ }
  };
  const ids = plans.map((p) => p.id).join(',');
  useEffect(() => {
    let alive = true;
    getDashboard().then((d) => { if (alive) setTrips(d.trips); }).catch(() => { if (alive) setTrips([]); });
    return () => { alive = false; };
  }, [ids]);

  const rows = useMemo<TripRow[]>(() => {
    const byId = new Map(plans.map((p) => [p.id, p]));
    const seen = new Set<string>();
    const out: TripRow[] = [];
    for (const t of trips ?? []) {
      if (!byId.has(t.id)) continue; // 一覧から消えた旅行(削除の直後など)は出さない
      seen.add(t.id);
      out.push({ plan: byId.get(t.id), trip: t, id: t.id, title: byId.get(t.id)?.title ?? t.title });
    }
    for (const p of plans) if (!seen.has(p.id)) out.push({ plan: p, trip: undefined, id: p.id, title: p.title });
    return out;
  }, [plans, trips]);
  const count = (t: Tab) => (t === 'all' ? rows.length : rows.filter((r) => r.trip?.shelf === t).length);
  const tab: Tab = picked ?? (count('planning') > 0 ? 'planning' : 'all');
  const shown = tab === 'all' ? rows : rows.filter((r) => r.trip?.shelf === tab);
  const upcoming = rows.filter((r) => r.trip && (r.trip.phase === 'upcoming' || r.trip.phase === 'ongoing')).length;
  const thisYear = String(new Date().getFullYear());
  const daysThisYear = rows.reduce((n, r) => {
    const { start, totalDays } = tripSpan(r.plan, r.trip);
    return start && start.slice(0, 4) === (r.trip?.local_today ?? thisYear).slice(0, 4) ? n + (totalDays ?? 0) : n;
  }, 0);

  return (
    <>
      <dl className="tc-list-kpis" data-testid="trip-list-kpis">
        <div><dt>旅行</dt><dd>{rows.length}<small> 件</small></dd></div>
        <div><dt>これからの旅</dt><dd>{upcoming}<small> 件</small></dd></div>
        <div><dt>行った旅</dt><dd>{count('visited')}<small> 件</small></dd></div>
        <div><dt>今年の旅の日数</dt><dd>{daysThisYear}<small> 日</small></dd></div>
      </dl>
      <div className="tc-list-tabs" role="tablist" aria-label="旅行の状態">
        {TABS.map(([v, l, Icon]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} className="tc-focus-ring" data-shelf={v}
            onClick={() => setTab(v)} data-testid={`trip-tab-${v}`}>
            <Icon size={14} aria-hidden="true" />{l}<span>{count(v)}</span>
          </button>
        ))}
      </div>
      {tab !== 'all' && rows.length > shown.length && (
        <p className="tc-list-filter-note" data-testid="trip-filter-note">
          {`「${SHELF[tab].label}」の ${shown.length} 件を表示しています(すべて ${rows.length} 件)`}
          <button type="button" className="tc-focus-ring tc-mini-link" onClick={() => setTab('all')}>すべて表示</button>
        </p>
      )}
      {shown.length === 0 ? (
        <p className="tc-card tc-list-empty" role="status">この状態の旅行はありません</p>
      ) : (
        <ul className="grid tc-trip-grid" aria-label="旅行の一覧">
          {shown.map((r) => <TripCard key={r.id} row={r} {...actions} />)}
        </ul>
      )}
    </>
  );
};

export default TripList;
