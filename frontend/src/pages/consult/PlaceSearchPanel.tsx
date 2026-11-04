/**
 * [Gate SearchUAT] 方面の詳細の場所の検索(入口は「候補を探す」の1つ)。
 *
 * - カテゴリ・名前や雰囲気・検索範囲・検索元・実行を一か所にまとめる(以前は OpenStreetMap の「候補を探す」と
 *   「Google で場所を探す」が別々に並び、違いを知らないと使えなかった)
 * - 検索元: OpenStreetMap(無料・既定)/ Google(有料・この相談の利用枠)。Google は会員クラス・鍵の確認・停止・利用枠を
 *   確かめ、使えない時は理由と解決の操作を検索欄の近くに出す。有料への切り替えは利用者が選ぶ(無料の失敗から自動で切り替えない)
 * - 「該当なし」と「提供元の失敗(分類つき)」を分ける。失敗しても入力・前の結果・選んだ候補を残し、もう一度探せる
 * - 結果は検索元を問わず同じ並び・同じ「旅程案に入れる」。出典・取得時刻・未確認のことを示す
 * - 二重押しで二度送らない(押している間は押せない。Google は同じ入力の再試行に同じ Idempotency-Key を使う)
 * - [F03] 送ったかもしれない失敗(通信・時間切れ・5xx・処理中)の後も同じキーを使う(新しいキーにすると二度課金し得る)。
 *   サーバーが「その要求は済んだ」(idempotent_replay)と答えたら、結果は受け取れなかったが原価は計上済みと示し、
 *   新しい検索として探し直すかは利用者が選ぶ
 * - [F04] Google にも画面の検索範囲を送る(範囲を優先するだけで、範囲外も返り得ると示す)
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/common/Button';
import { searchNearby } from '@/services/api/g11discover';
import type { DiscoverCategory, NearbyResult } from '@/services/api/types/g11discover';
import {
  consultErrorCode, consultPlaces, newIdempotencyKey, type ConsultAiStatus, type ConsultUsage,
} from '@/services/api/consultAi';
import { distanceLabel } from '@/pages/discover/discoverModel';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  CONSULT_CATEGORIES, cachedLabel, retrievedLabel, searchErrorMessage, type ConsultCategory, type GooglePick, type SearchSource,
} from './consultModel';
import { googleSearchAvailability, keepIdempotencyKey } from './consultAiModel';
import UiIcon from '@/components/common/UiIcon';
import FindByOther from '@/components/search/FindByOther';
import type { FindModeKey } from '@/components/search/findModel';
import { asKind, avoidKind, KIND_META, KIND_ORDER, matchedPrefs, type PlaceKind } from './placeKinds';

const RADII = [2, 5, 10, 20];

type Point = { latitude: number; longitude: number };

/** 検索元を問わない結果の1行 */
interface Row {
  key: string; source: SearchSource; name: string; detail: string; sourceLabel: string; unverified: string;
  picked: boolean; toggle: () => void;
  /** [Gate PlaceKinds] 種類・代表画像・説明・希望との一致・距離(並べ替え) */
  kind: PlaceKind; thumb: string | null; description: string | null; match: string[]; avoid: boolean;
  distance: number | null; sourceUrl?: string | null;
  /** [Gate AreaSpots] AI のおすすめの特色・理由、人気の目安(記事の大きさ) */
  aiNote?: string | null; aiWhy?: string | null; popularity?: number | null;
}

/** [Gate AreaSpots] 方面の代表的な場所(提案の代表的な場所・AI のおすすめ)。親(旅行相談の画面)が取って渡す */
export interface Recommend {
  rows: NearbyResult[];
  busy: boolean;
  error: string | null;
  /** AI に頼めない理由(使える時は null) */
  blocker: string | null;
  asked: boolean;
  onAsk: () => void;
}

export interface PlaceSearchProps {
  areaName: string;
  base: Point | null;
  picked: Record<string, NearbyResult>;
  pickedGoogle: Record<string, GooglePick>;
  onPick: (r: NearbyResult, on: boolean) => void;
  onPickGoogle: (g: GooglePick, on: boolean) => void;
  google: { status: ConsultAiStatus | null; usage: ConsultUsage | null; ensureSession: () => Promise<string>;
    onUsage: (u: ConsultUsage) => void };
  /** 試験用: 開いた時の自動の検索をしない */
  autoSearch?: boolean;
  /** [Gate PlaceKinds] 旅行相談の「過ごし方」(合う種類の場所を先に並べ、バッジを出す) */
  preferences?: string[];
  recommend?: Recommend;
}

/** [Gate AreaGeo] 結果の出典の名前(観光は OpenStreetMap と Wikipedia の座標付き記事の両方から探す) */
const providerLabel = (p: string): string => (p === 'wikipedia' ? 'Wikipedia' : 'OpenStreetMap');


/** [Gate SpotFind] 探す言葉・場所の上書き(声・SNS の言葉、写真の撮影場所) */
type Over = { q?: string; at?: { latitude: number; longitude: number } };
const PlaceSearchPanel: React.FC<PlaceSearchProps> = ({
  areaName, base, picked, pickedGoogle, onPick, onPickGoogle, google, autoSearch = true, preferences = [], recommend,
}) => {
  const [sortMode, setSortMode] = useState<'recommended' | 'near'>('recommended');
  const [kindFilter, setKindFilter] = useState<PlaceKind | 'all'>('all');
  const [onlyMatch, setOnlyMatch] = useState(false);
  const [resultsVersion, setResultsVersion] = useState(0);
  useEffect(() => { setKindFilter('all'); }, [resultsVersion]);
  const id = useId();
  const [category, setCategory] = useState<ConsultCategory>('sightseeing');
  const [radius, setRadius] = useState(10);
  const [query, setQuery] = useState('');
  const [findMode, setFindMode] = useState<FindModeKey | null>(null);
  const [source, setSource] = useState<SearchSource>('osm');
  const [osm, setOsm] = useState<{ rows: NearbyResult[]; label: string } | null>(null);
  const [gResults, setGResults] = useState<{ rows: GooglePick[]; label: string } | null>(null);
  const [shown, setShown] = useState<SearchSource>('osm');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [failure, setFailure] = useState<{ source: SearchSource; message: string; replayed?: boolean } | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  // [Gate SearchUAT-S3] 保存した結果(外へ送っていない)・提供元の失敗の時の「前の結果」
  const [cached, setCached] = useState<{ age: number; stale: boolean } | null>(null);
  const pendingKey = useRef<{ sig: string; key: string } | null>(null);
  const avail = googleSearchAvailability(google.status, google.usage);
  const catLabel = CONSULT_CATEGORIES.find((c) => c.id === category)?.label ?? '';

  const runOsm = async (over?: Over) => {
    const at = over?.at ?? base;
    if (!at) return;
    const q = (over?.q ?? query).trim();
    const r = await searchNearby({ query: q, category: category as DiscoverCategory, latitude: at.latitude,
      longitude: at.longitude, radius_km: over?.at ? 2 : radius });
    const failed = (r.unavailable_providers ?? []).includes('overpass');
    const message = searchErrorMessage(r.provider_errors?.overpass, r.provider_retry_after?.overpass);
    if (failed && r.candidates.length === 0) {
      setFailure({ source: 'osm', message });
      return; // 前の結果は残す
    }
    const c = r.cached_providers?.overpass;
    setCached(c ? { age: c.age_seconds, stale: c.stale } : null);
    // 提供元は失敗したが、前の結果(古い)を返した: 失敗を示したまま、前の結果を並べる
    if (failed) setFailure({ source: 'osm', message });
    setPartial((r.partial_providers ?? []).includes('overpass'));
    setOsm({ rows: [...r.candidates].sort((a, b) => (a.distance_m ?? 1e12) - (b.distance_m ?? 1e12)),
      label: over?.at ? `${catLabel} · 写真の撮影場所の周り 2km` : `${catLabel}${q ? `「${q}」` : ''} · ${areaName}の周り ${radius}km` });
    setShown('osm');
    setResultsVersion((v) => v + 1);
    if (r.candidates.length === 0) setEmpty(`OpenStreetMap で探しました: ${areaName}の半径${radius}kmに、このカテゴリの場所は見つかりませんでした(該当なし)。半径・カテゴリ・言葉を変えてください。`);
  };

  const runGoogle = async () => {
    const text = [query.trim(), catLabel, areaName].filter(Boolean).join(' ').slice(0, 120);
    const sid = await google.ensureSession();
    const sig = JSON.stringify([sid, text, base, radius]);
    if (pendingKey.current?.sig !== sig) pendingKey.current = { sig, key: newIdempotencyKey() };
    try {
      const r = await consultPlaces(sid, text, base, pendingKey.current.key, radius);
      pendingKey.current = null;
      google.onUsage(r.usage);
      setGResults({ rows: r.results.map((p) => ({ place_id: p.place_id, name: p.name, address: p.address,
        maps_uri: p.maps_uri, retrieved_at: r.retrieved_at })), label: `「${text}」· ${areaName}の周り ${radius}km を優先` });
      setShown('google');
      if (r.results.length === 0) setEmpty(`Google で探しました: 「${text}」に合う場所は見つかりませんでした(該当なし)。言葉を変えてください。`);
    } catch (e) {
      if (consultErrorCode(e) === 'idempotent_replay') {
        // 同じ要求はサーバーで済んでいる(原価は計上済み)。結果はこの画面に届かなかった。探し直しは新しい検索(利用者が選ぶ)
        pendingKey.current = null;
        setFailure({ source: 'google', replayed: true, message: 'この Google の検索は送信済みで、原価は計上されています。結果をこの画面で受け取れませんでした(入力と選んだ候補はそのままです)。探し直すと新しい検索として1回分を使います' });
        return;
      }
      if (!keepIdempotencyKey(e)) pendingKey.current = null; // 送る前に断られた時だけ、新しいキーにする
      setFailure({ source: 'google', message: `${errorDetailMessage(e, 'Google で探せませんでした')}(入力と選んだ候補はそのままです)` });
    }
  };

  const search = async (which: SearchSource = source, over?: Over) => {
    if (busyRef.current) return; // 二重押しで二度送らない
    if (which === 'osm' && !base && !over?.at) return;
    if (which === 'google' && !avail.ok) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    setEmpty(null);
    try {
      if (which === 'osm') await runOsm(over); else await runGoogle();
    } catch (err) {
      if (which === 'google') {
        // ensureSession など、Google の検索の前の失敗(送っていない)
        setFailure({ source: 'google', message: `${errorDetailMessage(err, 'Google で探せませんでした')}(入力と選んだ候補はそのままです)` });
        return;
      }
      const status = (err as { response?: { status?: number } })?.response?.status;
      setFailure({ source: which, message: status === 401 || status === 403
        ? '場所の検索はログインした会員の機能です。ゲストの方は、場所を選ばずに下書きを作り、あとで足せます'
        : 'TravelCanvas のサーバーに届きませんでした(通信)。入力と選んだ候補はそのままです。もう一度探してください' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // 方面を開いたら、その周りの観光の場所を一度だけ自動で探す(無料の OpenStreetMap。空の画面で止めない)
  const autoSearched = useRef(false);
  useEffect(() => {
    if (!autoSearch || autoSearched.current || !base) return;
    autoSearched.current = true;
    void search('osm');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.latitude, base?.longitude]);

  function toRow(r: NearbyResult, prefix: string): Row {
    const kind = asKind(r.kind);
    return {
      key: `${prefix}-${r.id}`, source: 'osm' as const, name: r.name, detail: [distanceLabel(r)].filter(Boolean).join(' · '),
      sourceLabel: `出典: ${providerLabel(r.provider)} ${retrievedLabel(r.retrieved_at)}`, unverified: r.provider === 'wikipedia'
        ? '営業時間・料金は未照会 · 地図上の位置は Wikipedia の記事の座標' : '営業時間は未照会',
      picked: Boolean(picked[r.id]), toggle: () => onPick(r, !picked[r.id]),
      kind, thumb: r.thumbnail_url ?? null, description: r.description ?? null,
      match: matchedPrefs(kind, preferences), avoid: avoidKind(kind, preferences), distance: r.distance_m,
      aiNote: r.ai_note ?? null, aiWhy: r.ai_why ?? null, popularity: r.popularity ?? null,
    };
  }

  const allRows: Row[] = shown === 'google'
    ? (gResults?.rows ?? []).map((g) => ({
      key: `g-${g.place_id}`, source: 'google' as const, name: g.name, detail: g.address ?? '',
      sourceLabel: `出典: Google ${retrievedLabel(g.retrieved_at)}`,
      unverified: '営業時間・料金は未確認 · 下書きには場所の ID と Google マップの URL だけを残します',
      picked: Boolean(pickedGoogle[g.place_id]), toggle: () => onPickGoogle(g, !pickedGoogle[g.place_id]),
      kind: 'other' as PlaceKind, thumb: null, description: null, match: [], avoid: false, distance: null,
    }))
    : (osm?.rows ?? []).map((r) => toRow(r, 'o'))
      // [Gate PlaceKinds / AreaSpots] おすすめ順: 希望に合う種類 → 人混みを避けたい時のテーマパークは後 → 人気(記事の大きさ)→ 近い順
      .sort((a, b) => (sortMode === 'near' ? 0 : (Number(b.match.length > 0) - Number(a.match.length > 0))
        || (Number(a.avoid) - Number(b.avoid)) || ((b.popularity ?? 0) - (a.popularity ?? 0)))
        || ((a.distance ?? 1e12) - (b.distance ?? 1e12)));
  const recRows = (recommend?.rows ?? []).map((r) => toRow(r, 'a'));
  const kindCounts = KIND_ORDER.map((k) => [k, allRows.filter((r) => r.kind === k).length] as const).filter(([, n]) => n > 0);
  const rows = allRows.filter((r) => (kindFilter === 'all' || r.kind === kindFilter) && (!onlyMatch || r.match.length > 0));
  const card = (r: Row) => {
    const meta = KIND_META[r.kind];
    const tid = r.key.startsWith('a-') ? `consult-rec-${r.key.slice(2)}` : `consult-result-${r.key.slice(2)}`;
    return (
                      <li key={r.key} className={`relative overflow-hidden rounded-xl border text-sm ${r.picked ? 'border-accent ring-2 ring-accent' : 'border-cloud-200'}`}
                        data-testid={tid} data-kind={r.kind}
                        style={{ background: `linear-gradient(90deg, ${meta.bg} 0%, transparent 70%)` }}>
                        <div className="flex gap-3 p-3">
                          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg" style={{ background: meta.bg }}
                            aria-hidden="true">
                            {r.thumb
                              ? <img src={r.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                              : <span className="grid h-full w-full place-items-center" style={{ color: meta.fg }}><UiIcon icon={meta.icon} size={34} /></span>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: meta.bg, color: meta.fg }}
                                data-testid={`consult-kind-badge-${r.key.slice(2)}`}>
                                <UiIcon icon={meta.icon} size={12} className="mr-1 align-[-2px]" />{meta.label}</span>
                              {r.match.length > 0 && (
                                <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success"
                                  data-testid={`consult-match-${r.key.slice(2)}`}>{`希望に合う: ${r.match.join('・')}`}</span>
                              )}
                            </div>
                            <p className="mt-1 font-semibold text-ink-900 break-words">{r.name}</p>
                            {r.description && <p className="text-xs text-ink-900 break-words">{r.description}</p>}
                            {r.aiNote && <p className="text-xs text-ink-900 break-words"><b>特色</b>{` ${r.aiNote}`}</p>}
                            {r.aiWhy && <p className="text-xs text-success break-words"><b>おすすめの理由</b>{` ${r.aiWhy}`}</p>}
                            {r.detail && <p className="text-xs text-ink-700 break-words">{r.detail}</p>}
                            <p className="text-[11px] text-ink-700">{`${r.sourceLabel} · ${r.unverified}`}</p>
                            <Button type="button" size="sm" variant={r.picked ? 'primary' : 'outline'} className="mt-2"
                              aria-pressed={r.picked} onClick={r.toggle} data-testid={`consult-pick-${r.key.slice(2)}`}>
                              {r.picked ? '✓ 旅程案に入れる' : '旅程案に入れる'}
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
  };
  const resultLabel = shown === 'google' ? gResults?.label : osm?.label;
  const hasResults = shown === 'google' ? gResults !== null : osm !== null;
  const sourceName = source === 'google' ? 'Google(有料・この相談の利用枠)' : 'OpenStreetMap(無料)';

  return (
    <section aria-labelledby={`${id}-h`} data-testid="consult-place-search">
      <h3 id={`${id}-h`} className="sr-only">候補を探す</h3>
      {recommend && (
        <div className="m-4 rounded-xl border border-accent bg-accent-soft/40 p-3" data-testid="consult-recommend">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-900">{`${areaName}の代表的な場所(おすすめ)`}</p>
            {!recommend.busy && (recommend.blocker ? (
              <span className="text-xs text-ink-700">{`AI のおすすめ: ${recommend.blocker}`}</span>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={recommend.onAsk} data-testid="consult-recommend-ask">
                {recommend.asked ? 'AI にもう一度聞く(AI 1回)' : 'AI におすすめを聞く(AI 1回)'}
              </Button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-700">
            方面の提案の代表的な場所と AI のおすすめを、Wikipedia の記事(位置・写真・説明)に結び付けて表示します。
            近くの検索(下)は中心から近い場所だけのため、少し離れた有名な場所はここに出ます。
          </p>
          {recommend.busy && <p role="status" className="mt-2 text-sm text-ink-900">おすすめの場所を探しています…</p>}
          {recommend.error && <p role="alert" className="mt-2 text-sm text-danger">{recommend.error}</p>}
          {recRows.length > 0 && (
            <ul className="mt-2 grid gap-2 md:grid-cols-2" aria-label="おすすめの場所">{recRows.map((r) => card(r))}</ul>
          )}
          {!recommend.busy && recRows.length === 0 && !recommend.error && (
            <p className="mt-2 text-xs text-ink-700">まだおすすめの場所はありません。</p>
          )}
        </div>
      )}
      {/* [Gate SpotFind] ほかの探し方(スポット検索と同じ部品): 写真の撮影場所・声・SNS の投稿の文 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-cloud-200 px-4 py-2" role="group" aria-label="ほかの探し方">
        <span className="text-xs text-ink-700">ほかの探し方:</span>
        {([['image', '写真から'], ['voice', '声で'], ['sns', 'SNS から']] as const).map(([m, label]) => (
          <button key={m} type="button" aria-pressed={findMode === m} onClick={() => setFindMode(findMode === m ? null : m)}
            data-testid={`consult-find-${m}`}
            className={`tc-focus-ring min-h-9 rounded-full border px-3 text-xs font-semibold ${findMode === m
              ? 'border-accent bg-accent text-on-accent' : 'border-cloud-200 bg-cloud-0 text-ink-900'}`}>{label}</button>
        ))}
      </div>
      {findMode && (
        <div className="border-b border-cloud-200 p-4" data-testid="consult-find-panel">
          <FindByOther mode={findMode} busy={busy}
            onKeyword={(q) => { setQuery(q.slice(0, 100)); setSource('osm'); void search('osm', { q: q.slice(0, 100) }); }}
            onPhotoPlace={(p) => { setSource('osm'); void search('osm', { at: { latitude: p.latitude, longitude: p.longitude } }); }} />
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void search(); }} aria-label="候補を探す"
        className="space-y-3 border-b border-cloud-200 p-4">
        <div role="group" aria-label="何を探す?" className="flex flex-wrap gap-2">
          {CONSULT_CATEGORIES.map((c) => (
            <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}
              data-testid={`consult-category-${c.id}`}
              className={`tc-focus-ring min-h-11 rounded-full border px-3 text-sm ${category === c.id
                ? 'border-accent bg-accent text-on-accent' : 'border-cloud-200 bg-cloud-0 text-ink-700'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-q`} className="text-xs font-semibold text-ink-900">名前・雰囲気(空でも可)</label>
            <input id={`${id}-q`} value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)}
              className="tc-focus-ring mt-1 min-h-11 w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 text-ink-900" />
          </div>
          <div>
            <label htmlFor={`${id}-r`} className="text-xs font-semibold text-ink-900">検索範囲</label>
            <select id={`${id}-r`} value={radius} onChange={(e) => setRadius(Number(e.target.value))}
              className="tc-focus-ring mt-1 min-h-11 rounded-lg border border-cloud-200 bg-cloud-0 px-2 text-ink-900">
              {RADII.map((r) => <option key={r} value={r}>{`半径 ${r}km`}</option>)}
            </select>
          </div>
        </div>
        <fieldset className="rounded-xl border border-cloud-200 p-3" data-testid="consult-search-source">
          <legend className="px-1 text-xs font-semibold text-ink-900">検索元</legend>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="radio" name={`${id}-src`} checked={source === 'osm'} onChange={() => setSource('osm')}
              className="mt-1" data-testid="consult-source-osm" />
            <span><b>OpenStreetMap</b>(無料・地図の公開データ。指定の半径の中を探します)</span>
          </label>
          <label className={`flex min-h-11 items-start gap-2 text-sm ${avail.ok ? '' : 'text-ink-700'}`}>
            <input type="radio" name={`${id}-src`} checked={source === 'google'} disabled={!avail.ok}
              onChange={() => setSource('google')} className="mt-1" data-testid="consult-source-google"
              aria-describedby={`${id}-g`} />
            <span><b>Google</b>(有料・1回ごとにこの相談の利用枠から。方面の周りを優先して探します)</span>
          </label>
          <p id={`${id}-g`} className="pl-6 text-xs text-ink-700" data-testid="consult-google-availability">
            {avail.ok ? `使えます${avail.usage ? ` · ${avail.usage}` : ''}`
              : <>{`今は使えません: ${avail.reason}`}{avail.fix && <span className="block">{`解決: ${avail.fix}`}</span>}</>}
          </p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={busy} disabled={busy || (source === 'osm' ? !base : !avail.ok)}
            data-testid="consult-search">
            {busy ? '探しています…' : '候補を探す'}
          </Button>
          <p className="text-xs text-ink-700" data-testid="consult-search-using">
            {source === 'osm' && !base
              ? '方面の位置が未照会のため、OpenStreetMap では周りを探せません。方面の比較に戻って位置を照会するか、場所を選ばずに下書きを作れます。'
              : `検索元: ${sourceName} · ${areaName}の周り 半径${radius}km${source === 'google'
                ? '(Google は範囲を優先して探します。範囲の外の場所も出ることがあります)' : ''}`}
          </p>
        </div>
      </form>
      {failure && (
        <div role="alert" className="m-4 rounded-lg bg-danger-soft p-3 text-sm text-danger" data-testid="consult-search-error">
          <p>{failure.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void search(failure.source)}
              data-testid="consult-search-retry">{failure.replayed ? '新しい検索として探す(有料・1回)' : 'もう一度探す'}</Button>
            {failure.source === 'osm' && (avail.ok ? (
              <Button type="button" size="sm" variant="outline" disabled={busy}
                onClick={() => { setSource('google'); void search('google'); }} data-testid="consult-search-google">
                Google で探す(有料・この相談の利用枠から1回)
              </Button>
            ) : (
              <span className="text-xs text-ink-700">{`Google では探せません: ${avail.reason}`}</span>
            ))}
          </div>
        </div>
      )}
      <div className="p-4">
        {!hasResults ? (
          <div className="py-6 text-center text-sm text-ink-700" data-testid="consult-results-idle">
            <p className="font-semibold text-ink-900">{busy ? `${areaName}の周りを探しています…` : 'まだ探していません'}</p>
            <p>カテゴリと範囲を選んで「候補を探す」を押すと、場所・距離・出典・取得時刻つきの候補がここに並びます。</p>
          </div>
        ) : (
          <>
            {empty && <p className="py-3 text-sm text-ink-700" data-testid="consult-results-empty">{empty}</p>}
            {cached && shown === 'osm' && (
              <p className={`py-2 text-sm ${cached.stale ? 'text-warning' : 'text-ink-700'}`} data-testid="consult-results-cached">
                {cached.stale
                  ? `今は新しい結果を受け取れないため、前の結果(${cachedLabel(cached.age)}に OpenStreetMap から取得)を表示しています。営業・閉店の変化は反映されていない可能性があります。`
                  : `同じ条件の結果(${cachedLabel(cached.age)}に OpenStreetMap から取得)を使いました。公開の server の混雑を増やさないため、短い時間は送り直しません。`}
              </p>
            )}
            {partial && shown === 'osm' && (
              <p className="py-2 text-sm text-warning" data-testid="consult-results-partial">
                OpenStreetMap の処理が途中で止まったため、一部だけの結果です(他にも場所がある可能性があります)。範囲を小さくするか、もう一度探してください。
              </p>
            )}
            {allRows.length > 0 && (
              <>
                <h4 className="text-sm font-semibold text-ink-900" aria-live="polite">
                  {`見つかった場所 ${rows.length === allRows.length ? rows.length : `${rows.length} / ${allRows.length}`}件 · ${resultLabel ?? ''}`}
                </h4>
                {shown === 'osm' && (
                  <details className="mt-1 text-xs text-ink-700" data-testid="consult-results-logic">
                    <summary className="tc-focus-ring cursor-pointer font-semibold text-ink-900">この候補の探し方</summary>
                    <p className="mt-1">
                      {`${areaName}の中心から半径${radius}kmの場所を、OpenStreetMap(地図の公開データ。観光・食事などの分類)と`}
                      Wikipedia(位置つきの記事)から探しました。市町村そのもの・役所・学校・研究所・駅などの観光の候補でない記事は外し、
                      記事の名前と説明・地図の分類から種類(神社・寺/城・史跡/博物館/自然/公園/温泉/食事/宿泊…)を決めています。
                      {preferences.length > 0 ? ' 並び: あなたの希望(過ごし方)に合う種類を先に、次に近い順。' : ' 並び: 近い順。'}
                      写真は Wikipedia の記事の代表画像(自由なライセンスの画像)で、無い場所は種類の絵を表示します。営業時間・料金は未照会です。
                    </p>
                  </details>
                )}
                {kindCounts.length > 1 && (
                  <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="種類で絞り込む" data-testid="consult-kind-filter">
                    <button type="button" aria-pressed={kindFilter === 'all'} onClick={() => setKindFilter('all')}
                      className={`tc-focus-ring min-h-9 rounded-full border px-3 text-xs ${kindFilter === 'all' ? 'border-accent bg-accent text-on-accent' : 'border-cloud-200 bg-cloud-0 text-ink-900'}`}>
                      {`すべて ${allRows.length}`}
                    </button>
                    {kindCounts.map(([k, n]) => (
                      <button key={k} type="button" aria-pressed={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? 'all' : k)}
                        data-testid={`consult-kind-${k}`}
                        className={`tc-focus-ring min-h-9 rounded-full border px-3 text-xs ${kindFilter === k ? 'border-accent ring-2 ring-accent' : 'border-cloud-200'}`}
                        style={{ background: KIND_META[k].bg, color: KIND_META[k].fg }}>
                        <UiIcon icon={KIND_META[k].icon} size={14} className="mr-1 align-[-2px]" />{`${KIND_META[k].label} ${n}`}
                      </button>
                    ))}
                    {preferences.length > 0 && (
                      <label className="ml-1 inline-flex min-h-9 items-center gap-1 text-xs text-ink-900">
                        <input type="checkbox" checked={onlyMatch} onChange={(e) => setOnlyMatch(e.target.checked)}
                          data-testid="consult-only-match" />
                        希望に合う種類だけ
                      </label>
                    )}
                  </div>
                )}
                {shown === 'osm' && (
                  <div className="mt-2 flex items-center gap-2 text-xs" role="radiogroup" aria-label="並べ方">
                    <span className="text-ink-700">並べ方:</span>
                    {([['recommended', 'おすすめ順(希望・人気)'], ['near', '近い順']] as const).map(([m, label]) => (
                      <button key={m} type="button" role="radio" aria-checked={sortMode === m} onClick={() => setSortMode(m)}
                        data-testid={`consult-sort-${m}`}
                        className={`tc-focus-ring min-h-9 rounded-full border px-3 ${sortMode === m ? 'border-accent bg-accent text-on-accent' : 'border-cloud-200 bg-cloud-0 text-ink-900'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {rows.length === 0 && <p className="py-3 text-sm text-ink-700">この絞り込みに合う場所はありません。絞り込みを外してください。</p>}
                <ul className="mt-2 grid gap-2 md:grid-cols-2" aria-label="見つかった場所">
                  {rows.map((r) => card(r))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default PlaceSearchPanel;
