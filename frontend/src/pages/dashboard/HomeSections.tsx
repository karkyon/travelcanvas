/**
 * [Gate HomeV2] ホーム v2(docs/ux/TravelCanvas_ホーム改善案_v2_モックアップ.html)の段。
 *
 * - 旅の準備: 計画中の旅行の段階(行き先と日付・立ち寄る場所・移動手段・予約と確認・持ち物)
 * - 次にやること: 計画中の旅行ぜんぶから重要な順(主役の旅行の切り替えは大きな表紙の下)
 * - 旅行の一覧: 計画中 / 検討中 / 行った旅 / 見送り・中止 / すべて のタブ。見送り・中止は編集できる人が決める
 * - 旅の記録と思い出: 最近行った旅の写真(見られる写真だけ)・行った旅の時系列
 * - 旅の足あと: 行った都道府県(行き先・住所に書かれた名前だけ)・今年の旅の日数・写真の数
 * - 行ってみたい場所: お気に入りに保存したスポットを種類別に
 * - 道具: スポット検索・共有・オフライン・しおり・旅の地図・設定
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AreaLegend, JapanTileMap, RegionLegend, WorldTileMap } from './FootprintMaps';
import { setSoundEnabled, soundEnabled } from './footSound';
import { Link } from 'react-router-dom';
import {
  BedDouble, BookOpen, Check, CircleAlert, Compass, Download, Map as MapIcon, MapPin, Route, Search, Settings, Share2, ShoppingBag, Utensils, Volume2, VolumeX, type LucideIcon, ArrowLeftRight,
} from 'lucide-react';
import { getMemoryMedia } from '@/services/api';
import { setTripState } from '@/services/api/g9';
import type { DashboardHome, DashboardTrip, HomePlanning, HomeTask, TripShelf } from '@/services/api/types/g9';
import { safeInternalPath } from '@/utils/safeNavigation';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import Landscape from '@/components/shell/Landscape';
import { useCoverPhoto } from '@/hooks/useCoverPhoto';
import { TripCard } from './DashboardParts';
import { PHASE_LABEL, ROLE_LABEL, quickActions, statusLabel, tripDateLabel } from './dashboardModel';

const SHELF_LABEL: Record<TripShelf, string> = {
  planning: '計画中', considering: '検討中', visited: '行った旅', cancelled: '見送り・中止',
};
const SHELF_ORDER: TripShelf[] = ['planning', 'considering', 'visited', 'cancelled'];


// ------------------------------------------------------------------ 旅の準備

export const HomeProgress: React.FC<{ detail: HomePlanning }> = ({ detail }) => {
  const pct = detail.total ? Math.round((detail.done / detail.total) * 100) : 0;
  return (
    <section className="tc-card tc-home-progress" aria-labelledby="home-progress" data-testid="home-progress">
      <div className="tc-section-row">
        <h2 id="home-progress" className="tc-section-title">{`旅の準備 ${detail.done} / ${detail.total}`}</h2>
        <span className="text-xs text-ink-700">{`予定 ${detail.event_count} 件`}</span>
      </div>
      <div className="tc-home-bar" role="progressbar" aria-valuemin={0} aria-valuemax={detail.total} aria-valuenow={detail.done}
        aria-label="旅の準備の進み具合"><i style={{ width: `${pct}%` }} /></div>
      <ol className="tc-home-steps">
        {detail.steps.map((s) => (
          <li key={s.key} data-done={s.done ? 'true' : 'false'} data-testid={`home-step-${s.key}`}>
            <span className="tc-home-step-dot" aria-hidden="true">{s.done ? <Check size={11} /> : '!'}</span>
            {s.label}<span className="sr-only">{s.done ? '(済み)' : '(まだ)'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
};


// ------------------------------------------------------------------ いま計画中(主役の旅行の表紙)

/**
 * モックアップ v2 の表紙: 写真(無ければ絵)の上に、状態・行き先・人数、旅行名、日付と予定の数、出発までの日数(旅行中は何日目)、
 * 主な操作(旅程を開く / 今日の予定)と「この旅行の操作」(予約・準備・しおり・招待など)、右上に旅の準備の進み具合。
 */
export const PlanningHero: React.FC<{ trip: DashboardTrip; detail: HomePlanning | null }> = ({ trip, detail }) => {
  const cover = useCoverPhoto(trip.id, trip.cover);
  const primary = trip.phase === 'ongoing'
    ? { to: `/planner/${trip.id}/today`, label: '今日の予定を見る' } : { to: `/planner/${trip.id}`, label: '旅程を開く' };
  const actions = quickActions(trip).filter((a) => a.to !== primary.to);
  const booklet = { key: 'booklet', label: 'しおり(印刷・Web)', to: `/planner/${trip.id}/booklet` };
  // 操作は主な操作を含めて 4 つまで(UX-3)。しおり(印刷・Web)は招待の前に置く
  const others = actions.filter((a) => a.key !== 'share');
  const withBooklet = trip.phase === 'past' ? actions
    : [...others.slice(0, 1), booklet, ...others.slice(1), ...actions.filter((a) => a.key === 'share')];
  const navItems = withBooklet.length > 3 && withBooklet.some((a) => a.key === 'share')
    ? [...withBooklet.filter((a) => a.key !== 'share').slice(0, 2), ...withBooklet.filter((a) => a.key === 'share')]
    : withBooklet.slice(0, 3);
  const pct = detail && detail.total ? Math.round((detail.done / detail.total) * 100) : 0;
  return (
    <section className="tc-plan-hero" aria-labelledby="dash-hero-title" data-testid="dashboard-hero" data-phase={trip.phase}
      data-has-photo={cover.photo ? 'true' : undefined}>
      <div className="tc-plan-hero-bg" aria-hidden="true">
        {cover.photo ? (
          <img src={cover.photo.src} alt="" onError={cover.onError} data-testid="trip-cover-photo"
            style={{ objectPosition: `${cover.photo.focusX * 100}% ${cover.photo.focusY * 100}%` }} />
        ) : <Landscape />}
      </div>
      <div className="tc-plan-hero-in">
        <div className="tc-plan-hero-chips">
          <span className="tc-plan-chip tc-plan-chip--live" data-testid="dashboard-phase">{PHASE_LABEL[trip.phase]}</span>
          {trip.destination && <span className="tc-plan-chip">{trip.destination}</span>}
          <span className="tc-plan-chip">{`${trip.member_count}人・あなたは${ROLE_LABEL[trip.role]}`}</span>
        </div>
        <h2 id="dash-hero-title">{trip.title}</h2>
        <p className="tc-plan-hero-meta">
          {[tripDateLabel(trip), detail ? `予定 ${detail.event_count} 件` : null,
            detail && detail.segments.need ? `移動手段 ${detail.segments.done}/${detail.segments.need} 決定` : null]
            .filter(Boolean).join(' · ')}
        </p>
        <p className="tc-plan-hero-count">
          {trip.phase === 'upcoming' && trip.days_until_start !== null ? (
            <><b>{trip.days_until_start}</b><span>日後に出発</span></>
          ) : trip.phase === 'ongoing' && trip.day_number ? (
            <><b>{trip.day_number}</b><span>日目(旅行中)</span></>
          ) : <span>{statusLabel(trip)}</span>}
        </p>
        <nav aria-label="この旅行の操作" className="tc-plan-hero-acts">
          <Link to={safeInternalPath(primary.to) ?? '/dashboard'} className="tc-focus-ring tc-mbtn tc-mbtn--primary">{`${primary.label} →`}</Link>
          {navItems.map((a) => (
            <Link key={a.key} to={safeInternalPath(a.to) ?? '/dashboard'} className="tc-focus-ring tc-plan-hero-btn">{a.label}</Link>
          ))}
        </nav>
      </div>
      {detail && (
        <div className="tc-plan-hero-prog" data-testid="home-progress">
          <h3>{`旅の準備 ${detail.done} / ${detail.total}`}</h3>
          <div className="tc-home-bar" role="progressbar" aria-valuemin={0} aria-valuemax={detail.total} aria-valuenow={detail.done}
            aria-label="旅の準備の進み具合"><i style={{ width: `${pct}%` }} /></div>
          <ol className="tc-plan-steps">
            {detail.steps.map((st) => (
              <li key={st.key} data-done={st.done ? 'true' : 'false'} data-testid={`home-step-${st.key}`}>
                <span className="tc-home-step-dot" aria-hidden="true">{st.done ? <Check size={11} /> : '!'}</span>
                {st.label}<span className="sr-only">{st.done ? '(済み)' : '(まだ)'}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ 主役の旅行の切り替え

/**
 * [Gate HomeSwitch] 大きな表紙のすぐ下で、表紙・旅の準備に出す旅行(計画中)を切り替える。
 * 押せることが分かるよう、見出し「表示する旅行を切り替え」とアイコン・日付・あと何日を付けたボタンにする。計画中が 1 件なら出さない
 */
export const TripSwitcher: React.FC<{ planning: DashboardTrip[]; selected: string; onSelect: (id: string) => void }> = ({
  planning, selected, onSelect,
}) => {
  if (planning.length < 2) return null;
  return (
    <div className="tc-home-switcher" role="group" aria-labelledby="home-switch-label" data-testid="home-switcher">
      <span id="home-switch-label" className="tc-home-switcher-label"><ArrowLeftRight size={14} aria-hidden="true" />表示する旅行を切り替え</span>
      <div className="tc-home-switcher-opts">
        {planning.map((t) => (
          <button key={t.id} type="button" aria-pressed={selected === t.id} onClick={() => onSelect(t.id)}
            className="tc-focus-ring" data-testid={`home-switch-${t.id}`}>
            {selected === t.id && <Check size={13} aria-hidden="true" />}
            <span>{t.title}</span>
            <small>{statusLabel(t)}</small>
          </button>
        ))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ 次にやること

const TASK_ICON: Record<string, LucideIcon> = { ready: CircleAlert, moves: Route, places: MapPin, packing: BookOpen };

export const NextTasks: React.FC<{ tasks: HomeTask[] }> = ({ tasks }) => (
  <section className="tc-card tc-home-tasks" aria-labelledby="home-tasks" data-testid="home-tasks">
    <h2 id="home-tasks" className="tc-section-title">次にやること</h2>
    <p className="text-xs text-ink-700">計画中の旅行ぜんぶから、重要な順</p>
    {tasks.length === 0 ? (
      <p className="mt-3 text-sm text-ink-700" data-testid="home-tasks-empty">いま急いで決めることはありません。</p>
    ) : (
      <ul className="tc-home-task-list">
        {tasks.map((t, i) => {
          const Icon = TASK_ICON[t.kind] ?? CircleAlert;
          return (
            <li key={`${t.plan_id}-${i}`} data-severity={t.severity}>
              <span className="tc-home-task-ic" aria-hidden="true"><Icon size={17} /></span>
              <span className="min-w-0">
                <b>{t.title}</b>
                <small>{`${t.trip_title}${t.severity === 'high' ? ' · 重要' : ''}`}</small>
              </span>
              <Link to={safeInternalPath(t.to) ?? '/dashboard'} className="tc-focus-ring tc-home-task-go" aria-label={`${t.title}(${t.trip_title})を${t.action}`}>
                {t.action} →
              </Link>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

// ------------------------------------------------------------------ 旅行の一覧

export const TripShelves: React.FC<{
  trips: DashboardTrip[]; counts: Record<TripShelf, number>; onChanged: () => void;
}> = ({ trips, counts, onChanged }) => {
  const first = SHELF_ORDER.find((s) => counts[s] > 0) ?? 'planning';
  const [tab, setTab] = useState<TripShelf | 'all'>(first);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = tab === 'all' ? trips : trips.filter((t) => t.shelf === tab);
  const change = async (t: DashboardTrip, state: 'cancelled' | 'active') => {
    setBusy(t.id);
    setError(null);
    try {
      await setTripState(t.id, state);
      onChanged();
    } catch (e) {
      setError(errorDetailMessage(e, '旅行の状態を変えられませんでした'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="tc-card tc-home-shelf" aria-labelledby="home-shelf" data-testid="home-shelf">
      <div className="tc-home-shelf-head">
        <h2 id="home-shelf" className="tc-section-title">旅行の一覧</h2>
        <div role="tablist" aria-label="旅行の状態" className="tc-home-seg">
          {[...SHELF_ORDER, 'all' as const].map((s) => (
            <button key={s} type="button" role="tab" aria-selected={tab === s} onClick={() => setTab(s)}
              className="tc-focus-ring" data-testid={`home-shelf-tab-${s}`}>
              {s === 'all' ? 'すべて' : SHELF_LABEL[s]}<em>{s === 'all' ? trips.length : counts[s]}</em>
            </button>
          ))}
        </div>
        <Link to="/planner" className="tc-focus-ring tc-mini-link ml-auto">旅程の一覧で管理 →</Link>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="tc-home-cards" aria-label={`${tab === 'all' ? 'すべて' : SHELF_LABEL[tab]}の旅行`}>
        {shown.map((t) => (
          <li key={t.id} className="tc-home-trip">
            <Link to={`/planner/${t.id}`} aria-label={`${t.title}(${t.shelf ? SHELF_LABEL[t.shelf] : ''}・${tripDateLabel(t)})を開く`}
              className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <TripCard trip={t} />
            </Link>
            <div className="tc-home-trip-meta">
              {t.shelf && <span className={`tc-home-mini tc-home-mini--${t.shelf}`}>{SHELF_LABEL[t.shelf]}</span>}
              <span className="tc-home-mini">{`予定 ${t.event_count ?? 0}`}</span>
              <span className="tc-home-mini">{`写真 ${t.photo_count ?? 0}`}</span>
              {t.can_edit && t.shelf !== 'visited' && (
                <button type="button" className="tc-focus-ring tc-home-mini-btn" disabled={busy === t.id}
                  onClick={() => void change(t, t.shelf === 'cancelled' ? 'active' : 'cancelled')}
                  data-testid={`home-state-${t.id}`}>
                  {t.shelf === 'cancelled' ? 'もう一度計画する' : '見送りにする'}
                </button>
              )}
            </div>
          </li>
        ))}
        <li>
          <Link to="/planner?new=1" className="tc-focus-ring tc-home-add">＋ 新しい旅行<small>行き先を決めて作る</small></Link>
        </li>
      </ul>
      {shown.length === 0 && (
        <p className="mt-2 text-sm text-ink-700" data-testid="home-shelf-empty">
          {tab === 'cancelled' ? '見送り・中止にした旅行はありません。旅行のカードの「見送りにする」で移せます。'
            : tab === 'visited' ? '行った旅はまだありません。旅行の最後の日を過ぎると、ここに移ります。'
              : tab === 'considering' ? '日付を決めていない旅行(相談中の下書きなど)はありません。'
                : 'この状態の旅行はありません。'}
        </p>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ 旅の記録と思い出

function usePhotoUrls(planId: string | null, ids: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = `${planId ?? ''}|${ids.join(',')}`;
  useEffect(() => {
    if (!planId || ids.length === 0) return undefined;
    let alive = true;
    const made: string[] = [];
    Promise.all(ids.map((id) => getMemoryMedia(planId, id).then((b) => [id, URL.createObjectURL(b)] as const).catch(() => null)))
      .then((rows) => {
        const ok = rows.filter((r): r is readonly [string, string] => r !== null);
        ok.forEach(([, u]) => made.push(u));
        if (alive) setUrls(Object.fromEntries(ok));
        else ok.forEach(([, u]) => URL.revokeObjectURL(u));
      });
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 写真の組み合わせ(key)が変わった時だけ読み直す
  }, [key]);
  return urls;
}

export const MemoriesSection: React.FC<{ home: DashboardHome }> = ({ home }) => {
  const { recent, timeline } = home.memories;
  const top = timeline[0] ?? null;
  const urls = usePhotoUrls(recent?.plan_id ?? null, recent?.photo_ids ?? []);
  const photos = (recent?.photo_ids ?? []).map((id) => urls[id]).filter((u): u is string => Boolean(u));
  const more = top ? Math.max(0, top.photo_count - photos.length) : 0;
  return (
    <section className="tc-card tc-home-memories" aria-labelledby="home-memories" data-testid="home-memories">
      <div className="tc-section-row">
        <h2 id="home-memories" className="tc-section-title">旅の記録と思い出</h2>
        <span className="tc-home-mini tc-home-mini--visited">{`行った旅 ${home.shelves.visited}`}</span>
      </div>
      {!top ? (
        <p className="mt-3 text-sm text-ink-700" data-testid="home-memories-empty">
          行った旅の写真・メモがここに並びます。旅行中は、旅行を開いた画面の「記録」から写真とメモを残せます。
        </p>
      ) : (
        <>
          <div className="tc-home-mosaic" data-count={photos.length}>
            {photos.length === 0 ? (
              <div className="tc-home-mosaic-empty">写真はまだありません</div>
            ) : photos.map((u, i) => (
              <div key={u} className="tc-home-mosaic-cell">
                <img src={u} alt="" />
                {i === photos.length - 1 && more > 0 && <span className="tc-home-mosaic-more">{`+ ${more}`}</span>}
              </div>
            ))}
          </div>
          <div className="tc-home-memrow">
            <span className="min-w-0">
              <b>{top.title}</b>
              <small>{`${tripDateLabel({ start_date: top.start_date, end_date: top.end_date, total_days: null })} · 写真 ${top.photo_count} · メモ ${top.note_count}`}</small>
            </span>
            <Link to={`/planner/${top.plan_id}/memories`} className="tc-focus-ring tc-mbtn tc-mbtn--sm">旅の記録を見る</Link>
            <Link to={`/planner/${top.plan_id}/journey`} className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary">旅を振り返る</Link>
          </div>
          {timeline.length > 1 && (
            <ul className="tc-home-timeline" aria-label="行った旅(新しい順)">
              {timeline.slice(1).map((t) => (
                <li key={t.plan_id}>
                  <Link to={`/planner/${t.plan_id}/memories`} className="tc-focus-ring">
                    <b>{t.title}</b>
                    <small>{`${(t.end_date ?? t.start_date ?? '').slice(0, 7).replace('-', '/')} · 写真 ${t.photo_count}`}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ 旅の足あと

type FootView = 'japan' | 'world';
const VIEW_KEY = 'tc.footprintView';
function savedView(): FootView | null {
  try { const v = window.localStorage.getItem(VIEW_KEY); return v === 'japan' || v === 'world' ? v : null; } catch { return null; }
}

/**
 * [Gate Footprints2] 旅の足あと。日本(都道府県の升目の地図)と世界(陸の升目の地図に旅の場所の点)を切り替える。
 * 最初は日本。国内の記録が無く海外の場所だけある時は世界。選んだ方はこの端末に覚える。
 */
export const Footprints: React.FC<{ home: DashboardHome }> = ({ home }) => {
  const f = home.footprints;
  const visited = useMemo(() => new Set(f.prefectures), [f.prefectures]);
  const planned = useMemo(() => new Set(f.planned_prefectures), [f.planned_prefectures]);
  const points = useMemo(() => f.points ?? [], [f.points]);
  const [view, setView] = useState<FootView>(() => savedView()
    ?? (f.prefectures.length === 0 && f.planned_prefectures.length === 0 && points.length > 0 ? 'world' : 'japan'));
  const choose = (v: FootView) => {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* 覚えられなくても切り替えは効く */ }
  };
  const visitedPoints = points.filter((p) => p.state === 'visited').length;
  // [Gate FootHover] カーソルを動かした時の音(この端末に覚える)
  const [sound, setSound] = useState(soundEnabled);
  const toggleSound = () => { setSoundEnabled(!sound); setSound(!sound); };
  return (
    <section className="tc-card tc-home-foot" aria-labelledby="home-foot" data-testid="home-footprints">
      <div className="tc-section-row">
        <h2 id="home-foot" className="tc-section-title">旅の足あと</h2>
        <div className="tc-fp-toggle" role="group" aria-label="地図の範囲">
          <button type="button" className="tc-focus-ring" aria-pressed={view === 'japan'} onClick={() => choose('japan')}
            data-testid="footprint-view-japan">日本</button>
          <button type="button" className="tc-focus-ring" aria-pressed={view === 'world'} onClick={() => choose('world')}
            data-testid="footprint-view-world">世界</button>
        </div>
        <button type="button" className="tc-focus-ring tc-fp-sound" aria-pressed={sound} onClick={toggleSound}
          aria-label={sound ? '地図の音を消す' : '地図の音を鳴らす'} title={sound ? '地図の音: 鳴らす' : '地図の音: 消している'}
          data-testid="footprint-sound">
          {sound ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
        </button>
        <Link to="/atlas" className="tc-focus-ring tc-mini-link">旅の地図 →</Link>
      </div>
      {view === 'japan' ? (
        <dl className="tc-home-kpis">
          <div><dt>行った都道府県</dt><dd>{f.prefectures.length}<small>/47</small></dd></div>
          <div><dt>旅の日数(今年)</dt><dd>{f.days_this_year}</dd></div>
          <div><dt>残した写真</dt><dd>{f.photos.toLocaleString()}</dd></div>
        </dl>
      ) : (
        <dl className="tc-home-kpis">
          <div><dt>行った場所</dt><dd>{visitedPoints}<small> か所</small></dd></div>
          <div><dt>海外の旅</dt><dd>{f.overseas_trips ?? 0}<small> 回</small></dd></div>
          <div><dt>旅の日数(今年)</dt><dd>{f.days_this_year}</dd></div>
        </dl>
      )}
      <div className="tc-fp-frame">
        {view === 'japan' ? <JapanTileMap visited={visited} planned={planned} prefTrips={f.pref_trips} /> : <WorldTileMap points={points} />}
      </div>
      {view === 'japan' ? (
        <>
          <p className="tc-home-legend"><span data-state="visited" />行った<span data-state="planned" />計画中
            <small>行き先・予定の住所に書かれた都道府県から数えます。県にカーソルを当てると、その県の旅行(直近 5 件)が出ます</small></p>
          <RegionLegend />
        </>
      ) : (
        <>
          <p className="tc-home-legend"><span data-state="visited-dot" />行った<span data-state="planned-dot" />計画中
            <small>{points.length ? '予定に登録した位置を点で示します(地図は略図)。点の辺りにカーソルを当てると、その旅行が出ます' : '予定に位置(地図の場所)を入れると、ここに点で出ます'}</small></p>
          <AreaLegend />
        </>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ 行ってみたい場所

const WISH_META: Record<string, { label: string; icon: LucideIcon }> = {
  sightseeing: { label: '観光', icon: Compass }, restaurant: { label: '食べたい', icon: Utensils },
  accommodation: { label: '泊まりたい', icon: BedDouble }, shopping: { label: '買い物', icon: ShoppingBag },
  other: { label: 'その他', icon: MapPin },
};

export const Wishlist: React.FC<{ home: DashboardHome }> = ({ home }) => {
  const w = home.wishlist;
  return (
    <section className="tc-card tc-home-wish" aria-labelledby="home-wish" data-testid="home-wishlist">
      <div className="tc-section-row">
        <h2 id="home-wish" className="tc-section-title">行ってみたい場所</h2>
        <span className="tc-home-mini">{`保存 ${w.count}`}</span>
        <Link to="/search" className="tc-focus-ring tc-mbtn tc-mbtn--sm ml-auto">＋ 場所を探して保存</Link>
      </div>
      {w.groups.length === 0 ? (
        <p className="mt-3 text-sm text-ink-700" data-testid="home-wishlist-empty">
          気になる場所を「スポット検索」で探してお気に入りに保存すると、種類別にここへ並びます。
        </p>
      ) : (
        <ul className="tc-home-lists">
          {w.groups.map((g) => {
            const meta = WISH_META[g.category] ?? WISH_META.other!;
            const Icon = meta.icon;
            return (
              <li key={g.category} className="tc-home-list">
                <div className="tc-home-list-head"><span aria-hidden="true"><Icon size={16} /></span><b>{meta.label}</b>
                  <small>{`${g.count} か所`}</small></div>
                <ul>
                  {g.spots.map((s) => (
                    <li key={s.spot_id}><span>{s.name}</span>{s.prefecture && <small>{s.prefecture}</small>}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/spots" className="tc-focus-ring tc-mini-link mt-2 inline-block">保存した場所の一覧 →</Link>
    </section>
  );
};

// ------------------------------------------------------------------ 道具

export const Tools: React.FC<{ tripId: string | null }> = ({ tripId }) => {
  const items: Array<{ to: string; label: string; sub: string; icon: LucideIcon }> = [
    { to: '/search', label: 'スポット検索', sub: '場所を探して保存', icon: Search },
    { to: tripId ? `/share/${tripId}` : '/planner', label: '共有', sub: '旅程・旅行記', icon: Share2 },
    { to: tripId ? `/planner/${tripId}` : '/planner', label: 'オフライン', sub: '旅程の画面から保存', icon: Download },
    { to: tripId ? `/planner/${tripId}/booklet` : '/planner', label: 'しおり', sub: '印刷・PDF', icon: BookOpen },
    { to: '/atlas', label: '旅の地図', sub: '行った場所', icon: MapIcon },
    { to: '/settings', label: '設定', sub: '表示・データ', icon: Settings },
  ];
  return (
    <section className="tc-card tc-home-tools" aria-labelledby="home-tools" data-testid="home-tools">
      <h2 id="home-tools" className="tc-section-title">道具</h2>
      <ul className="tc-home-tool-grid">
        {items.map(({ to, label, sub, icon: Icon }) => (
          <li key={label}>
            <Link to={safeInternalPath(to) ?? '/dashboard'} className="tc-focus-ring">
              <span aria-hidden="true"><Icon size={18} /></span><b>{label}</b><small>{sub}</small>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};
