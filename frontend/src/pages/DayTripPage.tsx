/**
 * [FR-061] ルートと寄り道(/planner/:planId/day-trip。詳細設計 DD-2026-11-22-01 §4.1・§4.2・§4.6)。
 *
 * スマホは地図が上・シートが下。iPad 横・PC は左に地図・右に欄(spot-mode と同じ作り)。
 * - 行き / 帰り・道の使い方の比べ(2 枚。もう片方を押すと計算し直す)・ジャンル(いくつでも)・ルートからの幅
 * - 「あなた向けに並べる」と傾向の 1 行・保存した行きたい場所がルートの近くに N 件
 * - 一覧(あなた向け / ルート順 / 寄り道が短い順)の行に「予定に入れる」と ♡
 * - 家に着く見込み(端末で足し引き)。越える時は警告の文
 * 状態: 読み込み中・ルートが無い・直線の予備・候補 0・検索の鍵が無い・圏外(前に取った結果)
 */
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, Plus, RefreshCw } from 'lucide-react';
import {
  compareRoads as fetchCompare, computeDayTripRoute, decodePolyline, getAlong, getDayTrip, WIDTHS,
  type AlongOrder, type AlongResponse, type CompareOption, type DayTripLeg, type DayTripView, type Road,
} from '@/services/api/dayTrip';
import { addDetourEvent } from '@/services/api/travelDay';
import { api } from '@/services/api';
import WishSaveButton from '@/components/wishes/WishSaveButton';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { loadSnapshot, saveSnapshot } from '@/utils/offlineVault';
import { isNetworkError } from '@/utils/syncQueue';
import { pendingKey } from './dayTrip/dayTripDraft';
import type { RouteInput } from '@/services/api/dayTrip';
import {
  GENRES, ROAD_LABEL, arrivalAt, compareRoads, durationText, etaText, homeEta, kmText, nextWidth, rowLine, tollText, toHhmm, toMin,
  type Added,
} from './dayTrip/dayTripModel';

const DayTripMap = lazy(() => import('./dayTrip/DayTripMap'));

const session = async () => (await import('@/utils/offlineSession')).currentOfflineSession();
const snapName = (planId: string) => `daytrip-along:${planId}`;

const DayTripPage: React.FC = () => {
  const { planId = '' } = useParams<{ planId: string }>();
  const [view, setView] = useState<DayTripView | null>(null);
  const canEdit = view?.can_edit !== false;
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [leg, setLeg] = useState<'out' | 'back'>('out');
  const [genres, setGenres] = useState<string[]>(['cafe']);
  const [width, setWidth] = useState(1000);
  const [personal, setPersonal] = useState(true);
  const [order, setOrder] = useState<AlongOrder>('personal');
  const [along, setAlong] = useState<AlongResponse | null>(null);
  const [alongState, setAlongState] = useState<'idle' | 'loading' | 'ready' | 'failed' | 'offline'>('idle');
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [compare, setCompare] = useState<CompareOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [added, setAdded] = useState<Added[]>([]);

  const load = useCallback(async () => {
    try {
      setView(await getDayTrip(planId));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errorDetailMessage(e, 'ルートを読み込めませんでした'));
    }
  }, [planId]);
  useEffect(() => { void load(); }, [load]);

  const cur: DayTripLeg | undefined = view?.routes[leg];
  const out = view?.routes.out;
  const back = view?.routes.back;
  const effectiveOrder: AlongOrder = personal ? order : (order === 'personal' ? 'route' : order);

  useEffect(() => {
    if (!cur) return;
    let alive = true;
    setAlongState('loading');
    setSelected(null);
    getAlong(planId, { leg, genres, width_m: width, order: effectiveOrder })
      .then(async (r) => {
        if (!alive) return;
        setAlong(r);
        setAlongState('ready');
        setOfflineAt(null);
        void saveSnapshot(await session(), snapName(planId), { leg, r }).catch(() => false);
      })
      .catch(async (e) => {
        if (!alive) return;
        if (isNetworkError(e)) {
          const got = await loadSnapshot<{ leg: string; r: AlongResponse }>(await session(), snapName(planId)).catch(() => null);
          if (got?.data?.r && alive) { setAlong(got.data.r); setOfflineAt(got.savedAt); setAlongState('offline'); return; }
        }
        setAlongState('failed');
        setMsg(errorDetailMessage(e, '寄り道の候補を探せませんでした'));
      });
    return () => { alive = false; };
  }, [planId, leg, genres, width, effectiveOrder, cur?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!out) { setCompare(null); return; }
    let alive = true;
    fetchCompare(planId, compareRoads(out.road)).then((r) => { if (alive) setCompare(r.options); }).catch(() => setCompare(null));
    return () => { alive = false; };
  }, [planId, out?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const recompute = async (road: Road) => {
    if (!out || busy) return;
    setBusy(true);
    try {
      await computeDayTripRoute(planId, { origin: out.origin, destination: { ...out.destination, spot_id: out.destination.spot_id ?? null },
        road, depart_at: out.depart_at, home_by: out.home_by });
      await load();
      setMsg(`${ROAD_LABEL[road]}で計算し直しました`);
    } catch (e) {
      setMsg(errorDetailMessage(e, 'ルートを計算できませんでした。もう一度試してください'));
    } finally {
      setBusy(false);
    }
  };

  // ルートが無い時(作った時の計算に失敗した): 作った時の入力で、もう一度計算する
  const pending = (): RouteInput | null => {
    try { const v = sessionStorage.getItem(pendingKey(planId)); return v ? (JSON.parse(v) as RouteInput) : null; } catch { return null; }
  };
  const retry = async () => {
    const input = pending();
    if (!input || busy) return;
    setBusy(true);
    try {
      await computeDayTripRoute(planId, input);
      await load();
      setMsg(null);
    } catch (e) {
      setMsg(`ルートを計算できませんでした(${errorDetailMessage(e, '通信の失敗')})。もう一度試してください`);
    } finally {
      setBusy(false);
    }
  };

  const addToPlan = async (i: number) => {
    const r = along?.results[i];
    if (!r || !cur || !along) return;
    try {
      const plan = await api.getPlanDetail(planId);
      const dayId = plan.data?.days?.[0]?.id;
      if (!dayId) throw new Error('no_day');
      const start = arrivalAt(cur, along.total_km, r.at_km, added);
      await addDetourEvent(planId, { day_id: dayId, title: r.name, local_start_time: start,
        local_end_time: toHhmm(toMin(start) + r.stay_min), address: r.address, latitude: r.lat, longitude: r.lng });
      setAdded((a) => [...a, { key: `${r.name}-${r.lat}`, leg, at_km: r.at_km, detour_min: r.detour_min ?? 0, stay_min: r.stay_min }]);
      setMsg(`「${r.name}」を ${start} の予定に入れました`);
    } catch (e) {
      setMsg(errorDetailMessage(e, '予定に入れられませんでした'));
    }
  };

  const line = useMemo(() => (cur?.polyline ? decodePolyline(cur.polyline) : []), [cur?.polyline]);
  const eta = etaText(homeEta(back, added), out?.home_by ?? null);
  const toggleGenre = (g: string) => setGenres((cur0) => (cur0.includes(g) ? cur0.filter((x) => x !== g) : [...cur0, g]));
  const results = along?.results ?? [];
  const noKeys = along && along.keyed_providers.length === 0;

  if (loadErr && !view) return <div className="tc-page"><p role="alert" className="tc-card p-4">{loadErr}</p></div>;
  if (!view) return <div className="tc-page"><p role="status">ルートを計算しています…</p></div>;
  if (view.trip_style !== 'day_trip') {
    return <div className="tc-page"><p className="tc-card p-4">この旅行は日帰りではありません。<Link className="underline" to={`/planner/${planId}`}>旅程へ戻る</Link></p></div>;
  }

  return (
    <div className="tc-daytrip" data-testid="day-trip">
      <div className="tc-daytrip-mapcol">
        <Suspense fallback={<div className="tc-daytrip-map" role="status">地図を読み込み中…</div>}>
          <DayTripMap line={line} widthM={width} results={results} wishes={along?.wishes_near ?? []} selected={selected}
            onSelect={(i) => { setSelected(i); document.getElementById(`dt-row-${i}`)?.scrollIntoView?.({ block: 'nearest' }); }}
            straight={cur?.provider === 'straight'} fitKey={`${leg}-${cur?.revision ?? 0}`} />
        </Suspense>
        {along && <span className="tc-daytrip-badge" data-testid="dt-badge">{`幅 ${WIDTHS.find(([w]) => w === width)?.[1]} · 線の近く ${results.length} 件`}</span>}
      </div>
      <section className="tc-daytrip-sheet" aria-labelledby="dt-title">
        <div className="flex items-center gap-2">
          <Link to={`/planner/${planId}`} className="tc-focus-ring tc-mbtn min-h-11" aria-label="旅程へ戻る"><ArrowLeft size={18} /></Link>
          <div>
            <h1 id="dt-title" className="text-lg font-bold text-ink-900">ルートと寄り道</h1>
            <p className="text-sm text-ink-700">{out?.destination.label ?? ''}</p>
          </div>
        </div>
        {msg && <p role="status" className="mt-2 text-sm text-ink-900">{msg}</p>}

        {!out ? (
          <div className="tc-card mt-3 p-4" data-testid="dt-no-route">
            <p>ルートを計算できませんでした。もう一度試してください(道路のルートが取れない時は直線の予備で探します)。</p>
            {pending() && canEdit && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary mt-2 min-h-11" disabled={busy}
              data-testid="dt-retry" onClick={() => void retry()}><RefreshCw size={14} aria-hidden="true" />もう一度</button>}
            <Link to={`/planner/${planId}`} className="tc-focus-ring tc-mbtn mt-2 ml-2 min-h-11">旅程へ戻る</Link>
          </div>
        ) : (
          <>
            <div className="tc-list-tabs mt-3" role="tablist" aria-label="行き・帰り">
              {(['out', 'back'] as const).map((k) => {
                const l = view.routes[k];
                return (
                  <button key={k} type="button" role="tab" aria-selected={leg === k} className={`tc-focus-ring tc-pill min-h-11 ${leg === k ? 'is-active' : ''}`}
                    onClick={() => setLeg(k)}>
                    {`${k === 'out' ? '行き' : '帰り'}${l?.depart_at ? ` ${l.depart_at}〜${l.arrive_at ?? ''}` : ''}`}
                  </button>
                );
              })}
            </div>
            {cur?.provider === 'straight' && <p className="tc-pill mt-2" data-testid="dt-straight">道路のルートではありません(直線)</p>}

            {compare && compare.length === 2 && (
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="道の使い方の比べ">
                {compare.map((c) => {
                  const on = c.road === out.road;
                  return (
                    <button key={c.road} type="button" aria-pressed={on} disabled={busy || on || !canEdit}
                      className={`tc-focus-ring tc-card min-h-11 p-3 text-left ${on ? 'border-2 border-ink-900' : ''}`}
                      onClick={() => void recompute(c.road)}>
                      <b>{ROAD_LABEL[c.road]}</b>
                      <span className="block text-sm">{`${durationText(c.duration_s)} · ${kmText(c.distance_m)}`}</span>
                      <span className="block text-xs text-ink-700">{tollText(c.toll_jpy, c.road)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <fieldset className="mt-3">
              <legend className="text-sm font-semibold text-ink-900">ジャンル</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {GENRES.map(([g, l]) => (
                  <button key={g} type="button" aria-pressed={genres.includes(g)} data-testid={`dt-genre-${g}`}
                    className={`tc-focus-ring tc-pill min-h-11 ${genres.includes(g) ? 'is-active font-semibold' : ''}`} onClick={() => toggleGenre(g)}>{l}</button>
                ))}
              </div>
            </fieldset>
            <fieldset className="mt-3">
              <legend className="text-sm font-semibold text-ink-900">ルートからの幅</legend>
              <div className="mt-1 flex gap-2">
                {WIDTHS.map(([w, l]) => (
                  <button key={w} type="button" aria-pressed={width === w} data-testid={`dt-width-${w}`}
                    className={`tc-focus-ring tc-pill min-h-11 ${width === w ? 'is-active font-semibold' : ''}`} onClick={() => setWidth(w)}>{l}</button>
                ))}
              </div>
            </fieldset>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
              <button type="button" role="switch" aria-checked={personal} data-testid="dt-personal"
                className={`tc-focus-ring tc-mbtn tc-mbtn--sm min-h-11 ${personal ? 'tc-mbtn--primary' : ''}`}
                onClick={() => setPersonal((v) => !v)}>{personal ? '入' : '切'}</button>
              あなた向けに並べる
            </label>
            {personal && along?.profile_line && <p className="text-xs text-ink-700" data-testid="dt-profile">{along.profile_line}</p>}
            {along && along.wishes_near.length > 0 && (
              <p className="mt-2 flex items-center gap-1 text-sm" data-testid="dt-wishes"><Heart size={14} aria-hidden="true" />
                {`保存した行きたい場所がルートの近くに ${along.wishes_near.length} 件`}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor="dt-order" className="text-sm">並べ</label>
              <select id="dt-order" className="tc-focus-ring min-h-11 rounded-xl border px-2" value={effectiveOrder}
                onChange={(e) => setOrder(e.target.value as AlongOrder)}>
                {personal && <option value="personal">あなた向け</option>}
                <option value="route">ルート順</option><option value="detour">寄り道が短い順</option>
              </select>
            </div>
            {noKeys && <p className="mt-2 text-xs text-ink-700">店・施設の検索の鍵が未登録のため、OpenStreetMap だけで探しています</p>}
            {alongState === 'offline' && offlineAt && (
              <p className="mt-2 text-xs text-ink-700" data-testid="dt-offline">
                {`通信できないため、前に取った結果です(${new Date(offlineAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })})`}</p>
            )}
            {alongState === 'loading' && <ul aria-busy="true" className="mt-3 space-y-2">{[0, 1, 2].map((i) => <li key={i} className="tc-card h-16 animate-pulse" />)}</ul>}
            {(alongState === 'ready' || alongState === 'offline') && results.length === 0 && (
              <div className="tc-card mt-3 p-4" data-testid="dt-empty">
                <p>この幅では見つかりませんでした。幅を広げるか、ジャンルを減らしてください</p>
                {nextWidth(width) && <button type="button" className="tc-focus-ring tc-mbtn mt-2 min-h-11"
                  onClick={() => setWidth(nextWidth(width) as number)}>{`幅を ${WIDTHS.find(([w]) => w === nextWidth(width))?.[1]} に広げる`}</button>}
              </div>
            )}
            {alongState === 'failed' && (
              <button type="button" className="tc-focus-ring tc-mbtn mt-3 min-h-11" onClick={() => setWidth((w) => w)}>
                <RefreshCw size={14} aria-hidden="true" />もう一度</button>
            )}
            <ol className="mt-3 space-y-2" aria-label="寄り道の候補">
              {results.map((r, i) => {
                const isAdded = added.some((a) => a.key === `${r.name}-${r.lat}`);
                const ext = safeExternalUrl(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address ?? ''}`)}`);
                return (
                  <li key={`${r.name}-${r.lat}`} id={`dt-row-${i}`} className={`tc-card p-3 ${selected === i ? 'ring-2 ring-ink-900' : ''}`}>
                    <button type="button" className="tc-focus-ring w-full text-left" aria-expanded={selected === i} onClick={() => setSelected(selected === i ? null : i)}>
                      <b>{`${i + 1}. ${r.name}`}</b>{r.genre_label && <span className="ml-2 text-xs text-ink-700">{r.genre_label}</span>}
                      <span className="block text-xs text-ink-700">{rowLine(r)}</span>
                    </button>
                    {r.reasons.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{r.reasons.map((x) => <span key={x} className="tc-pill text-xs">{x}</span>)}</p>}
                    {selected === i && (
                      <div className="mt-2 text-sm text-ink-700">
                        {r.address && <p>{r.address}</p>}
                        {ext && <a className="underline" href={ext} target="_blank" rel="noopener noreferrer">外の地図で開く(新しいタブ)</a>}
                        {along?.source.length ? <p className="text-xs">{`出典: ${along.source.map((s) => s.credit).join('・')}`}</p> : null}
                      </div>
                    )}
                    <div className="mt-2 flex gap-2">
                      {canEdit && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary min-h-11" disabled={isAdded}
                        data-testid={`dt-add-${i}`} onClick={() => void addToPlan(i)}>
                        <Plus size={14} aria-hidden="true" />{isAdded ? '予定に入れました' : '予定に入れる'}</button>}
                      <WishSaveButton name={r.name} latitude={r.lat} longitude={r.lng} address={r.address} genre={r.genre}
                        sourceKind="route" planId={planId} />
                    </div>
                  </li>
                );
              })}
            </ol>
            {eta && (
              <p className={`tc-daytrip-eta ${eta.late ? 'is-late' : ''}`} role="status" data-testid="dt-eta">
                {eta.late ? `注意: ${eta.text}` : eta.text}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default DayTripPage;
