/**
 * [Gate WishPlaces] 場所の入れ方をまとめた部品(SC-47・SC-08)。行きたい場所の追加と、予定の追加で同じものを使う。
 * 手で入力 / 名前で検索 / 写真・スクショ / 声 / SNS・URL / 行きたい場所(予定の追加だけ)。
 * どの方法も、選ぶと呼び出し元のフォームへ値を入れるだけで、保存は利用者が確かめた後。
 */
import React, { useEffect, useState } from 'react';
import ImageDropzone from '@/components/common/ImageDropzone';
import { searchSpots } from '@/services/api';
import { searchNearby } from '@/services/api/g11discover';
import { listWishSpots, readPlaceImage, readPlaceUrl, type UrlRead } from '@/services/api/spotIntake';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import FindByOther from './FindByOther';
import { readExifGps, snsKeywords, spotsFromTimeline } from './findModel';

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
}

const LABELS: [PlaceTab, string][] = [
  ['manual', '手で入力'], ['search', '名前で検索'], ['photo', '写真・スクショ'], ['voice', '声'], ['url', 'SNS・URL'], ['wish', '行きたい場所'],
];
const inputClass = 'tc-focus-ring w-full min-h-11 rounded-xl border border-cloud-200 bg-cloud-0 px-3 text-ink-900';

interface Row extends PlaceDraft { key: string; source: string }

const PlaceFinder: React.FC<Props> = ({ tab, onTab, onPick, withWish = false, pickLabel = '使う' }) => {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [read, setRead] = useState<UrlRead | null>(null);

  const reset = () => { setPhoto(null); setRows(null); setError(null); setNote(null); setWords([]); setRead(null); };
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

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setRows(null); setError(null); setNote(null); setWords([]);
    setBusy(true);
    let gps = null;
    try { gps = readExifGps(await file.arrayBuffer()); } catch { gps = null; }
    if (gps) await findNear(gps.latitude, gps.longitude);
    setBusy(true);
    try {
      const r = await readPlaceImage(file);
      setWords(r.words);
      if (!gps && r.words.length === 0) setNote('撮影場所も、場所の名前らしい文字も読み取れませんでした。名前で検索するか、手で入力してください');
      else if (!gps) setNote('この画像に撮影場所はありません。読み取った文字から選んで探してください');
    } catch (e) {
      setError(errorDetailMessage(e, '画像を読み取れませんでした'));
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
      setRows(r.suggestions.map((s, i) => ({
        key: `s${i}`, name: s.name, address: s.address, latitude: s.latitude, longitude: s.longitude, category: null,
        description: r.title, sourceUrl: r.url, source: `投稿の「${s.word}」から`,
      })));
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

  const pasted = spotsFromTimeline(paste).map((s) => s.name);
  const pastedWords = pasted.length ? pasted : snsKeywords(paste).keywords;

  const wordButtons = (list: string[], from: string | null) => list.length > 0 && (
    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="読み取った言葉(押すと探す)">
      {list.map((w) => (
        <button key={w} type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy} onClick={() => void find(w, from)}>{`「${w}」で探す`}</button>
      ))}
    </div>
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
          <ImageDropzone label="写真か、SNS・地図のスクリーンショット" hint="撮影場所と画像の中の文字から探します。保存せず、外部へ送りません" file={photo} disabled={busy}
            onFile={(f) => { setPhoto(f); void onPhoto(f); }}>
            {words.length > 0 ? <p className="text-sm font-medium text-ink-900">読み取った文字</p> : !busy && <p className="text-sm text-ink-700">読み取った文字はありません</p>}
            {wordButtons(words, null)}
          </ImageDropzone>
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
            <textarea id="place-paste" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} className="tc-focus-ring w-full rounded-xl border border-cloud-200 bg-cloud-0 px-3 py-2 text-sm text-ink-900" placeholder="例: 伊勢神宮にお参り #おかげ横丁 #赤福" />
            {wordButtons(pastedWords, url.trim() || null)}
          </div>
        </div>
      )}

      <div aria-live="polite">
        {busy && <p className="mt-3 text-sm text-ink-700" role="status">読み取っています…</p>}
        {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
        {note && <p className="mt-3 text-sm text-warning" role="status">{note}</p>}
        {tab !== 'manual' && rows && rows.length === 0 && !busy && (
          <p className="mt-3 text-sm text-ink-700">{tab === 'wish' ? '行きたい場所はまだありません。' : tab === 'url' ? '場所の候補は見つかりませんでした。' : '見つかりませんでした。言葉を変えるか、手で入力してください。'}</p>
        )}
        {tab !== 'manual' && rows && rows.length > 0 && (
          <ul className="mt-3 divide-y divide-cloud-200 max-h-72 overflow-y-auto rounded-xl border border-cloud-200">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-2 p-2.5">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-ink-900 break-words">{r.name}</p>
                  <p className="text-xs text-ink-700 break-words">{r.address ?? '住所の情報なし'}{r.source ? ` ・ ${r.source}` : ''}{r.latitude == null ? ' ・ 地図の位置なし' : ''}</p>
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
