/**
 * [Gate WishPlaces] 行きたい場所(SC-47「場所を探して保存する」)。
 * 本人が保存した場所の一覧・追加・編集・削除と、旅行の予定への追加。
 * 追加は手入力・名前の検索・写真・声・SNS・URL のどれでも入れられ、確かめてから保存する。
 * [Gate TripsWish] 上に数(保存した場所・地図の位置あり・種類)、種類の切り替え(数つき)・名前や住所の絞り込み・並べ替え。
 * カードには種類の絵(PlaceArt。外の画像は読まない)・種類・住所・メモ・保存した日・地図と出典へのリンクを出す。
 * [Gate SpotInfo] 電話(tel: のリンク)・URL(最大 5)・写真(Wikimedia Commons。作者・ライセンスつき・サーバーが中継)・
 * 食事の情報(ジャンル・名物・予算・予約・駐車場など)を持てる。「自動取得」で OpenStreetMap から住所・電話・公式サイト・
 * 食事の情報・場所の写真を入れる(フォームでは候補を選んで入れる。カードの「自動取得」は空の項目だけを埋める)。
 * 新しく保存した時も、空の項目だけを自動で埋める。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Camera, ExternalLink, Globe, Map as MapIcon, MapPin, NotebookPen, Pencil, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import PageHead from '@/components/shell/PageHead';
import PlaceArt from '@/components/shell/PlaceArt';
import PlaceFinder, { type PlaceDraft, type PlaceTab } from '@/components/search/PlaceFinder';
import {
  createWishSpot, deleteWishSpot, enrichWishSpot, listWishSpots, updateWishSpot, type WishInput, type WishSpot,
} from '@/services/api/spotIntake';
import { getPlaceInfo, getPlacePhoto, type PlaceInfoCandidate, type PlaceInfoResult } from '@/services/api/planEdit';
import { appendNotes, mergeUrlRows } from '@/components/places/placeHelpers';
import PlaceSourcesCredit from '@/components/places/PlaceSourcesCredit';
import EventUrlsField from '@/components/planner/EventUrlsField';
import SpotLinks from '@/components/planner/SpotLinks';
import { cleanUrls } from '@/components/planner/spotLinksModel';
import DiningFields from '@/components/dining/DiningFields';
import DiningSummary from '@/components/dining/DiningSummary';
import { cleanDining, mergeEmptyDining, type DiningInfo } from '@/components/dining/diningModel';
import SpotPhotoView, { type SpotPhoto } from '@/components/media/SpotPhotoView';
import ExternalPhotoPicker from '@/components/media/ExternalPhotoPicker';
import type { ExternalImage } from '@/services/api/types/g11discover';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { FILLED_LABEL, localDay, splitNote, toSpotPhoto } from './spotListModel';

const CATEGORIES: [string, string][] = [
  ['sightseeing', '観光地'], ['restaurant', 'レストラン'], ['accommodation', '宿泊'], ['shopping', 'ショッピング'], ['other', 'その他'],
];
const toCategory = (c: string | null): string => {
  if (!c) return 'sightseeing';
  if (CATEGORIES.some(([v]) => v === c)) return c;
  if (/rest|food|dining|cafe|meal/i.test(c)) return 'restaurant';
  if (/hotel|lodging|accom/i.test(c)) return 'accommodation';
  if (/shop|store|market/i.test(c)) return 'shopping';
  return 'sightseeing';
};

interface FormState {
  id: string | null; name: string; category: string; address: string; description: string;
  latitude: number | null; longitude: number | null;
  phone: string; urlRows: string[]; photo: SpotPhoto | null; dining: DiningInfo | null;
}
const EMPTY: FormState = {
  id: null, name: '', category: 'sightseeing', address: '', description: '', latitude: null, longitude: null,
  phone: '', urlRows: [''], photo: null, dining: null,
};
const fieldClass = 'tc-focus-ring w-full min-h-11 rounded-xl border border-cloud-200 bg-cloud-0 px-3 text-ink-900';

const SpotListPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [spots, setSpots] = useState<WishSpot[] | null>(null);
  const [category, setCategory] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [tab, setTab] = useState<PlaceTab>('search');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  // [Gate SpotInfo] 自動取得(フォームの候補)・写真を選ぶ窓・カードごとの自動取得
  const [info, setInfo] = useState<{ busy: boolean; result: PlaceInfoResult | null; error: string | null }>(
    { busy: false, result: null, error: null });
  const [urlError, setUrlError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [enriching, setEnriching] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSpots(await listWishSpots('all'));
      setError(null);
    } catch (e) {
      setSpots([]);
      setError(errorDetailMessage(e, '行きたい場所を読み込めませんでした'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'new' | 'name'>('new');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of spots ?? []) m.set(toCategory(s.category), (m.get(toCategory(s.category)) ?? 0) + 1);
    return m;
  }, [spots]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (spots ?? []).filter((s) => (category === 'all' || toCategory(s.category) === category)
      && (!q || [s.name, s.address, s.description].some((v) => (v ?? '').toLowerCase().includes(q))));
    return [...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'ja') : b.created_at.localeCompare(a.created_at)));
  }, [spots, category, query, sort]);
  const located = (spots ?? []).filter((s) => s.latitude != null && s.longitude != null).length;

  const pick = (d: PlaceDraft) => {
    setForm({
      ...form, name: d.name, category: toCategory(d.category), address: d.address ?? '',
      description: [d.description, d.sourceUrl].filter(Boolean).join('\n'), latitude: d.latitude, longitude: d.longitude,
    });
    setTab('manual');
    setMessage(`「${d.name}」を入れました。確かめて保存してください`);
  };
  const open = () => { setForm(EMPTY); setTab('search'); setMessage(null); setInfo({ busy: false, result: null, error: null }); setAdding(true); };
  const edit = (s: WishSpot) => {
    setForm({
      id: s.id, name: s.name, category: toCategory(s.category), address: s.address ?? '', description: s.description ?? '',
      latitude: s.latitude, longitude: s.longitude, phone: s.phone ?? '', urlRows: s.urls?.length ? s.urls.map((u) => u.url) : [''],
      photo: s.photo ?? null, dining: s.dining ?? null,
    });
    setInfo({ busy: false, result: null, error: null });
    setUrlError(null);
    setTab('manual');
    setMessage(null);
    setAdding(true);
    window.scrollTo?.({ top: 0 });
  };
  // [Gate SpotInfo] フォームの自動取得: 名前(無ければ住所)で OpenStreetMap を 1 回引き、候補を出す。選んだら入れる
  const lookup = async () => {
    const name = form.name.trim() || form.address.trim();
    if (!name) { setInfo({ busy: false, result: null, error: '先に場所の名前か住所を入れてください' }); return; }
    setInfo({ busy: true, result: null, error: null });
    try {
      const result = await getPlaceInfo({ name, latitude: form.latitude, longitude: form.longitude });
      setInfo({
        busy: false, result,
        error: result.unavailable ? '場所の情報の提供元が応答しませんでした。時間をおいて試してください'
          : result.candidates.length === 0 ? (result.keyed_providers?.length ? '見つかりませんでした。正式名称にするか、名前を短くして試してください'
            : '見つかりませんでした。宿・店の情報の提供元(Yahoo!・楽天トラベル・ホットペッパー)の鍵が未登録です(運用コンソールで登録すると見つかりやすくなります)') : null,
      });
    } catch {
      setInfo({ busy: false, result: null, error: '場所の情報を読めませんでした' });
    }
  };
  const applyCandidate = async (c: PlaceInfoCandidate) => {
    const dining = c.dining ? mergeEmptyDining(form.dining, c.dining) : form.dining;
    const rows = mergeUrlRows(form.urlRows, c);
    setForm((f) => ({
      ...f,
      address: c.address ?? f.address,
      phone: c.phone ?? f.phone,
      latitude: c.latitude ?? f.latitude,
      longitude: c.longitude ?? f.longitude,
      category: c.category === 'dining' ? 'restaurant' : c.category === 'accommodation' ? 'accommodation'
        : c.category === 'shopping' ? 'shopping' : f.category,
      urlRows: rows,
      description: appendNotes(f.description, c.notes),
      dining,
    }));
    setInfo({ busy: false, result: null, error: null });
    setMessage(`「${c.name ?? form.name}」の情報を入れました。確かめて保存してください`);
    if (!form.photo && (c.photo_file || c.wikidata)) {
      try {
        const img = await getPlacePhoto({ photo_file: c.photo_file, wikidata: c.wikidata });
        if (img) setForm((f) => (f.photo ? f : { ...f, photo: toSpotPhoto(img) }));
      } catch { /* 写真は無くても入れられる */ }
    }
  };
  // [Gate SpotInfo] カードの自動取得: 空の項目だけを埋める
  const autoFill = async (s: WishSpot, quiet = false) => {
    setEnriching(s.id);
    try {
      const r = await enrichWishSpot(s.id);
      setSpots((list) => (list ? list.map((x) => (x.id === s.id ? r.spot : x)) : list));
      if (r.filled.length) setMessage(`「${s.name}」に ${r.filled.map((k) => FILLED_LABEL[k] ?? k).join('・')} を入れました(出典: ${(r.sources?.length ? r.sources.map((x) => x.credit) : ['© OpenStreetMap contributors']).join('・')})`);
      else if (!quiet) setMessage(r.matched ? `「${s.name}」は入れられる新しい情報がありませんでした` : `「${s.name}」に当てはまる場所が見つかりませんでした`);
    } catch (err) {
      if (!quiet) setError(errorDetailMessage(err, '自動取得できませんでした'));
    } finally {
      setEnriching(null);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('場所の名前を入れてください'); return; }
    const links = cleanUrls(form.urlRows);
    if (links.error) { setUrlError(links.error); return; }
    setUrlError(null);
    setSaving(true);
    setError(null);
    const input: WishInput = {
      name: form.name.trim(), category: form.category, address: form.address.trim() || null, description: form.description.trim() || null,
      latitude: form.latitude, longitude: form.longitude, phone: form.phone.trim() || null, urls: links.urls,
      photo: form.photo, dining: cleanDining(form.dining),
    };
    try {
      let created: WishSpot | null = null;
      if (form.id) await updateWishSpot(form.id, input); else created = await createWishSpot(input);
      setMessage(form.id ? '保存しました' : `「${input.name}」を行きたい場所に保存しました`);
      setForm(EMPTY);
      setAdding(false);
      await load();
      // 新しく保存した場所は、空の項目だけを自動で埋める(失敗しても保存は済んでいる)
      if (created) await autoFill(created, true);
    } catch (err) {
      setError(errorDetailMessage(err, '保存できませんでした'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (s: WishSpot) => {
    if (!window.confirm(`「${s.name}」を行きたい場所から削除しますか?`)) return;
    try {
      await deleteWishSpot(s.id);
      setMessage('削除しました');
      await load();
    } catch (err) {
      setError(errorDetailMessage(err, '削除できませんでした'));
    }
  };

  return (
    <div className="min-h-screen bg-cloud-50">
      <div className="tc-page">
        <PageHead eyebrow="WISHLIST · 行きたい場所" title="行きたい場所" sub="気になる場所をためておき、旅行の予定に入れられます。"
          actions={!adding ? <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" onClick={open}><Plus size={16} aria-hidden="true" />場所を追加</button> : undefined} />
        {error && <p role="alert" className="tc-card px-4 py-3 mb-4 text-sm text-danger">{error}</p>}
        {message && <p role="status" className="tc-card px-4 py-3 mb-4 text-sm text-ink-900">{message}</p>}

        {adding && (
          <section className="tc-card p-5 mb-6" aria-labelledby="wish-add">
            <h2 id="wish-add" className="tc-section-title mb-3">{form.id ? '場所を編集' : '場所を追加'}</h2>
            <PlaceFinder tab={tab} onTab={setTab} onPick={pick} pickLabel="入れる" />
            {tab === 'manual' && (
              <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 mt-1">
                <div className="sm:col-span-2"><label htmlFor="wish-name" className="block text-sm font-medium text-ink-900 mb-1">場所の名前(必須)</label>
                  <input id="wish-name" className={fieldClass} value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><label htmlFor="wish-cat" className="block text-sm font-medium text-ink-900 mb-1">種類</label>
                  <select id="wish-cat" className={fieldClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                <div><label htmlFor="wish-addr" className="block text-sm font-medium text-ink-900 mb-1">住所</label>
                  <input id="wish-addr" className={fieldClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <div><label htmlFor="wish-phone" className="block text-sm font-medium text-ink-900 mb-1">電話番号</label>
                  <input id="wish-phone" type="tel" maxLength={40} className={fieldClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="flex items-end">
                  <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => void lookup()} disabled={info.busy} data-testid="wish-lookup"
                    title="名前(無ければ住所)で探し、住所・電話・公式サイト・食事の情報・写真を入れます(選んでから入れます)">
                    <Globe size={15} aria-hidden="true" />{info.busy ? '探しています…' : '自動取得'}
                  </button>
                </div>
                {(info.error || (info.result && info.result.candidates.length > 0)) && (
                  <div className="sm:col-span-2 rounded-xl border border-cloud-200 bg-cloud-50 p-3 text-sm" data-testid="wish-lookup-result">
                    {info.error && <p role="status" className="text-ink-700">{info.error}</p>}
                    {info.result && info.result.candidates.length > 0 && (
                      <ul className="space-y-2" aria-label="自動取得の候補">
                        {info.result.candidates.map((c, i) => (
                          <li key={`${c.source_url ?? i}`} className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <b className="block text-ink-900">{c.name ?? '名前なし'}</b>
                              <span className="block text-xs text-ink-700 break-words">{[c.address, c.phone, c.website, c.dining?.hours].filter(Boolean).join(' · ')}</span>
                              {c.notes?.map((n) => <span key={n} className="block text-xs text-ink-700 break-words">{n}</span>)}
                              {c.links?.map((l) => <span key={l.url} className="block text-xs text-ink-700 break-words">{`${l.label ?? 'リンク'}: ${l.url}`}</span>)}
                            </span>
                            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary shrink-0" onClick={() => void applyCandidate(c)}
                              data-testid={`wish-lookup-use-${i}`}>入れる</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {info.result && <PlaceSourcesCredit sources={info.result.sources} className="mt-2 text-xs text-ink-700"
                      fallback={`出典: ${info.result.attribution}(${info.result.license})`} />}
                  </div>
                )}
                <div className="sm:col-span-2">
                  <EventUrlsField rows={form.urlRows} onChange={(urlRows) => { setForm({ ...form, urlRows }); setUrlError(null); }} error={urlError} />
                </div>
                <div className="sm:col-span-2 flex flex-wrap items-center gap-3" data-testid="wish-photo">
                  {form.photo ? (
                    <>
                      <SpotPhotoView photo={form.photo} alt={form.name} className="tc-wish-photo-preview" fallback={<span className="text-xs text-ink-700">写真を読めません</span>} />
                      <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setForm({ ...form, photo: null })}>写真を外す</button>
                    </>
                  ) : <span className="text-sm text-ink-700">写真はまだありません(無い時は種類の絵を出します)</span>}
                  <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setPicker(true)} data-testid="wish-photo-pick">
                    <Camera size={14} aria-hidden="true" />{form.photo ? '写真を選び直す' : '写真を選ぶ'}
                  </button>
                </div>
                {form.category === 'restaurant' && (
                  <div className="sm:col-span-2 rounded-xl border border-cloud-200 p-3">
                    <DiningFields value={form.dining} onChange={(dining) => setForm({ ...form, dining })} />
                  </div>
                )}
                <div className="sm:col-span-2"><label htmlFor="wish-desc" className="block text-sm font-medium text-ink-900 mb-1">メモ・出典の URL</label>
                  <textarea id="wish-desc" rows={3} className="tc-focus-ring w-full rounded-xl border border-cloud-200 bg-cloud-0 px-3 py-2 text-ink-900" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <p className="sm:col-span-2 text-xs text-ink-700">{form.latitude != null ? '地図の位置: あり' : '地図の位置: なし(検索・写真・URL から入れると付きます)'}</p>
                <div className="sm:col-span-2 flex gap-2">
                  <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
                  <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => { setAdding(false); setForm(EMPTY); }}>閉じる</button>
                </div>
              </form>
            )}
            {tab !== 'manual' && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-3" onClick={() => setAdding(false)}>閉じる</button>}
            <ExternalPhotoPicker isOpen={picker} onClose={() => setPicker(false)} initialQuery={form.name}
              near={form.latitude != null && form.longitude != null ? { latitude: form.latitude, longitude: form.longitude } : null}
              onPick={(img: ExternalImage) => setForm((f) => ({ ...f, photo: toSpotPhoto(img) }))} purposeLabel="行きたい場所の写真" />
          </section>
        )}

        {spots && spots.length > 0 && (
          <dl className="tc-list-kpis" data-testid="wish-kpis">
            <div><dt>保存した場所</dt><dd>{spots.length}<small> か所</small></dd></div>
            <div><dt>地図の位置あり</dt><dd>{located}<small> か所</small></dd></div>
            <div><dt>種類</dt><dd>{counts.size}<small> 種類</small></dd></div>
          </dl>
        )}
        <div className="tc-section-row mb-3">
          <h2 className="tc-section-title">{`保存した場所${spots ? `(${shown.length}件)` : ''}`}</h2>
        </div>
        {spots && spots.length > 0 && (
          <div className="tc-wish-tools">
            <div className="tc-list-tabs" role="group" aria-label="種類で絞り込む">
              {[['all', 'すべて'] as [string, string], ...CATEGORIES].map(([v, l]) => (
                <button key={v} type="button" aria-pressed={category === v} className="tc-focus-ring" data-testid={`wish-cat-${v}`}
                  onClick={() => setCategory(v)}>{l}<span>{v === 'all' ? spots.length : (counts.get(v) ?? 0)}</span></button>
              ))}
            </div>
            <div className="tc-wish-search">
              <Search size={15} aria-hidden="true" />
              <label htmlFor="wish-q" className="sr-only">名前・住所・メモで絞り込む</label>
              <input id="wish-q" type="search" placeholder="名前・住所・メモで絞り込む" value={query}
                className="tc-focus-ring" onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div>
              <label htmlFor="wish-sort" className="sr-only">並べ替え</label>
              <select id="wish-sort" className="tc-focus-ring tc-wish-sort" value={sort} onChange={(e) => setSort(e.target.value as 'new' | 'name')}>
                <option value="new">保存の新しい順</option><option value="name">名前順</option>
              </select>
            </div>
          </div>
        )}
        {spots === null ? <p role="status" className="text-sm text-ink-700">読み込み中…</p> : shown.length === 0 ? (
          <div className="tc-card p-8 text-center text-ink-700 tc-list-empty">
            <p className="font-medium">{spots.length === 0 ? 'まだ行きたい場所がありません' : query.trim() ? '当てはまる場所はありません' : 'この種類の場所はありません'}</p>
            {spots.length === 0 && !adding && (<>
              <p className="text-sm mt-1 mb-3">名前の検索、写真やスクショ、SNS の投稿、お店のページの URL から追加できます。</p>
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" onClick={open}>最初の場所を追加</button></>)}
          </div>
        ) : (
          <ul className="grid tc-trip-grid" aria-label="行きたい場所の一覧">
            {shown.map((s) => {
              const kind = toCategory(s.category);
              const { memo, links } = splitNote(s.description);
              const source = links.map((u) => safeExternalUrl(u)).find(Boolean) ?? null;
              const map = s.latitude != null && s.longitude != null
                ? safeExternalUrl(`https://www.openstreetmap.org/?mlat=${s.latitude}&mlon=${s.longitude}#map=16/${s.latitude}/${s.longitude}`) : null;
              const saved = localDay(s.created_at);
              return (
                <li key={s.id} aria-label={s.name} className="tc-lcard tc-wish-card" data-testid={`wish-${s.id}`} data-kind={kind}>
                  <div className="tc-wish-art">
                    {s.photo ? <SpotPhotoView photo={s.photo} alt={s.name} fallback={<PlaceArt kind={kind} seed={s.name} />} />
                      : <PlaceArt kind={kind} seed={s.name} />}
                    <span className="tc-trip-chip">{CATEGORIES.find(([v]) => v === kind)?.[1] ?? 'その他'}</span>
                    {map && <span className="tc-trip-chip tc-trip-chip--role"><MapPin size={11} aria-hidden="true" />地図の位置あり</span>}
                  </div>
                  <div className="tc-lcard-body">
                    <h3 className="break-words">{s.name}</h3>
                    {s.address ? <p className="tc-trip-dest"><MapPin size={14} aria-hidden="true" />{s.address}</p>
                      : <p className="tc-trip-dest tc-muted"><MapPin size={14} aria-hidden="true" />住所は未入力</p>}
                    {s.dining && <DiningSummary dining={s.dining} compact />}
                    {memo && <p className="tc-trip-note"><NotebookPen size={14} aria-hidden="true" /><span>{memo}</span></p>}
                    <SpotLinks phone={s.phone} urls={s.urls} className="tc-spot-links--start" />
                    <ul className="tc-trip-stats" aria-label="場所の情報">
                      {saved && <li title="行きたい場所に保存した日"><CalendarDays size={14} aria-hidden="true" />{`${saved} に保存`}</li>}
                      {s.price_range && <li title="価格帯">{s.price_range}</li>}
                    </ul>
                    {(map || source) && (
                      <p className="tc-wish-links">
                        {map && <a href={safeExternalUrl(map) ?? undefined} target="_blank" rel="noopener noreferrer" className="tc-focus-ring"
                          aria-label={`「${s.name}」を地図で見る(新しいタブ)`}><MapIcon size={14} aria-hidden="true" />地図で見る</a>}
                        {source && <a href={safeExternalUrl(source) ?? undefined} target="_blank" rel="noopener noreferrer" className="tc-focus-ring"
                          aria-label={`「${s.name}」の出典を開く(新しいタブ)`}><ExternalLink size={14} aria-hidden="true" />出典を開く</a>}
                      </p>
                    )}
                    <div className="tc-trip-actions">
                      <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" onClick={() => navigate('/planner', { state: { spotId: s.id } })}>旅行に追加</button>
                      <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" aria-label={`「${s.name}」を編集`} onClick={() => edit(s)}><Pencil size={14} aria-hidden="true" />編集</button>
                      <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" aria-label={`「${s.name}」の情報を自動取得`} disabled={enriching === s.id}
                        title="OpenStreetMap から住所・電話・公式サイト・食事の情報・写真を探し、空の項目だけを埋めます" onClick={() => void autoFill(s)}>
                        <Wand2 size={14} aria-hidden="true" />{enriching === s.id ? '取得中…' : '自動取得'}
                      </button>
                      <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-trip-del" aria-label={`「${s.name}」を削除`} onClick={() => void remove(s)}><Trash2 size={14} aria-hidden="true" />削除</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SpotListPage;
