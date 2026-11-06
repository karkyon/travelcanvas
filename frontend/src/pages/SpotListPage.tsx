/**
 * [Gate WishPlaces] 行きたい場所(SC-47「場所を探して保存する」)。
 * 本人が保存した場所の一覧・追加・編集・削除と、旅行の予定への追加。
 * 追加は手入力・名前の検索・写真・声・SNS・URL のどれでも入れられ、確かめてから保存する。
 * [Gate TripsWish] 上に数(保存した場所・地図の位置あり・種類)、種類の切り替え(数つき)・名前や住所の絞り込み・並べ替え。
 * カードには種類の絵(PlaceArt。外の画像は読まない)・種類・住所・メモ・保存した日・地図と出典へのリンクを出す。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, ExternalLink, Map as MapIcon, MapPin, NotebookPen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import PageHead from '@/components/shell/PageHead';
import PlaceArt from '@/components/shell/PlaceArt';
import PlaceFinder, { type PlaceDraft, type PlaceTab } from '@/components/search/PlaceFinder';
import { createWishSpot, deleteWishSpot, listWishSpots, updateWishSpot, type WishSpot } from '@/services/api/spotIntake';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { localDay, splitNote } from './spotListModel';

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
}
const EMPTY: FormState = { id: null, name: '', category: 'sightseeing', address: '', description: '', latitude: null, longitude: null };
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
      id: form.id, name: d.name, category: toCategory(d.category), address: d.address ?? '',
      description: [d.description, d.sourceUrl].filter(Boolean).join('\n'), latitude: d.latitude, longitude: d.longitude,
    });
    setTab('manual');
    setMessage(`「${d.name}」を入れました。確かめて保存してください`);
  };
  const open = () => { setForm(EMPTY); setTab('search'); setMessage(null); setAdding(true); };
  const edit = (s: WishSpot) => {
    setForm({ id: s.id, name: s.name, category: toCategory(s.category), address: s.address ?? '', description: s.description ?? '', latitude: s.latitude, longitude: s.longitude });
    setTab('manual');
    setMessage(null);
    setAdding(true);
    window.scrollTo?.({ top: 0 });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('場所の名前を入れてください'); return; }
    setSaving(true);
    setError(null);
    const input = { name: form.name.trim(), category: form.category, address: form.address.trim() || null, description: form.description.trim() || null, latitude: form.latitude, longitude: form.longitude };
    try {
      if (form.id) await updateWishSpot(form.id, input); else await createWishSpot(input);
      setMessage(form.id ? '保存しました' : `「${input.name}」を行きたい場所に保存しました`);
      setForm(EMPTY);
      setAdding(false);
      await load();
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
                    <PlaceArt kind={kind} seed={s.name} />
                    <span className="tc-trip-chip">{CATEGORIES.find(([v]) => v === kind)?.[1] ?? 'その他'}</span>
                    {map && <span className="tc-trip-chip tc-trip-chip--role"><MapPin size={11} aria-hidden="true" />地図の位置あり</span>}
                  </div>
                  <div className="tc-lcard-body">
                    <h3 className="break-words">{s.name}</h3>
                    {s.address ? <p className="tc-trip-dest"><MapPin size={14} aria-hidden="true" />{s.address}</p>
                      : <p className="tc-trip-dest tc-muted"><MapPin size={14} aria-hidden="true" />住所は未入力</p>}
                    {memo && <p className="tc-trip-note"><NotebookPen size={14} aria-hidden="true" /><span>{memo}</span></p>}
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
