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
  aiPlacesFromImage, aiPlacesFromText, listWishSpots, placesFromText, readPlaceUrl, type MediaPlace, type UrlRead,
} from '@/services/api/spotIntake';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import PasteImageButton from '@/components/media/PasteImageButton';
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

interface Row extends PlaceDraft { key: string; source: string; detail?: string | null }

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
  const [aiOk, setAiOk] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [read, setRead] = useState<UrlRead | null>(null);

  const reset = () => { setPhoto(null); setRows(null); setError(null); setNote(null); setRead(null); setChecked(new Set()); };
  const switchTab = (next: PlaceTab) => { reset(); onTab(next); };

  const find = async (q0?: string, sourceUrl: string | null = null) => {
    const q = (q0 ?? query).trim();
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
    if (!gps) {
      setNote(planId ? 'この写真に撮影場所(GPS)はありません。「AI で写真の場所を探す」で、写っている場所・店の候補を出せます'
        : 'この写真に撮影場所(GPS)はありません。写真から場所を見分けるのは、旅行の予定の追加で使えます');
    }
  };
  const photoAi = async () => {
    if (!photo || !planId || !aiOk) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const list = await aiPlacesFromImage(planId, photo);
      setRows((prev) => [...(prev ?? []).filter((r) => r.key === 'gps'), ...list.map((p, i) => mediaRow(p, i, null, null))]);
      if (!list.length) setNote('AI でも写真の場所を見分けられませんでした。名前で検索するか、手で入力してください');
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
      if (live) setRows(list.map((s) => ({ key: s.id, name: s.name, address: s.address, latitude: s.latitude, longitude: s.longitude, category: s.category, description: s.description, sourceUrl: null, source: '行きたい場所' })));
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
        <div className="flex gap-2" role="search">
          <label htmlFor="place-q" className="sr-only">場所の名前</label>
          <input id="place-q" type="search" value={query} placeholder="例: 伊勢神宮、金沢 市場" className={inputClass}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(); } }} />
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary shrink-0" disabled={busy || !query.trim()} onClick={() => void find()}>探す</button>
        </div>
      )}
      {tab === 'photo' && (
        <div>
          <ImageDropzone label="写真か、SNS・地図のスクリーンショット" hint="撮影場所(GPS)と、写っている場所・店から候補を出します" file={photo} disabled={busy}
            onFile={(f) => { setPhoto(f); void onPhoto(f); }} />
          <PasteImageButton onImage={(f) => { setPhoto(f); void onPhoto(f); }} disabled={busy} global={tab === 'photo'} testId="finder-paste" />
          {photo && planId && (
            <div className="mt-2 rounded-xl border border-cloud-200 p-3">
              {aiConsent}
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary mt-2" disabled={busy || !aiOk} onClick={() => void photoAi()}
                data-testid="finder-photo-ai">AI で写真の場所を探す</button>
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
              <li key={r.key} className="flex items-center gap-2 p-2.5">
                {many && (
                  <input type="checkbox" checked={checked.has(r.key)} onChange={() => toggle(r.key)} aria-label={`「${r.name}」を選ぶ`}
                    data-testid={`finder-check-${r.name}`} />
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-ink-900 break-words">{r.name}</p>
                  <p className="text-xs text-ink-700 break-words">{r.address ?? '住所は追加の時に自動取得'}{r.source ? ` ・ ${r.source}` : ''}</p>
                  {r.detail && r.detail !== r.name && <p className="text-[11px] text-ink-700 break-words line-clamp-2">{r.detail}</p>}
                </div>
                <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm shrink-0" aria-label={`「${r.name}」を${pickLabel}`} onClick={() => onPick(r)}>{pickLabel}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default PlaceFinder;
