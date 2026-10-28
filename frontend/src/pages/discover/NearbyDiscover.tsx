/**
 * [Gate G11] 近くの「行きたい」を集める(docs/ux/G11_UIUX全範囲_実装仕様.md §3.3、UIX-M08。画面の正本のモックの「発見」)。
 *
 * - 基点: 旅程の場所(座標のある予定)・現在地(許可した時だけ)・地図の座標の手入力。位置の許可を断っても旅程の場所で探せる
 * - 半径・カテゴリ(すべて・食べ物・市場・買い物・絶景)・言葉
 * - 候補: 名前・カテゴリ・距離(半径内 / 周辺優先 / 距離不明)・出典・取得時刻。「候補箱へ」と「写真を探す」
 * 提供元が半径を保証しない時は「周辺優先」と出し、半径の内と言い切らない。架空の評価・人気・写真を出さない。
 */
import React, { useId, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import { searchNearby } from '@/services/api/g11discover';
import type { DiscoverCategory, NearbyResult } from '@/services/api/types/g11discover';
import { CATEGORIES, distanceLabel, type BasePoint } from './discoverModel';

const RADII = [0.5, 1, 2, 5];
const PROVIDER_LABEL: Record<string, string> = {
  overpass: 'OpenStreetMap(近くの場所)', nominatim: 'OpenStreetMap(地名)', wikipedia: 'Wikipedia',
};

interface Props {
  bases: BasePoint[];
  canEdit: boolean;
  onAddCandidate: (result: NearbyResult) => Promise<void>;
  onFindPhoto?: (result: NearbyResult) => void;
}

const NearbyDiscover: React.FC<Props> = ({ bases, canEdit, onAddCandidate, onFindPhoto }) => {
  const qid = useId();
  const [baseId, setBaseId] = useState<string>(bases[0]?.id ?? 'manual');
  const [manual, setManual] = useState({ lat: '', lng: '' });
  const [current, setCurrent] = useState<BasePoint | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [radius, setRadius] = useState(2);
  const [category, setCategory] = useState<DiscoverCategory>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NearbyResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const base = useMemo<BasePoint | null>(() => {
    if (baseId === 'current') return current;
    if (baseId === 'manual') {
      const lat = Number(manual.lat);
      const lng = Number(manual.lng);
      if (manual.lat === '' || manual.lng === '' || !Number.isFinite(lat) || !Number.isFinite(lng)
        || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { id: 'manual', label: `緯度 ${lat}・経度 ${lng}`, latitude: lat, longitude: lng };
    }
    return bases.find((b) => b.id === baseId) ?? null;
  }, [baseId, bases, current, manual]);

  const useCurrent = () => {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('この端末では現在地を使えません。旅程の場所か座標で探してください');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => { setCurrent({ id: 'current', label: '現在地', latitude: p.coords.latitude, longitude: p.coords.longitude }); setBaseId('current'); },
      () => setGeoError('現在地を使えませんでした(許可されていません)。旅程の場所か座標で探してください'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!base) {
      setError('探す基点を選んでください');
      return;
    }
    if (category === 'all' && !query.trim()) {
      setError('「すべて」で探す時は、探す言葉を入力してください');
      return;
    }
    setBusy('search');
    setError(null);
    try {
      const r = await searchNearby({ query: query.trim(), category, latitude: base.latitude, longitude: base.longitude,
        radius_km: radius });
      setResults([...r.candidates].sort((a, b) => (a.distance_m ?? 1e12) - (b.distance_m ?? 1e12)));
    } catch {
      setResults([]);
      setError('近くの場所を探せませんでした。時間をおいてもう一度お試しください');
    } finally {
      setBusy(null);
    }
  };

  const add = async (r: NearbyResult) => {
    setBusy(r.id);
    try {
      await onAddCandidate(r);
      setAdded((a) => ({ ...a, [r.id]: true }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="nearby-title" className="rounded-xl border border-cloud-200 bg-surface p-4" data-testid="nearby-discover">
      <h2 id="nearby-title" className="font-semibold text-ink-900">近くの「行きたい」を集める</h2>
      <p className="text-xs text-ink-700">基点の周りを、カテゴリと半径で探します。見つけた場所は候補箱へ入れてから、日程へ追加できます。</p>
      <form className="mt-3 space-y-3" onSubmit={search} aria-label="近くを探す">
        <fieldset>
          <legend className="text-sm text-ink-700">探す基点</legend>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select value={baseId} onChange={(e) => setBaseId(e.target.value)} aria-label="探す基点"
              className="rounded-md border border-cloud-200 bg-surface px-2 py-2 text-ink-900" data-testid="nearby-base">
              {bases.map((b) => <option key={b.id} value={b.id}>{`旅程の場所: ${b.label}`}</option>)}
              {current && <option value="current">現在地</option>}
              <option value="manual">座標を入れる</option>
            </select>
            <Button type="button" variant="outline" size="sm" onClick={useCurrent}>現在地を使う</Button>
          </div>
          {baseId === 'manual' && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input aria-label="緯度" inputMode="decimal" placeholder="緯度(例 35.0)" value={manual.lat}
                onChange={(e) => setManual((m) => ({ ...m, lat: e.target.value }))}
                className="w-36 rounded-md border border-cloud-200 bg-surface px-2 py-2 text-ink-900" />
              <input aria-label="経度" inputMode="decimal" placeholder="経度(例 135.7)" value={manual.lng}
                onChange={(e) => setManual((m) => ({ ...m, lng: e.target.value }))}
                className="w-36 rounded-md border border-cloud-200 bg-surface px-2 py-2 text-ink-900" />
            </div>
          )}
          {geoError && <p className="mt-1 text-xs text-warning" role="status">{geoError}</p>}
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={`${qid}-r`} className="block text-sm text-ink-700">半径</label>
            <select id={`${qid}-r`} value={radius} onChange={(e) => setRadius(Number(e.target.value))}
              className="mt-1 rounded-md border border-cloud-200 bg-surface px-2 py-2 text-ink-900">
              {RADII.map((r) => <option key={r} value={r}>{r < 1 ? `${r * 1000}m` : `${r}km`}</option>)}
            </select>
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor={qid} className="block text-sm text-ink-700">探す言葉(カテゴリで探す時は空でも可)</label>
            <input id={qid} value={query} onChange={(e) => setQuery(e.target.value)}
              className="mt-1 w-full rounded-md border border-cloud-200 bg-surface px-3 py-2 text-ink-900" />
          </div>
        </div>
        <div role="group" aria-label="カテゴリ" className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}
              data-testid={`nearby-category-${c.id}`}
              className={`min-h-11 rounded-full border px-3 text-sm ${category === c.id
                ? 'border-accent bg-accent text-on-accent' : 'border-cloud-200 bg-surface text-ink-700'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <Button type="submit" loading={busy === 'search'} disabled={Boolean(busy)} data-testid="nearby-search">近くを探す</Button>
      </form>
      {error && <p role="alert" className="mt-3 rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      {results && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-ink-900" aria-live="polite">{`見つかった場所 ${results.length}件 · 出典つき`}</h3>
          {results.length === 0 && <p className="text-sm text-ink-700">見つかりませんでした。半径・カテゴリ・言葉を変えてください。</p>}
          <ul className="mt-2 grid gap-2 md:grid-cols-2" aria-label="見つかった場所">
            {results.map((r) => (
              <li key={r.id} className="rounded-lg border border-cloud-200 p-3 text-sm" data-testid={`nearby-result-${r.id}`}>
                <p className="font-semibold text-ink-900 break-words">{r.name}</p>
                <p className="text-xs text-ink-700">{[r.category, distanceLabel(r)].filter(Boolean).join(' · ')}</p>
                <p className="text-xs text-ink-700">
                  {`出典: ${PROVIDER_LABEL[r.provider] ?? r.provider}${r.retrieved_at ? `・取得 ${r.retrieved_at.slice(0, 16).replace('T', ' ')}` : ''}`}
                </p>
                {r.location.address && <p className="text-xs text-ink-700 break-words">{r.location.address}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {canEdit && (
                    <Button type="button" size="sm" disabled={Boolean(busy) || added[r.id]} loading={busy === r.id}
                      onClick={() => add(r)} data-testid={`nearby-add-${r.id}`}>
                      {added[r.id] ? '候補箱に入れました' : '候補箱へ'}
                    </Button>
                  )}
                  {canEdit && onFindPhoto && (
                    <Button type="button" size="sm" variant="outline" onClick={() => onFindPhoto(r)}>写真を探す</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default NearbyDiscover;
