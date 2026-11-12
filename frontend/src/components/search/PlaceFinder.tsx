/**
 * [Gate WishPlaces] 場所の入れ方をまとめた部品(SC-47・SC-08)。行きたい場所の追加と、予定の追加で同じものを使う。
 * 手で入力 / 名前で検索 / 写真・スクショ / 声 / SNS・URL / 行きたい場所(予定の追加だけ)。
 * どの方法も、選ぶと呼び出し元のフォームへ値を入れるだけで、保存は利用者が確かめた後。
 * [Gate SpotFromMedia]
 * - 写真・スクショ: 撮影場所(GPS)と、同意の上で AI(OpenAI)が写真から見分けた場所の候補。クリップボードからも貼れる。
 *   画像の文字を読んで文字で探す(OCR)のはやめた(写真の場所を見分けるのが目的のため)
 * - SNS・URL: YouTube は説明欄(目次)から場所の名前を拾う(鍵がある時)。足りない時は同意の上で AI が補う。
 *   投稿の文を貼っても拾える。候補は複数を選んでまとめて予定に入れられる(onPickMany)
 */
import React, { useEffect, useState } from 'react';
import ImageDropzone from '@/components/common/ImageDropzone';
import { searchSpots } from '@/services/api';
import { searchNearby } from '@/services/api/g11discover';
import {
  aiPlacesFromImage, aiPlacesFromText, findPlaces, listWishSpots, placesFromText, readPlaceUrl, type FindScope, type MediaPlace,
  type UrlRead, type WishSpot,
} from '@/services/api/spotIntake';
import SpotPhotoView from '@/components/media/SpotPhotoView';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import FindByOther from './FindByOther';
import { readExifGps } from './findModel';

export interface PlaceDraft {
  name: string; address: string | null; latitude: number | null; longitude: number | null;
  category: string | null; description: string | null; sourceUrl: string | null;
}
export type PlaceTab = 'manual' | 'search' | 'photo' | 'voice' | 'url' | 'wish';

interface Props {
  tab: PlaceTab;
  onTab: (tab: PlaceTab) => void;
  onPick: (draft: PlaceDraft) => void;
  /** 行きたい場所から選ぶ(予定の追加の時) */
  withWish?: boolean;
  pickLabel?: string;
  /** [Gate SpotFromMedia] 旅行(AI の回数を数える先。無ければ AI の機能は出さない) */
  planId?: string;
  /** 候補を複数選んでまとめて入れる(無ければ 1 件ずつ) */
  onPickMany?: (drafts: PlaceDraft[]) => void;
  /** 名前で検索の言葉(手入力へ移った時に、その名前で自動取得するため) */
  onQuery?: (q: string) => void;
}

const LABELS: [PlaceTab, string][] = [
  ['manual', '手で入力'], ['search', '名前で検索'], ['photo', '写真・スクショ'], ['voice', '声'], ['url', 'SNS・URL'], ['wish', '行きたい場所'],
];
const inputClass = 'tc-focus-ring w-full min-h-11 rounded-xl border border-cloud-200 bg-cloud-0 px-3 text-ink-900';

interface Row extends PlaceDraft {
  key: string; source: string; detail?: string | null;
  /** [Gate PlaceFinderArea] ジャンルの札・この旅行の範囲からの距離・範囲の外・行きたい場所の写真 */
  genre?: string | null; distanceKm?: number | null; outside?: boolean; photo?: WishSpot['photo'] | null;
}

/** [Gate PlaceFinderArea] 名前で検索のジャンル(backend の place_finder.GENRES と同じ) */
const GENRES: [string, string][] = [
  ['all', 'すべて'], ['cafe', 'カフェ'], ['meal', '食事・ランチ'], ['japanese', '和食・郷土料理'], ['ramen', 'ラーメン・麺'],
  ['sweets', 'スイーツ・甘味'], ['izakaya', '居酒屋・夜ごはん'], ['sightseeing', '観光名所'], ['shrine', '神社・寺'],
  ['view', '景色・展望'], ['onsen', '温泉'], ['activity', '体験・遊び'], ['souvenir', '買い物・土産'], ['michinoeki', '道の駅'],
  ['hotel', '宿'],
];
const SCOPES: [FindScope, string][] = [['area', 'この旅行の範囲'], ['route', '経路の近く'], ['all', '全国']];
const CATEGORY_LABEL: Record<string, string> = {
  sightseeing: '観光', dining: '食事', shopping: '買い物', accommodation: '宿', activity: '体験', transportation: '交通', other: 'その他',
};
/** AI が見分けた種類 → 同じ種類の場所を探すジャンル */
const KIND_GENRE: Record<string, string> = { dining: 'meal', sightseeing: 'sightseeing', shopping: 'souvenir', accommodation: 'hotel', activity: 'activity' };
const CONSENT_KEY = 'tc-ai-photo-consent';
const readConsent = (): boolean => { try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; } };
const writeConsent = (v: boolean) => { try { if (v) localStorage.setItem(CONSENT_KEY, '1'); else localStorage.removeItem(CONSENT_KEY); } catch { /* 覚えられなくても動く */ } };

const mediaRow = (p: MediaPlace, i: number, sourceUrl: string | null, title: string | null): Row => ({
  key: `m${i}-${p.name}`, name: p.name, address: p.address ?? (p.area || null), latitude: p.latitude ?? null,
  longitude: p.longitude ?? null, category: p.category ?? null,
  description: [title ? `出典: ${title}` : null, p.context && p.context !== `#${p.name}` ? p.context : null].filter(Boolean).join(' / ') || null,
  sourceUrl,
  source: p.ai ? 'AI が文から' : p.reason ? `AI: ${p.reason}${typeof p.confidence === 'number' ? `(確からしさ ${Math.round(p.confidence * 100)}%)` : ''}`
    : p.time ? `動画 ${p.time}` : p.quoted ? '文の「」' : '文から',
  detail: p.context ?? null,
});

const PlaceFinder: React.FC<Props> = ({ tab, onTab, onPick, withWish = false, pickLabel = '使う', planId, onPickMany, onQuery }) => {
  const [query, setQueryState] = useState('');
  const setQuery = (q: string) => { setQueryState(q); onQuery?.(q); };
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [aiOk, setAiOkState] = useState(readConsent);
  const setAiOk = (v: boolean) => { setAiOkState(v); writeConsent(v); };
  const [genre, setGenre] = useState('all');
  const [scope, setScope] = useState<FindScope>('area');
  const [region, setRegion] = useState<string | null>(null);
  const [credits, setCredits] = useState<string[]>([]);
  const [photoKind, setPhotoKind] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [read, setRead] = useState<UrlRead | null>(null);

  const reset = () => {
    setPhoto(null); setRows(null); setError(null); setNote(null); setRead(null); setChecked(new Set()); setRegion(null); setCredits([]);
    setPhotoKind(null);
  };
  const switchTab = (next: PlaceTab) => { reset(); onTab(next); };

  // [Gate PlaceFinderArea] 旅行の予定の追加: 言葉とジャンルで、この旅行の範囲・経路の近く・全国から探す
  const findInTrip = async (q: string, g: string, sc: FindScope) => {
    if (!planId) return;
    setBusy(true); setError(null); setNote(null); setRows(null);
    try {
      const r = await findPlaces(planId, q, g, sc);
      setRegion(r.region.label);
      setCredits(r.sources.map((s) => s.credit));
      setRows(r.candidates.map((c, i) => ({
        key: `f${i}-${c.name}`, name: c.name, address: c.address, latitude: c.latitude, longitude: c.longitude, category: c.category,
        description: null, sourceUrl: null, source: '', genre: c.genre_label, distanceKm: c.distance_km,
      })));
      if (r.candidates.length === 0) {
        setNote(r.keyed_providers.length === 0
          ? `${r.region.label}では見つかりませんでした。店・施設の検索(Yahoo!・ホットペッパー)の鍵が未登録のため、OpenStreetMap だけで探しています(運用コンソールで登録できます)`
          : `${r.region.label}では見つかりませんでした。言葉・ジャンルを変えるか、範囲を広げてください`);
      }
    } catch (e) {
      setError(errorDetailMessage(e, '検索できませんでした。時間をおいて試すか、手で入力してください'));
    } finally {
      setBusy(false);
    }
  };

  const find = async (q0?: string, sourceUrl: string | null = null) => {
    const q = (q0 ?? query).trim();
    if (planId && !sourceUrl) {
      if (!q && genre === 'all') return;
      setQuery(q);
      await findInTrip(q, genre, scope);
      return;
    }
    if (!q) return;
    setQuery(q);
    setBusy(true);
    setError(null);
    try {
      const r = await searchSpots({ query: q, max_results: 8 });
      if (!r.success) throw new Error('search');
      const list = (r.data?.spots ?? []) as unknown as {
        id: string; name: string; category?: string; provider?: string; address?: string;
        location?: { latitude?: number; longitude?: number; address?: string };
      }[];
      setRows(list.map((s) => ({
        key: s.id, name: s.name, address: s.location?.address ?? s.address ?? null, latitude: s.location?.latitude ?? null,
        longitude: s.location?.longitude ?? null, category: s.category ?? null, description: null, sourceUrl,
        source: s.provider ?? '',
      })));
    } catch {
      setError('検索できませんでした。時間をおいて試すか、手で入力してください');
    } finally {
      setBusy(false);
    }
  };

  const findNear = async (latitude: number, longitude: number) => {
    setBusy(true);
    try {
      const r = await searchNearby({ query: '', category: 'sightseeing', latitude, longitude, radius_km: 2 });
      setRows([
        { key: 'gps', name: '写真の撮影場所', address: null, latitude, longitude, category: null, description: null, sourceUrl: null, source: '写真の位置情報' },
        ...r.candidates.map((c) => ({
          key: c.id, name: c.name, address: c.location.address ?? null, latitude: c.location.latitude ?? null, longitude: c.location.longitude ?? null,
          category: c.kind ?? c.category ?? null, description: c.description ?? null, sourceUrl: null, source: '近くの場所',
        })),
      ]);
    } catch {
      setRows([{ key: 'gps', name: '写真の撮影場所', address: null, latitude, longitude, category: null, description: null, sourceUrl: null, source: '写真の位置情報' }]);
      setNote('近くの場所は探せませんでした。撮影場所はそのまま使えます');
    } finally {
      setBusy(false);
    }
  };

  // [Gate SpotFromMedia] 写真: 撮影場所(GPS)があればその近く。無ければ、同意の上で AI が写真から場所を見分ける
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setRows(null); setError(null); setNote(null); setChecked(new Set());
    setBusy(true);
    let gps = null;
    try { gps = readExifGps(await file.arrayBuffer()); } catch { gps = null; }
    if (gps) await findNear(gps.latitude, gps.longitude);
    setBusy(false);
    // [Gate PlaceFinderArea] Web などから取った写真には撮影場所が無いのが普通。写真に写っている物から場所を見分ける(同意済みならすぐ)
    if (!gps && planId && aiOk) await photoAi(file);
    else if (!gps) {
      setNote(planId ? '写っている建物・景色・看板から場所の候補を出します。下で AI へ送ることに同意して「写真から場所を探す」を押してください'
        : '写真から場所を見分けるのは、旅行の予定の追加で使えます');
    }
  };
  const photoAi = async (file?: File) => {
    const f = file ?? photo;
    if (!f || !planId || !aiOk) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const list = await aiPlacesFromImage(planId, f);
      setRows((prev) => [...(prev ?? []).filter((r) => r.key === 'gps'), ...list.map((p, i) => ({
        ...mediaRow(p, i, null, null), distanceKm: p.distance_km ?? null, outside: p.in_trip === false,
        genre: p.category ? CATEGORY_LABEL[p.category] ?? null : null,
      }))]);
      setPhotoKind(list.find((p) => p.category && KIND_GENRE[p.category])?.category ?? null);
      if (!list.length) setNote('写真から場所を見分けられませんでした。下の「この旅行の範囲で探す」か、名前で検索してください');
      else if (list.every((p) => p.in_trip === false)) setNote('見分けた場所は、どれもこの旅行の範囲の外です(範囲の外の印を付けています)');
    } catch (e) {
      setError(errorDetailMessage(e, 'AI で写真の場所を探せませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const fromText = async (text: string, title: string | null, sourceUrl: string | null) => {
    if (!text.trim()) return;
    setBusy(true); setError(null); setChecked(new Set());
    try {
      const list = await placesFromText(text, title);
      setRows(list.map((p, i) => mediaRow(p, i, sourceUrl, title)));
    } catch (e) {
      setError(errorDetailMessage(e, '文から場所を拾えませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const textAi = async () => {
    const text = read?.description || paste;
    if (!planId || !aiOk || !text.trim()) return;
    setBusy(true); setError(null);
    try {
      const list = await aiPlacesFromText(planId, text, read?.title ?? null);
      setRows(list.map((p, i) => mediaRow(p, i, read?.url ?? (url.trim() || null), read?.title ?? null)));
    } catch (e) {
      setError(errorDetailMessage(e, 'AI で場所を補えませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const onUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    reset();
    setBusy(true);
    try {
      const r = await readPlaceUrl(url.trim());
      setRead(r);
      const fromPlaces = (r.places ?? []).map((p, i) => mediaRow(p, i, r.url, r.title));
      const names = new Set(fromPlaces.map((x) => x.name));
      setRows([...fromPlaces, ...r.suggestions.filter((s) => !names.has(s.name)).map((s, i) => ({
        key: `s${i}`, name: s.name, address: s.address, latitude: s.latitude, longitude: s.longitude, category: null,
        description: r.title, sourceUrl: r.url, source: `投稿の「${s.word}」から`,
      }))]);
      if (r.kind === 'sns' && r.description_available === false) {
        setNote('YouTube の説明欄を自動で読むには、運用コンソールで YouTube Data API の鍵を登録してください。説明欄を下に貼っても探せます');
      }
    } catch (err) {
      setError(errorDetailMessage(err, 'URL を読み取れませんでした'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (tab !== 'wish') return;
    let live = true;
    setBusy(true);
    listWishSpots('all').then((list) => {
      if (live) setRows(list.map((s) => ({ key: s.id, name: s.name, address: s.address, latitude: s.latitude, longitude: s.longitude, category: s.category, description: s.description, sourceUrl: null, source: '',
        // [Gate PlaceFinderArea] 写真とジャンルの札(食事は料理のジャンル)
        genre: [CATEGORY_LABEL[s.category] ?? null, ...(s.dining?.genres ?? []).slice(0, 2)].filter(Boolean).join('・') || null,
        photo: s.photo ?? null })));
    }).catch(() => { if (live) setError('行きたい場所を読み込めませんでした'); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [tab]);

  const many = !!onPickMany && (tab === 'url' || tab === 'photo') && !!rows && rows.length > 1;
  const toggle = (key: string) => setChecked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const aiConsent = planId && (
    <label className="mt-2 flex items-start gap-2 text-xs text-ink-700">
      <input type="checkbox" checked={aiOk} onChange={(e) => setAiOk(e.target.checked)} data-testid="finder-ai-consent" />
      <span>AI(OpenAI)へ{tab === 'photo' ? '写真(撮影情報は消して縮めたもの)' : '文'}を送ることに同意する(AI の回数を 1 回使います。保存はしません)</span>
    </label>
  );

  return (
    <div data-testid="place-finder">
      <div role="tablist" aria-label="場所の入れ方" className="flex flex-wrap gap-1.5 mb-3">
        {LABELS.filter(([k]) => withWish || k !== 'wish').map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => switchTab(k)}
            className={`tc-focus-ring tc-mbtn tc-mbtn--sm ${tab === k ? 'tc-mbtn--primary' : ''}`}>{label}</button>
        ))}
      </div>
      {tab === 'search' && (
        <div className="space-y-2">
          <div className="flex gap-2" role="search">
            <label htmlFor="place-q" className="sr-only">場所の名前</label>
            <input id="place-q" type="search" value={query} placeholder={planId ? '例: 赤福、菰野 (ジャンルだけでも探せます)' : '例: 伊勢神宮、金沢 市場'} className={inputClass}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(); } }} />
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary shrink-0" data-testid="finder-search"
              disabled={busy || (!query.trim() && (!planId || genre === 'all'))} onClick={() => void find()}>探す</button>
          </div>
          {planId && (
            <>
              <div>
                <label htmlFor="place-genre" className="text-xs font-semibold text-ink-700">ジャンル</label>
                <select id="place-genre" className={`${inputClass} mt-1 min-h-10`} value={genre} data-testid="finder-genre"
                  onChange={(e) => setGenre(e.target.value)}>
                  {GENRES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-800">
                <legend className="text-xs font-semibold text-ink-700 mb-1">探す範囲</legend>
                {SCOPES.map(([k, label]) => (
                  <label key={k} className="inline-flex items-center gap-1">
                    <input type="radio" name="place-scope" value={k} checked={scope === k} onChange={() => setScope(k)}
                      data-testid={`finder-scope-${k}`} />{label}
                  </label>
                ))}
              </fieldset>
            </>
          )}
        </div>
      )}
      {tab === 'photo' && (
        <div>
          <ImageDropzone label="写真か、SNS・地図のスクリーンショット" hint="写っている建物・景色・看板から場所の候補を出します(撮影場所が入った写真ならその近くも)" file={photo} disabled={busy}
            onFile={(f) => { setPhoto(f); void onPhoto(f); }} pasteGlobal={tab === 'photo'} pasteTestId="finder-paste" />
          {photo && planId && (
            <div className="mt-2 rounded-xl border border-cloud-200 p-3">
              {aiConsent}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy || !aiOk} onClick={() => void photoAi()}
                  data-testid="finder-photo-ai">写真から場所を探す(AI)</button>
                {/* [Gate PlaceFinderArea] 見分けた種類(無ければ観光)で、この旅行の範囲から似た場所を探す(AI を使わない) */}
                <button type="button" className="tc-focus-ring tc-mbtn" disabled={busy} data-testid="finder-photo-similar"
                  onClick={() => void findInTrip('', KIND_GENRE[photoKind ?? ''] ?? 'sightseeing', 'area')}>
                  {`この旅行の範囲で${photoKind && KIND_GENRE[photoKind] ? `同じ種類(${CATEGORY_LABEL[photoKind]})の` : '観光の'}場所を探す`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {tab === 'voice' && <FindByOther mode="voice" busy={busy} onKeyword={(q) => void find(q)} onPhotoPlace={() => undefined} />}
      {tab === 'url' && (
        <div className="space-y-3">
          <form onSubmit={onUrl} className="flex gap-2">
            <label htmlFor="place-url" className="sr-only">URL</label>
            <input id="place-url" type="url" value={url} placeholder="https:// (お店・宿のページ、YouTube・TikTok・Instagram の投稿)" className={inputClass} onChange={(e) => setUrl(e.target.value)} />
            <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--primary shrink-0" disabled={busy || !url.trim()}>読む</button>
          </form>
          {read && !read.ok && <p className="text-sm text-warning" role="status">{read.reason ?? 'この URL から読み取れませんでした'}。投稿の文を下に貼るか、手で入力してください。</p>}
          {read?.ok && read.kind === 'page' && (
            <div className="rounded-xl border border-cloud-200 p-3 text-sm">
              <p className="font-semibold text-ink-900">{read.name ?? 'ページの題名なし'}</p>
              {read.address && <p className="text-ink-700">{read.address}</p>}
              {read.description && <p className="text-xs text-ink-700 line-clamp-2">{read.description}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" onClick={() => onPick({ name: read.name ?? '', address: read.address, latitude: read.latitude, longitude: read.longitude, category: null, description: read.description, sourceUrl: read.url })}>{pickLabel}</button>
                {read.name && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => void find(read.name ?? '', read.url)}>この名前で地図を探す</button>}
              </div>
            </div>
          )}
          {read?.ok && read.kind === 'sns' && <p className="text-sm text-ink-900">{`投稿: ${read.title ?? '題名なし'}${read.author ? `(${read.author})` : ''}`}</p>}
          <div>
            <label htmlFor="place-paste" className="block text-sm font-medium text-ink-900 mb-1">投稿の文・説明欄を貼る(YouTube の目次にも対応)</label>
            <textarea id="place-paste" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} className="tc-focus-ring w-full rounded-xl border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900" placeholder="例: 1:04 二見興玉神社 / 7:18 おはらい町&おかげ横丁 #赤福" />
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-2" disabled={busy || !paste.trim()} data-testid="finder-paste-find"
              onClick={() => void fromText(paste, read?.title ?? null, read?.url ?? (url.trim() || null))}>この文から場所を拾う</button>
          </div>
          {planId && (read?.description || paste.trim()) && (
            <div className="rounded-xl border border-cloud-200 p-3">
              <p className="text-xs text-ink-700">文の規則で拾えない場所は、AI で補えます(文に書かれている場所だけを出します)。</p>
              {aiConsent}
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-2" disabled={busy || !aiOk} onClick={() => void textAi()}
                data-testid="finder-text-ai">AI で場所を補う</button>
            </div>
          )}
        </div>
      )}

      <div aria-live="polite">
        {busy && <p className="mt-3 text-sm text-ink-700" role="status">読み取っています…</p>}
        {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
        {note && <p className="mt-3 text-sm text-warning" role="status">{note}</p>}
        {region && rows && <p className="mt-2 text-xs text-ink-700" data-testid="finder-region">{`探した範囲: ${region}`}</p>}
        {tab !== 'manual' && rows && rows.length === 0 && !busy && (
          <p className="mt-3 text-sm text-ink-700">{tab === 'wish' ? '行きたい場所はまだありません。' : tab === 'url' ? '場所の候補は見つかりませんでした。' : '見つかりませんでした。言葉を変えるか、手で入力してください。'}</p>
        )}
        {many && (
          <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="finder-many">
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setChecked(checked.size === rows!.length ? new Set() : new Set(rows!.map((r) => r.key)))}>
              {checked.size === rows!.length ? '選択をすべて外す' : 'すべて選ぶ'}</button>
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" disabled={checked.size === 0}
              data-testid="finder-add-many" onClick={() => onPickMany!(rows!.filter((r) => checked.has(r.key)))}>
              {`選んだ ${checked.size} 件を予定に追加`}</button>
            <span className="text-xs text-ink-700">住所・地図の位置は追加する時に自動取得します</span>
          </div>
        )}
        {tab !== 'manual' && rows && rows.length > 0 && (
          <ul className="mt-3 divide-y divide-cloud-200 max-h-72 overflow-y-auto rounded-xl border border-cloud-200">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-2 p-2.5" data-testid={`finder-row-${r.name}`}>
                {many && (
                  <input type="checkbox" checked={checked.has(r.key)} onChange={() => toggle(r.key)} aria-label={`「${r.name}」を選ぶ`}
                    data-testid={`finder-check-${r.name}`} />
                )}
                {tab === 'wish' && (
                  <div className="tc-finder-thumb" aria-hidden={r.photo ? undefined : true}>
                    {r.photo ? <SpotPhotoView photo={r.photo} alt={r.name} fallback={<span className="tc-finder-thumb-none">写真なし</span>} />
                      : <span className="tc-finder-thumb-none">写真なし</span>}
                  </div>
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-ink-900 break-words">
                    {r.name}
                    {r.genre && <span className="tc-finder-genre" data-testid="finder-genre-badge">{r.genre}</span>}
                    {r.outside && <span className="tc-finder-outside">旅行の範囲の外</span>}
                    {r.distanceKm != null && <span className="tc-finder-dist">{scope === 'route' && tab === 'search' ? `経路から ${r.distanceKm}km` : `${r.distanceKm}km`}</span>}
                  </p>
                  <p className="text-xs text-ink-700 break-words">{r.address ?? '住所は追加の時に自動取得'}{r.source ? ` ・ ${r.source}` : ''}</p>
                  {r.detail && r.detail !== r.name && <p className="text-[11px] text-ink-700 break-words line-clamp-2">{r.detail}</p>}
                </div>
                <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm shrink-0" aria-label={`「${r.name}」を${pickLabel}`} onClick={() => onPick(r)}>{pickLabel}</button>
              </li>
            ))}
          </ul>
        )}
        {credits.length > 0 && rows && rows.length > 0 && (
          <p className="mt-1 text-[11px] text-ink-500" data-testid="finder-credits">{credits.join(' / ')}</p>
        )}
      </div>
    </div>
  );
};

export default PlaceFinder;
