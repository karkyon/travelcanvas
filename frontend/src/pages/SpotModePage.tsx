/**
 * SpotModePage - スポットモード(SC-49。DOC-02 v6.0 FR-060。利用者の決定 2026-11-18)。
 *
 * 旅程の「自由に歩くエリア」の中を、順番を決めずに、その時の天気・体調・気分で選んで歩く画面。
 * - 上: 予定 ⇄ スポットの切り替え(どちらの画面でも同じ位置)・残り時間と「戻り始め」(出発の合図と同じ 4 段階)・ジャンルの絞り込み
 * - スマホ: 地図 + 下から出るシート(一覧 → 候補 → 次どこ？ → 周りを探す)。シートの高さは 3 段(つまみのボタン)
 * - タブレット横・広い画面: 地図と欄を左右に並べる(CSS)
 * - 「地図 ⇄ 方角」: 圏外・地図が出ない時は方角と距離の一覧(端末で計算)
 * - 今いる場所は端末の中だけで使う(周りを探す時だけ送り、保存しない)。位置の許可が既にある時だけ自動で取る
 * - エリアの情報は端末に暗号化して保存し(offlineVault)、通信できない時はそれを出す
 */
import WishHeartButton from '@/components/wishes/WishHeartButton';
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Compass, Crosshair, List, Map as MapIcon, Maximize2, Search, Sparkles } from 'lucide-react';
import { api, extractApiErrorDetailMessage } from '@/services/api';
import {
  addSpotItem, clearSpotVisit, listSpotAreas, markSpotVisit, rejoin, searchNearby, setSpotWant, splitOff,
} from '@/services/api/spotAreas';
import type { NearbyKind, NearbyResult, SpotArea, SpotGenre, SpotItem } from '@/services/api/types/spotAreas';
import { currentOfflineSession } from '@/utils/offlineSession';
import { loadSnapshot, saveSnapshot } from '@/utils/offlineVault';
import {
  GENRE_META, GENRE_ORDER, RETURN_LABEL, areaCenter, distanceM, hhmm, isDone, nowIn, planChain, pointOf, rankNext,
  sortItems, timeState, walkMinutes, type LatLng, type Mood, type SortMode,
} from './spot/spotModel';
import { CompassList, GroupMarks, NearbyPanel, NextPick, SplitPanel, SpotDetail, SpotList } from './spot/SpotPanels';
import '@/styles/spot-mode.css';

const SpotLeafletMap = React.lazy(() => import('./spot/SpotLeafletMap'));

type View = 'list' | 'detail' | 'next' | 'nearby';
type Sheet = 'peek' | 'half' | 'full';

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  const message = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as { message?: unknown }).message : null;
  return extractApiErrorDetailMessage(detail) ?? (typeof message === 'string' && message ? message : fallback);
}

const snapName = (planId: string, areaId: string) => `spot-area:${planId}:${areaId}`;

const SpotModePage: React.FC = () => {
  const { planId = '', areaId = '' } = useParams<{ planId: string; areaId: string }>();
  const [area, setArea] = useState<SpotArea | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [genre, setGenre] = useState<SpotGenre | 'all'>('all');
  const [sort, setSort] = useState<SortMode>('near');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('list');
  const [sheet, setSheet] = useState<Sheet>('half');
  const [moods, setMoods] = useState<Mood[]>([]);
  const [lineTo, setLineTo] = useState<string | null>(null);
  const [chainOn, setChainOn] = useState(false);
  const [mapMode, setMapMode] = useState<'map' | 'compass'>(() => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'compass' : 'map'));
  const [fitKey, setFitKey] = useState('0');
  const [busy, setBusy] = useState<string | null>(null);
  const [nearby, setNearby] = useState<{ results: NearbyResult[] | null; message: string | null }>({ results: null, message: null });
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  const apply = useCallback((a: SpotArea) => {
    setArea(a);
    setOfflineAt(null);
    void saveSnapshot(currentOfflineSession(), snapName(planId, a.id), a).catch(() => false);
  }, [planId]);

  const load = useCallback(async () => {
    try {
      const list = await listSpotAreas(planId);
      const a = list.areas.find((x) => x.id === areaId);
      if (!a) {
        setError('エリアが見つかりません');
        return;
      }
      apply(a);
    } catch (e) {
      const snap = await loadSnapshot<SpotArea>(currentOfflineSession(), snapName(planId, areaId)).catch(() => null);
      if (snap) {
        setArea(snap.data);
        setOfflineAt(snap.savedAt);
        setMapMode('compass');
      } else {
        setError(errorMessage(e, 'エリアを読めませんでした'));
      }
    } finally {
      setLoading(false);
    }
  }, [planId, areaId, apply]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const watch = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocMsg('この端末では今いる場所を取れません');
      return;
    }
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => { setMe([p.coords.latitude, p.coords.longitude]); setLocMsg(null); },
      () => setLocMsg('今いる場所を取れませんでした(位置の許可を確かめてください)'),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  }, []);

  // 位置の許可が既にある時だけ自動で取る(許可を求める画面は、現在地のボタンを押した時だけ出す)
  useEffect(() => {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    perms?.query({ name: 'geolocation' as PermissionName }).then((s) => { if (s.state === 'granted') watch(); }).catch(() => undefined);
    return () => { if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current); };
  }, [watch]);

  const tz = area?.timezone_id ?? null;
  const now = useMemo(() => nowIn(tz, nowMs), [tz, nowMs]);
  const items = useMemo(() => area?.items ?? [], [area]);
  const numbers = useMemo(() => Object.fromEntries(items.map((i, k) => [i.id, k + 1])), [items]);
  const visible = useCallback((i: SpotItem) => genre === 'all' || i.genre === genre, [genre]);
  const shown = useMemo(() => sortItems(items.filter(visible), me, sort), [items, visible, me, sort]);
  const center = area ? areaCenter(area) : null;
  const meet = area ? pointOf({ latitude: area.meet_latitude, longitude: area.meet_longitude }) : null;
  // その日でなければ残り時間は出さない(時間枠だけ示す)
  const onTheDay = !!area && (!area.local_date || area.local_date === now.date);
  const time = area && onTheDay ? timeState(area, now.minutes, me) : null;
  const ranked = useMemo(() => rankNext(items, me, moods, now.minutes, time?.returnBy != null ? time.returnBy - now.minutes : null),
    [items, me, moods, now.minutes, time?.returnBy]);
  const endMin = time?.remain != null ? now.minutes + time.remain : null;
  const chain = useMemo(() => planChain(items, me, now.minutes, endMin, meet), [items, me, now.minutes, endMin, meet]);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const genres = GENRE_ORDER.filter((g) => items.some((i) => i.genre === g));
  const doneCount = items.filter(isDone).length;

  const line: LatLng[] | null = chainOn && chain && me
    ? [me, ...chain.order.map((i) => pointOf(i)!), ...(meet ? [meet] : [])]
    : lineTo && me ? (() => { const t = items.find((i) => i.id === lineTo); const p = t ? pointOf(t) : null; return p ? [me, p] : null; })()
      : null;

  const select = (id: string) => {
    setSelectedId(id);
    setView('detail');
    if (sheet === 'peek') setSheet('half');
  };
  const go = (id: string) => {
    setSelectedId(id);
    setLineTo(id);
    setChainOn(false);
    setView('detail');
  };

  const act = async (key: string, fn: () => Promise<SpotArea>, ok?: string) => {
    setBusy(key);
    setError(null);
    try {
      apply(await fn());
      if (ok) setNotice(ok);
    } catch (e) {
      setError(errorMessage(e, '更新できませんでした'));
    } finally {
      setBusy(null);
    }
  };

  const onNearby = async (q: { kind: NearbyKind; radius: number; withinArea: boolean; query: string }) => {
    if (!me || !area) return;
    setBusy('nearby');
    setNearby({ results: null, message: '探しています…' });
    try {
      const r = await searchNearby(planId, area.id, { latitude: me[0], longitude: me[1], radius_m: q.radius,
        within_area: q.withinArea, kind: q.kind, ...(q.query ? { query: q.query } : {}) });
      const down = r.results.length === 0 && r.failed_providers.length > 0;
      setNearby({ results: r.results, message: down
        ? '場所の検索サービスに繋がらず、探せませんでした(周りに何もないという意味ではありません)。少し待って、もう一度探してください'
        : r.message });
    } catch (e) {
      setNearby({ results: null, message: errorMessage(e, '探せませんでした。しばらくしてから試してください') });
    } finally {
      setBusy(null);
    }
  };

  const onAdd = async (r: NearbyResult) => {
    if (!area) return;
    const key = `${r.name}|${r.latitude}`;
    setBusy('nearby');
    try {
      const list = await api.createCandidate(planId, { title: r.name, address: r.address ?? undefined, latitude: r.latitude,
        longitude: r.longitude, category: r.category ?? r.genre_label, priority: 2 });
      const made = [...list.items].reverse().find((c) => c.title === r.name && c.latitude === r.latitude);
      if (!made) throw new Error('候補を作れませんでした');
      apply(await addSpotItem(planId, area.id, { candidate_id: made.id, genre: r.genre, priority: 'maybe', stay_minutes: 20 }));
      setAdded((s) => new Set(s).add(key));
      setNotice(`「${r.name}」を候補に足しました`);
    } catch (e) {
      setNearby((n) => ({ ...n, message: errorMessage(e, '候補に足せませんでした') }));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="tc-spot tc-spot--loading" role="status" aria-busy="true">読み込み中…</div>;
  if (!area) {
    return (
      <div className="tc-spot tc-spot--empty">
        <p role="alert">{error ?? 'エリアが見つかりません'}</p>
        <Link className="tc-spot-btn" to={`/planner/${planId}/today`}>予定へ戻る</Link>
      </div>
    );
  }

  const near = selected && pointOf(selected)
    ? items.filter((i) => i.id !== selected.id && !isDone(i) && pointOf(i))
      .map((i) => ({ item: i, walk: walkMinutes(distanceM(pointOf(selected)!, pointOf(i)!)) }))
      .sort((a, b) => a.walk - b.walk).slice(0, 2)
    : [];

  const panel = (
    <>
      <div className="tc-spot-tabs" role="tablist" aria-label="シートの中身">
        {([['list', '候補', List], ['next', '次どこ？', Sparkles], ['nearby', '周りを探す', Search]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k || (k === 'list' && view === 'detail')}
            className="tc-spot-tab" onClick={() => setView(k)}>
            <Icon size={16} aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <div className="tc-spot-panel__body">
        {view === 'list' && (
          <>
            <div className="tc-spot-listhead">
              <h2 className="tc-spot-serif">候補 {shown.length}件{doneCount ? `(済 ${doneCount})` : ''}</h2>
              <label className="tc-spot-sort">並び
                <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                  <option value="near">近い順</option><option value="want">行きたい順</option><option value="plan">決めた順</option>
                </select>
              </label>
            </div>
            <SpotList items={shown} numbers={numbers} me={me} selectedId={selectedId} canEdit={area.can_edit} busy={busy}
              onSelect={(id) => setSelectedId(id === selectedId ? null : id)} onGo={go}
              onVisit={(i) => void act(i.id, () => markSpotVisit(planId, area.id, i.id), `「${i.title}」に着きました`)} />
            <GroupMarks items={items} />
            <SplitPanel splits={area.splits} defaultTime={area.meet_time ?? area.end_time} defaultLabel={area.meet_label}
              busy={busy === 'split'}
              onSplit={(input) => void act('split', () => splitOff(planId, area.id, input), '別行動をメンバーに知らせました')}
              onRejoin={() => void act('split', () => rejoin(planId, area.id), '合流しました')} />
          </>
        )}
        {view === 'detail' && selected && (
          <SpotDetail item={selected} n={numbers[selected.id] ?? 0} me={me} nowMin={now.minutes} canEdit={area.can_edit}
            busy={busy === selected.id} lineOn={lineTo === selected.id && !chainOn} near={near}
            onClose={() => setView('list')}
            onLine={() => { setChainOn(false); setLineTo(lineTo === selected.id ? null : selected.id); }}
            onVisit={() => void act(selected.id, () => markSpotVisit(planId, area.id, selected.id), `「${selected.title}」に着きました`)}
            onSkip={() => void act(selected.id, () => markSpotVisit(planId, area.id, selected.id, true))}
            onUndo={() => void act(selected.id, () => clearSpotVisit(planId, area.id, selected.id))}
            onWant={() => void act(selected.id, () => setSpotWant(planId, area.id, selected.id, !selected.wanted_by_me))}
            onPick={select} />
        )}
        {view === 'detail' && !selected && <p className="tc-spot-note">地図の印か一覧から候補を選んでください。</p>}
        {view === 'next' && (
          <NextPick ranked={ranked} numbers={numbers} moods={moods} chain={chain} me={me} chainOn={chainOn}
            onMood={(m) => setMoods((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))}
            onGo={go} onChain={() => { setLineTo(null); setChainOn(!chainOn); }} />
        )}
        {view === 'nearby' && (
          <NearbyPanel me={me} canEdit={area.can_edit} busy={busy === 'nearby'} results={nearby.results} message={nearby.message}
            added={added} onSearch={(q) => void onNearby(q)} onAdd={(r) => void onAdd(r)} onLocate={watch} />
        )}
      </div>
    </>
  );

  return (
    <div className="tc-spot" data-sheet={sheet}>
      {/* [FR-062] ♡ 今度行きたいに残す(画面ごとに 1 つ) */}
      <WishHeartButton isGuest={false} className="tc-focus-ring tc-wish-fab" label="今度行きたい"
        options={{ sourceKind: 'today', planId }} />
      <header className="tc-spot-top">
        <div className="tc-spot-bar">
          <Link className="tc-spot-icon" to={`/planner/${planId}/today`} aria-label="旅行の予定へ戻る"><ArrowLeft size={22} /></Link>
          <div className="tc-spot-bar__title">
            <h1 className="tc-spot-serif">{area.title}</h1>
            <p>スポットモード ・ 候補 {items.length}件{doneCount ? `(済 ${doneCount})` : ''}{offlineAt ? ` ・ 端末に保存した情報(${new Date(offlineAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })})` : ''}</p>
          </div>
          <nav className="tc-spot-seg" aria-label="表示の切り替え">
            <Link to={`/planner/${planId}/today`}><List size={16} aria-hidden="true" />予定</Link>
            <span className="is-on" aria-current="page"><MapIcon size={16} aria-hidden="true" />スポット</span>
          </nav>
        </div>
        {!onTheDay && (area.start_time || area.meet_time) && (
          <p className="tc-spot-time" role="note">
            <Clock size={20} aria-hidden="true" />
            <span className="tc-spot-time__main">当日 {area.local_date} {area.start_time ?? ''}〜{area.end_time ?? ''}
              {area.meet_time ? ` ・ 集合 ${area.meet_time}${area.meet_label ? ` ${area.meet_label}` : ''}` : ''}(当日は残り時間を出します)</span>
          </p>
        )}
        {time?.remain != null && (
          <div className={`tc-spot-time is-${time.level}`} role="status">
            <Clock size={20} aria-hidden="true" />
            <div className="tc-spot-time__main">
              <div><b className="tc-spot-serif">{time.remain >= 0 ? `残り ${Math.floor(time.remain / 60)}:${String(time.remain % 60).padStart(2, '0')}` : `${-time.remain}分 過ぎ`}</b>
                <span> ・ {area.meet_time ?? area.end_time} {area.meet_label ? `集合(${area.meet_label})` : 'まで'}</span></div>
              {time.progress != null && <div className="tc-spot-time__bar"><span style={{ width: `${Math.round(time.progress * 100)}%` }} /></div>}
            </div>
            {time.returnBy != null && (
              <div className="tc-spot-time__ret">戻り始め<b>{hhmm(time.returnBy)}</b><span>{RETURN_LABEL[time.level!]}</span></div>
            )}
          </div>
        )}
        <div className="tc-spot-chips tc-spot-chips--scroll" role="group" aria-label="ジャンルで絞る">
          <button type="button" className="tc-spot-chip" aria-pressed={genre === 'all'} onClick={() => setGenre('all')}>すべて</button>
          {genres.map((g) => (
            <button key={g} type="button" className="tc-spot-chip" aria-pressed={genre === g} onClick={() => setGenre(g)}>
              <span className="tc-spot-chip__dot" style={{ background: GENRE_META[g].color }} aria-hidden="true" />{GENRE_META[g].label}
            </button>
          ))}
        </div>
        {error && <p className="tc-spot-alert" role="alert">{error}</p>}
        {notice && <p className="tc-spot-ok" role="status" onAnimationEnd={() => setNotice(null)}>{notice}</p>}
        {locMsg && <p className="tc-spot-alert" role="alert">{locMsg}</p>}
      </header>

      <main className="tc-spot-main">
        <div className="tc-spot-map">
          {mapMode === 'map' ? (
            <Suspense fallback={<div className="tc-spot-map__loading" role="status">地図を読み込み中…</div>}>
              <SpotLeafletMap items={items} numbers={numbers} visible={visible} selectedId={selectedId} onSelect={select}
                me={me} center={center} radiusM={area.radius_m} meet={meet} meetLabel={area.meet_label} line={line}
                focus={selected ? pointOf(selected) : null} fitKey={fitKey}
                extraPins={(nearby.results ?? []).slice(0, 8).map((r, k) => ({ key: `${r.name}${k}`, point: [r.latitude, r.longitude] as LatLng, label: r.name }))} />
            </Suspense>
          ) : (
            <CompassList items={shown} numbers={numbers} me={me} onSelect={select} />
          )}
          <div className="tc-spot-fabs">
            <button type="button" className="tc-spot-fab" onClick={watch} aria-label="現在地を取る"><Crosshair size={22} /></button>
            {mapMode === 'map' && (
              <button type="button" className="tc-spot-fab" onClick={() => setFitKey(String(Date.now()))} aria-label="エリア全体を表示"><Maximize2 size={22} /></button>
            )}
            <button type="button" className="tc-spot-fab" onClick={() => setMapMode(mapMode === 'map' ? 'compass' : 'map')}
              aria-label={mapMode === 'map' ? '方角と距離で見る' : '地図で見る'}>{mapMode === 'map' ? <Compass size={22} /> : <MapIcon size={22} />}</button>
            <button type="button" className="tc-spot-fab" onClick={() => { setView('nearby'); if (sheet === 'peek') setSheet('half'); }}
              aria-label="周りを探す"><Search size={22} /></button>
          </div>
          {mapMode === 'map' && line && <p className="tc-spot-legend">線は直線の目安です(道順ではありません)</p>}
        </div>
        <section className="tc-spot-panel" aria-label="候補と操作">
          <button type="button" className="tc-spot-handle" onClick={() => setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek')}
            aria-label={sheet === 'full' ? 'シートを小さくする' : 'シートを広げる'}><span aria-hidden="true" /></button>
          <div className="tc-spot-panel__quick">
            <button type="button" className="tc-spot-btn tc-spot-btn--accent" onClick={() => { setView('next'); if (sheet === 'peek') setSheet('half'); }}>
              <Sparkles size={18} aria-hidden="true" />次どこ？
            </button>
          </div>
          {panel}
        </section>
      </main>
    </div>
  );
};

export default SpotModePage;
