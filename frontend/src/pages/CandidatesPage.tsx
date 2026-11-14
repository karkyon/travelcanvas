/**
 * CandidatesPage - 候補箱(DOC-04 SC-08、FR-007、DOC-14 §7.1/7.2)。
 *
 * [Gate C2] backend/app/api/v1/candidates.py の画面。
 * - URL・テキスト・手入力で候補を足す。URL は追跡用のパラメータを外して出典として残す(サーバーから取りに行かない)
 * - 候補カード: 出典(元の URL・提供元・取得時刻)、登録した人、優先度、状態(候補 / 予定に配置済み / 見送り)、重複の候補(理由つき)
 * - 旅程に追加(日・時刻)。候補は消えない。予定を消すと候補に戻る。重複はまとめられる(自動では消さない)
 * [Gate SpotInfo] まとめると、まとめた側は消える(メモ・出典・住所はまとめ先へ移る)。カードを押すと詳細が開き、
 * 行きたい場所に保存(住所・電話・食事の情報などを自動で入れる)・旅程に追加へ進める。結果の知らせは画面の上に固定して出す。
 * [Gate CandidateFilters] 言葉・状態・種類・エリア・タグ・優先度で絞り込み、優先度・新しい順・名前・基点から近い順で並べる。
 * カード / 一覧(コンパクト)を切り替えられる。絞り込みはこの端末に覚える。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageHead from '@/components/shell/PageHead';
import { useTripContext } from '@/hooks/useTripContext';
import Landscape from '@/components/shell/Landscape';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api, {
  createCandidate, deleteCandidate, getCandidates, mergeCandidate, scheduleCandidate, updateCandidate,
} from '@/services/api';
import type { CandidateList, NormalizedDay, PlanCandidateItem } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';
import NearbyDiscover from './discover/NearbyDiscover';
import DiscoverResults from './discover/DiscoverResults';
import type { BasePoint } from './discover/discoverModel';
import SocialImportCard, { type SocialCandidateInput } from './discover/SocialImportCard';
import CandidateVoting from './candidates/CandidateVoting';
import CandidateDetailDialog from './candidates/CandidateDetailDialog';
import { createCandidateFromSearch } from '@/services/api';
import CandidateInputHelpers from '@/components/candidates/CandidateInputHelpers';
import type { NearbyResult } from '@/services/api/types/g11discover';
import CandidateToolbar from './candidates/CandidateToolbar';
import CandidateTags from './candidates/CandidateTags';
import { EMPTY_FILTER, KIND_LABEL, applyFilter, areaOf, kindOf, type CandidateFilter } from './candidates/candidateFilter';

const DiscoverMap = React.lazy(() => import('./discover/DiscoverMap'));

const FILTER_KEY = 'tc-candidate-filter';
type CandidateView = 'card' | 'list' | 'map';
function loadPrefs(planId: string | undefined): { filter: CandidateFilter; view: CandidateView } {
  try {
    const raw = planId ? window.localStorage.getItem(`${FILTER_KEY}:${planId}`) : null;
    const v = raw ? JSON.parse(raw) as { filter?: Partial<CandidateFilter>; view?: CandidateView } : {};
    return { filter: { ...EMPTY_FILTER, ...(v.filter ?? {}) }, view: v.view === 'list' || v.view === 'map' ? v.view : 'card' };
  } catch {
    return { filter: EMPTY_FILTER, view: 'card' };
  }
}

const SOURCE_KIND_LABEL: Record<string, string> = {
  url: 'URL', text: 'メモ', manual: '手入力', search: '検索', social: 'SNS の投稿',
};
const SOCIAL_PROVIDER_LABEL: Record<string, string> = {
  youtube_oembed: 'YouTube', tiktok_oembed: 'TikTok', instagram_oembed: 'Instagram',
};

const REASON_LABEL: Record<string, string> = {
  same_provider_id: '同じ提供元の場所', same_name: '同じ名前', nearby: '100m以内', same_address: '同じ住所', same_url: '同じURL',
};
const PRIORITY_LABEL: Record<number, string> = { 1: '高', 2: '中', 3: '低' };
const STATUS_BADGE: Record<string, string> = {
  open: 'bg-indigo-50 text-indigo-900', scheduled: 'bg-green-50 text-green-900', dismissed: 'bg-gray-100 text-ink-900',
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const CandidatesPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  // [Gate MockScreens] 上の帯の旅行の切り替えに、この旅行の名前を出す
  useTripContext(planId);
  const [data, setData] = useState<CandidateList | null>(null);
  const [days, setDays] = useState<NormalizedDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<PlanCandidateItem | null>(null);
  const [form, setForm] = useState({ title: '', source_url: '', note: '', priority: 2 });
  const [scheduling, setScheduling] = useState<Record<string, { day_id: string; time: string }>>({});
  const [filter, setFilter] = useState<CandidateFilter>(() => loadPrefs(planId).filter);
  const [view, setView] = useState<CandidateView>(() => loadPrefs(planId).view);
  // [Gate DiscoverUX] 「場所を探す」の検索結果(まだ保存していない)と、保存した結果
  const [nearby, setNearby] = useState<{ results: NearbyResult[]; base: BasePoint | null } | null>(null);
  const [savedResults, setSavedResults] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [sortBaseId, setSortBaseId] = useState<string>('');
  useEffect(() => {
    try {
      if (planId) window.localStorage.setItem(`${FILTER_KEY}:${planId}`, JSON.stringify({ filter, view }));
    } catch { /* 覚えられなくても絞り込みは使える */ }
  }, [planId, filter, view]);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [list, detail] = await Promise.all([getCandidates(planId), api.getPlanDetail(planId)]);
      setData(list);
      setDays(detail.data?.days ?? []);
    } catch (e) {
      setError(errorDetailMessage(e, '候補箱を取得できませんでした'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!planId) return <div className="p-8 text-center text-ink-700">プランが選択されていません。</div>;

  const run = async (fn: () => Promise<CandidateList | void>, done: string, fallback: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fn();
      if (res) setData((d) => ({ ...res, can_edit: d?.can_edit ?? res.can_edit }));
      else await load();
      setMessage(done);
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      title: form.title.trim() || null, source_url: form.source_url.trim() || null, note: form.note.trim() || null,
      priority: form.priority,
    };
    if (!input.title && !input.source_url) {
      setError('名前か URL を入力してください');
      return;
    }
    run(async () => {
      const res = await createCandidate(planId, input);
      setForm({ title: '', source_url: '', note: '', priority: 2 });
      return res;
    }, '候補を追加しました', '候補を追加できませんでした');
  };

  const canEdit = Boolean(data?.can_edit);

  // [Gate G11] 発見: 旅程の場所(座標のある予定)を探す基点にする
  const bases: BasePoint[] = days.flatMap((d) => (d.events ?? [])
    .filter((e) => typeof e.latitude === 'number' && typeof e.longitude === 'number')
    .map((e) => ({ id: e.id, label: `${d.local_date} ${e.title}`, latitude: e.latitude as number, longitude: e.longitude as number })));
  const addFromNearby = async (r: NearbyResult) => {
    await run(() => createCandidateFromSearch(planId, r.id), `「${r.name}」を候補箱に入れました`, '候補箱に入れられませんでした');
  };
  const saveResult = async (r: NearbyResult) => {
    setSavingId(r.id);
    setError(null);
    setMessage(null);
    try {
      const res = await createCandidateFromSearch(planId, r.id);
      if (res) setData((d) => ({ ...res, can_edit: d?.can_edit ?? res.can_edit }));
      else await load();
      setSavedResults((x) => ({ ...x, [r.id]: true }));
      setLastSaved(r.name);
    } catch (e) {
      setError(errorDetailMessage(e, '候補に保存できませんでした'));
    } finally {
      setSavingId(null);
    }
  };
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const addFromSocial = async (input: SocialCandidateInput) => {
    await run(() => createCandidate(planId, {
      title: input.title || null, source_url: input.source_url, note: input.note, address: input.address,
      latitude: input.latitude, longitude: input.longitude,
      ...(input.social ? { source_kind: 'social' as const, platform: input.platform, retrieved_at: input.retrieved_at } : {}),
    }), input.social ? 'SNS の投稿を候補箱に入れました' : 'URL とメモを出典として候補箱に入れました', '候補箱に入れられませんでした');
  };
  const sortBase = bases.find((b) => b.id === sortBaseId) ?? bases[0] ?? null;
  const allItems = data?.items ?? [];
  const items = applyFilter(allItems, filter, sortBase);
  const pickTag = (tag: string) => setFilter((f) => (f.tags.includes(tag) ? f : { ...f, tags: [...f.tags, tag] }));
  const saveTags = (c: PlanCandidateItem, tags: string[]) => run(() => updateCandidate(planId, c.id, { tags }, c.revision),
    `「${c.title}」のタグを保存しました`, 'タグを保存できませんでした');
  const metaOf = (c: PlanCandidateItem) => [KIND_LABEL[kindOf(c)], areaOf(c.address)].filter(Boolean).join(' · ');
  const titleOf = (id: string) => data?.items.find((c) => c.id === id)?.title ?? '';

  const schedule = (c: PlanCandidateItem) => {
    const s = scheduling[c.id] ?? { day_id: days[0]?.id ?? '', time: '' };
    if (!s.day_id) {
      setError('先に日程を作ってください');
      return;
    }
    run(() => scheduleCandidate(planId, c.id, { day_id: s.day_id, local_start_time: s.time || null }, c.revision),
      `「${c.title}」を旅程に追加しました`, '旅程に追加できませんでした。画面を読み込み直してください');
  };

  return (
    <div className="tc-page tc-discover">
      {/* [Gate MockScreens] モックの発見: 近くを探す・SNS の投稿を2列、見つけた候補をカードで、候補箱へ */}
      <PageHead
        eyebrow="DISCOVER · 発見・候補箱"
        title="近くの「行きたい」を集める"
        sub="行きたい場所・気になる店を、まだ予定にしないで候補箱に貯めておけます。旅程に追加しても候補は残り、予定を消すと候補に戻ります。URL はページを取りに行かず、出典として残すだけです(追跡用の付け足しは外します)。"
        actions={<button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => navigate(`/planner/${planId}`)}>← 旅程へ</button>}
      />
      {/* [Gate SpotInfo] 下の方で操作しても見えるよう、知らせは画面の上に固定する */}
      <div className="tc-sticky-note">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
        {message && <div className="p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center"><LoadingSpinner /></div>
      ) : data && (
        <>
          {/* [Gate DiscoverUX] 画面の中の移動(モックアップ 2026-11-10): 探す / この旅行の候補 / 行きたい場所ライブラリ */}
          <nav className="tc-disc-tabs" aria-label="発見の画面の中の移動">
            <button type="button" className="tc-focus-ring" onClick={() => scrollTo('disc-search')}>場所を探す <span>検索</span></button>
            <button type="button" className="tc-focus-ring" onClick={() => scrollTo('disc-saved')}>
              この旅行の候補 <span data-testid="disc-tab-count">{data.counts.open}</span></button>
            <button type="button" className="tc-focus-ring" onClick={() => scrollTo('disc-library')}>行きたい場所ライブラリ <span>共通</span></button>
          </nav>

          <section id="disc-search" className="tc-disc-search" aria-labelledby="disc-search-title">
            <div className="tc-disc-head">
              <div>
                <h2 id="disc-search-title" className="tc-disc-title"><span className="tc-disc-step" aria-hidden="true">01</span>場所を探す</h2>
                <p className="tc-disc-copy">ここに表示されるのは検索結果です。まだこの旅行には保存されていません。</p>
              </div>
              <span className="tc-disc-area-tag">探す場所 · 一時的な検索結果</span>
            </div>
            {canEdit ? (
              <div className="tc-discover-tools">
                <NearbyDiscover bases={bases} canEdit={canEdit} onAddCandidate={addFromNearby}
                  onResults={(results, base) => { setNearby({ results, base }); setLastSaved(null); }} />
                <SocialImportCard planId={planId} canEdit={canEdit} onSave={addFromSocial} />
              </div>
            ) : (
              <p className="text-sm text-ink-700">閲覧だけの参加者は、場所を探して保存できません。</p>
            )}
            {nearby && (
              <DiscoverResults results={nearby.results} base={nearby.base} saved={savedResults} busyId={savingId} canEdit={canEdit}
                onSave={(r) => void saveResult(r)} lastSaved={lastSaved} onViewCandidates={() => scrollTo('disc-saved')} />
            )}
          </section>

          <p className="tc-disc-transition"><span aria-hidden="true">↓</span>「候補に保存」した場所が、ここに追加されます。検索結果とは別の一覧です。</p>

          <section id="disc-saved" className="tc-disc-saved" aria-labelledby="disc-saved-title">
            <header className="tc-disc-saved-head">
              <div className="flex items-center gap-3">
                <span className="tc-disc-step tc-disc-step--light" aria-hidden="true">02</span>
                <div>
                  <h2 id="disc-saved-title" className="m-0 text-base font-bold">{`この旅行に保存済みの候補 ${data.counts.open}`}</h2>
                  <p className="m-0 text-xs">まだ日程は未確定です。行く場所を選んでから日程に配置します。</p>
                </div>
              </div>
              <ul className="tc-disc-totals" aria-label="候補の件数">
                <li><b>{data.counts.open}</b>候補</li>
                <li><b>{data.counts.scheduled}</b>日程に配置済み</li>
                <li><b>{data.counts.dismissed}</b>見送り</li>
                <li><b>{data.counts.open + data.counts.scheduled + data.counts.dismissed}</b>全件</li>
              </ul>
            </header>
          <div className="tc-disc-saved-body">
          <section aria-label="候補の一覧">
            {allItems.length > 0 && (
              <CandidateToolbar items={allItems} shown={items.length} filter={filter} onChange={setFilter} view={view} onView={setView}
                bases={bases} baseId={sortBase?.id ?? ''} onBase={setSortBaseId} />
            )}
            {data.duplicate_pairs > 0 && (
              <p className="text-sm text-amber-900">重複の可能性がある候補が {data.duplicate_pairs}組あります(自動では消しません)。</p>
            )}
            {allItems.length === 0 && <p className="tc-card tc-kit-empty">候補はまだありません。近くを探すか、SNS の投稿・URL から入れられます。</p>}
            {allItems.length > 0 && items.length === 0 && <p className="tc-card tc-kit-empty" data-testid="candidate-none">条件に合う候補がありません。条件を変えるか「条件をクリア」を押してください。</p>}
            {view === 'list' && items.length > 0 && (
              <ul className="tc-card divide-y divide-cloud-200" aria-label="候補の一覧(コンパクト)" data-testid="candidate-list">
                {items.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <button type="button" className="tc-focus-ring min-w-0 flex-1 truncate text-left font-semibold text-ink-900 underline-offset-2 hover:underline"
                      onClick={() => setDetail(c)} data-testid={`candidate-row-${c.id}`}>{c.title}</button>
                    <span className={`text-xs px-2 py-0.5 rounded-sm ${STATUS_BADGE[c.status]}`}>{c.status_label}</span>
                    <span className="text-xs text-ink-700">{metaOf(c)}</span>
                    <span className="text-xs text-ink-700">{`優先度 ${PRIORITY_LABEL[c.priority]}`}</span>
                    {(c.tags ?? []).map((t) => (
                      <button key={t} type="button" className="tc-focus-ring rounded-full bg-cloud-100 px-2 text-xs" onClick={() => pickTag(t)}>#{t}</button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {view === 'map' && (
              <React.Suspense fallback={<p role="status" className="text-sm text-ink-700">地図を読み込み中…</p>}>
                <DiscoverMap base={sortBase} label="この旅行の候補の地図" pins={items
                  .filter((c) => typeof c.latitude === 'number' && typeof c.longitude === 'number')
                  .map((c) => ({ id: c.id, label: c.title, latitude: c.latitude as number, longitude: c.longitude as number,
                    kind: c.status === 'scheduled' ? 'scheduled' as const : 'saved' as const }))}
                  onPick={(id) => { const c = items.find((x) => x.id === id); if (c) setDetail(c); }} />
                {items.some((c) => c.latitude === null || c.longitude === null) && (
                  <p className="mt-1 text-xs text-ink-700">{`地図の位置が分からない候補 ${items.filter((c) => c.latitude === null || c.longitude === null).length}件は地図に出ていません(一覧・カードで見られます)。`}</p>
                )}
              </React.Suspense>
            )}
            <div className="tc-discover-grid" hidden={view !== 'card'}>
            {items.map((c) => {
              const headingId = `cand-${c.id}`;
              const s = scheduling[c.id] ?? { day_id: days[0]?.id ?? '', time: '' };
              return (
                <Card key={c.id} className="tc-discover-card">
                  <button type="button" className="tc-discover-art tc-focus-ring tc-candidate-open" onClick={() => setDetail(c)}
                    aria-label={`「${c.title}」の詳細を開く`} data-testid={`candidate-open-${c.id}`}>
                    <Landscape />
                    <span className="tc-photo-source" aria-hidden="true">{`${SOURCE_KIND_LABEL[c.source_kind] ?? c.source_kind} · 画像のイメージ`}</span>
                  </button>
                  <article aria-labelledby={headingId} className="p-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 id={headingId} className="font-semibold text-ink-900">
                        <button type="button" className="tc-focus-ring tc-candidate-title" onClick={() => setDetail(c)}>{c.title}</button>
                      </h3>
                      <span className={`text-xs px-2 py-0.5 rounded-sm ${STATUS_BADGE[c.status]}`} data-testid="candidate-status">{c.status_label}</span>
                      <span className="text-xs text-ink-700">優先度 {PRIORITY_LABEL[c.priority]}</span>
                      {metaOf(c) && <span className="text-xs text-ink-700" data-testid="candidate-meta">{metaOf(c)}</span>}
                    </div>
                    <p className="text-sm text-ink-700 mt-1">
                      {c.created_by} が {fmt(c.created_at)} に追加
                      {c.source_url && (safeExternalUrl(c.source_url)
                        ? <>・出典 <a className="text-indigo-800 underline" href={safeExternalUrl(c.source_url) ?? undefined} target="_blank" rel="noopener noreferrer nofollow">{c.source_label}</a></>
                        : <>・出典 {c.source_label}</>
                      )}
                      {`・${SOURCE_KIND_LABEL[c.source_kind] ?? c.source_kind}`}
                      {c.provider && `・${SOCIAL_PROVIDER_LABEL[c.provider] ?? c.provider}${c.retrieved_at ? `(${fmt(c.retrieved_at)}取得)` : ''}`}
                    </p>
                    {c.note && <p className="text-sm text-ink-900 mt-1 whitespace-pre-wrap">{c.note}</p>}
                    <CandidateTags title={c.title} tags={c.tags ?? []} canEdit={canEdit} busy={busy} onSave={(tags) => void saveTags(c, tags)}
                      onPick={pickTag} />
                    {c.merged_from.length > 0 && (
                      <p className="text-sm text-ink-900 mt-1">まとめた候補: {c.merged_from.map((m) => m.title).join('、')}</p>
                    )}
                    {c.merged_into_id && <p className="text-sm text-ink-900 mt-1">「{titleOf(c.merged_into_id)}」にまとめました</p>}
                    {c.duplicates.map((d) => (
                      <div key={d.id} className="mt-2 text-sm text-amber-900 flex flex-wrap items-center gap-2">
                        <span>「{d.title}」と重複の可能性({d.reasons.map((r) => REASON_LABEL[r] ?? r).join('・')})</span>
                        {canEdit && c.status !== 'scheduled' && (
                          <Button size="sm" variant="outline" disabled={busy} aria-label={`${c.title}を「${d.title}」にまとめる`}
                            onClick={() => {
                              if (!window.confirm(`「${c.title}」を「${d.title}」にまとめますか?\n「${c.title}」は候補箱から消え、メモ・出典・住所は「${d.title}」へ移ります。`)) return;
                              run(() => mergeCandidate(planId, c.id, d.id, c.revision),
                                `「${c.title}」を「${d.title}」にまとめ、「${c.title}」は候補箱から消しました`, 'まとめられませんでした');
                            }}>
                            こちらを「{d.title}」にまとめる
                          </Button>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        {c.status === 'open' && (
                          <>
                            <label className="text-sm text-ink-900">日
                              <select className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={s.day_id}
                                onChange={(e) => setScheduling((x) => ({ ...x, [c.id]: { ...s, day_id: e.target.value } }))}>
                                {days.map((d) => <option key={d.id} value={d.id}>{d.local_date}{d.title ? ` ${d.title}` : ''}</option>)}
                              </select>
                            </label>
                            <label className="text-sm text-ink-900">時刻
                              <input type="time" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={s.time}
                                onChange={(e) => setScheduling((x) => ({ ...x, [c.id]: { ...s, time: e.target.value } }))} />
                            </label>
                            <Button size="sm" disabled={busy || days.length === 0} onClick={() => schedule(c)}
                              aria-label={`${c.title}を旅程に追加`}>旅程に追加</Button>
                            <Button size="sm" variant="outline" disabled={busy} aria-label={`${c.title}を見送る`}
                              onClick={() => run(() => updateCandidate(planId, c.id, { status: 'dismissed' }, c.revision),
                                `「${c.title}」を見送りにしました`, '変更できませんでした')}>見送る</Button>
                          </>
                        )}
                        {c.status === 'dismissed' && (
                          <Button size="sm" variant="outline" disabled={busy} aria-label={`${c.title}を候補に戻す`}
                            onClick={() => run(() => updateCandidate(planId, c.id, { status: 'open' }, c.revision),
                              `「${c.title}」を候補に戻しました`, '変更できませんでした')}>候補に戻す</Button>
                        )}
                        {c.place_id && (
                          <Link className="text-sm text-indigo-800 underline" to={`/planner/${planId}/places/${c.place_id}`}>場所の詳細</Link>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} aria-label={`${c.title}を削除`}
                          onClick={() => {
                            if (!window.confirm(`「${c.title}」を候補箱から削除しますか?(予定は消えません)`)) return;
                            run(() => deleteCandidate(planId, c.id), `「${c.title}」を削除しました`, '削除できませんでした');
                          }}>削除</Button>
                      </div>
                    )}
                  </article>
                </Card>
              );
            })}
            </div>
          </section>
            <aside id="disc-library" className="tc-disc-library" aria-labelledby="disc-library-title">
              <div>
                <h3 id="disc-library-title" className="m-0 text-sm font-bold text-ink-900">旅行をまたいで保存した場所は「行きたい場所ライブラリ」へ</h3>
                <p className="m-0 text-xs text-ink-700">個人用の保存場所です。ここから旅行を選んで、この旅行の候補へ追加できます。</p>
              </div>
              <Link to="/spots" className="tc-focus-ring tc-mbtn tc-mbtn--sm">ライブラリを見る →</Link>
            </aside>
          </div>
          </section>

          <div className="tc-discover-tools mt-6">
          {canEdit && (
              <Card className="p-4">
                <form aria-label="候補を追加" onSubmit={add} className="space-y-3">
                  <h2 className="text-lg font-semibold text-ink-900">候補を追加</h2>
                  <label className="block text-sm text-ink-900">名前
                    <input className="mt-1 w-full border rounded-sm px-2 py-1 text-ink-900" value={form.title} maxLength={200}
                      onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  </label>
                  {/* [Gate Remaining-7] FR-007 画像・声から名前を入れる */}
                  <CandidateInputHelpers disabled={busy} onPick={(text) => setForm((f) => ({ ...f, title: text }))} />
                  <label className="block text-sm text-ink-900">URL(任意)
                    <input className="mt-1 w-full border rounded-sm px-2 py-1 text-ink-900" value={form.source_url} inputMode="url"
                      onChange={(e) => setForm({ ...form, source_url: e.target.value })} placeholder="https://" />
                  </label>
                  <label className="block text-sm text-ink-900">メモ(任意)
                    <textarea className="mt-1 w-full border rounded-sm px-2 py-1 text-ink-900" value={form.note} maxLength={2000}
                      rows={2} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                  </label>
                  <label className="block text-sm text-ink-900">優先度
                    <select className="ml-2 border rounded-sm px-2 py-1 text-ink-900" value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>
                      {[1, 2, 3].map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                    </select>
                  </label>
                  <Button type="submit" disabled={busy}>候補に追加</Button>
                </form>
              </Card>
            )}
  
            {/* [Gate G11 段階8] 家族・グループで候補に投票する(合意形成の投票を使う) */}
            <CandidateVoting planId={planId} canEdit={canEdit}
              candidates={(data.items ?? []).filter((c) => c.status === 'open').map((c) => ({ id: c.id, title: c.title }))} />
          </div>
        </>
      )}
      <CandidateDetailDialog candidate={detail} planId={planId} canEdit={canEdit} onClose={() => setDetail(null)} onSchedule={schedule} />
    </div>
  );
};

export default CandidatesPage;
