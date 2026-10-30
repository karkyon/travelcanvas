/**
 * [Gate G11] 旅行相談の4: 方面の詳細(2026-10-29 の統合ハンドオフ §3「4) 方面詳細→旅程ドラフト」)。
 *
 * - カテゴリ(観光・食べ物・市場・買い物・絶景・静かに過ごす)と半径で、方面の位置の周りを探す(OpenStreetMap)
 * - 見つけた場所は「旅程案に入れる」で選ぶ(出典と取得時刻を残す)。架空の評価・写真・営業時間は出さない
 * - 記事・SNS の URL は「参考の出典」として残すだけ(中身は取りに行かない。場所は旅程案の候補箱で確かめる)
 * - 右の確認の一覧: 行きたい場所・宿・車の経路・営業時間を、選択済み/未照会/日付待ち で示す(未照会を成功の色にしない)
 * - 「選んだ候補で旅程案を作る」で初めて旅行(未確定の下書き)を作る。何も選んでいない時は押せなくせず、何が要るかを示す
 * - 方面(行き先)はこの画面に来た時点で決まっている。開いたら観光の場所を自動で探す。立ち寄る場所は任意
 *   (場所なしで作ると、日・時間帯の枠だけの下書きになる)。提供元が応答しない時は「見つからない」と言わない
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/common/Button';
import { searchNearby } from '@/services/api/g11discover';
import type { DiscoverCategory, NearbyResult } from '@/services/api/types/g11discover';
import { distanceLabel } from '@/pages/discover/discoverModel';
import { CONSULT_CATEGORIES, isHttpUrl, retrievedLabel, type ConsultCategory, type ConsultState } from './consultModel';

const RADII = [2, 5, 10, 20];

interface Props {
  state: ConsultState;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onPick: (r: NearbyResult, on: boolean) => void;
  onUrls: (urls: string[]) => void;
  onCreate: () => void;
}

const AreaDetailStep: React.FC<Props> = ({ state, busy, error, onBack, onPick, onUrls, onCreate }) => {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const area = state.areas?.areas.find((a) => a.name === state.selectedArea) ?? null;
  const base = area?.geocode.status === 'ok' && area.geocode.latitude !== null && area.geocode.longitude !== null
    ? { latitude: area.geocode.latitude, longitude: area.geocode.longitude } : null;
  const [category, setCategory] = useState<ConsultCategory>('sightseeing');
  const [radius, setRadius] = useState(10);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NearbyResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const picked = Object.values(state.picked);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!base) return;
    setSearching(true);
    setSearchError(null);
    try {
      const r = await searchNearby({ query: query.trim(), category: category as DiscoverCategory, latitude: base.latitude,
        longitude: base.longitude, radius_km: radius });
      setResults([...r.candidates].sort((a, b) => (a.distance_m ?? 1e12) - (b.distance_m ?? 1e12)));
      if (r.candidates.length === 0 && (r.unavailable_providers ?? []).length > 0) {
        setSearchError('場所の提供元(OpenStreetMap)が応答しませんでした。見つからなかったのではありません。時間をおいて「候補を探す」をもう一度押してください');
      }
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setResults([]);
      setSearchError(status === 401 || status === 403
        ? '場所の検索はログインした会員の機能です。ゲストの方は、場所を選ばずに下書きを作り、あとで足せます'
        : '場所を探せませんでした(提供元が応答しません)。時間をおいてもう一度お試しください');
    } finally {
      setSearching(false);
    }
  };

  const addUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const v = url.trim();
    if (!isHttpUrl(v)) {
      setUrlError('http:// か https:// で始まる URL を入れてください');
      return;
    }
    if (state.urls.length >= 10) {
      setUrlError('参考の出典は10件までです');
      return;
    }
    setUrlError(null);
    setUrl('');
    if (!state.urls.includes(v)) onUrls([...state.urls, v]);
  };

  // 方面を開いたら、その周りの観光の場所を一度だけ自動で探す(空の画面で止めない)
  const autoSearched = useRef(false);
  useEffect(() => {
    if (autoSearched.current || !base) return;
    autoSearched.current = true;
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.latitude, base?.longitude]);

  const check = [
    { label: '行き先(方面)', sub: '方面の比較で選んだ', status: state.selectedArea ?? '未選択',
      tone: state.selectedArea ? 'ok' : 'pending' },
    { label: '立ち寄る場所', sub: '観光・食事・買い物から選ぶ(任意)', status: picked.length ? `${picked.length}件 選択` : '未選択(任意)',
      tone: picked.length ? 'ok' : 'pending' },
    { label: '宿を探す', sub: '何人で1部屋・予算で照会', status: '未照会(提供元が未接続)', tone: 'pending' },
    { label: '車の経路', sub: '高速・運転時間・休憩', status: '未照会(提供元が未接続)', tone: 'pending' },
    { label: '営業時間', sub: '対象の日の営業・最終入場', status: '日付待ち', tone: 'pending' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-accent">{`SELECTED AREA · ${state.selectedArea ?? ''}`}</p>
          <h2 className="mt-1 text-lg font-bold text-ink-900">{`行き先は「${state.selectedArea ?? ''}」に決めました`}</h2>
          <p className="text-sm text-ink-700" data-testid="consult-area-decided">
            {`${state.selectedArea ?? ''}の中で立ち寄りたい場所を選べます(任意)。選ばなくても、${state.selectedArea ?? ''}の旅程案を作れます。`}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>← 方面の比較へ戻る</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section aria-labelledby={`${id}-find`} className="rounded-2xl border border-cloud-200 bg-surface">
          <h3 id={`${id}-find`} className="sr-only">場所を探す</h3>
          <form onSubmit={search} aria-label="方面の周りを探す" className="space-y-3 border-b border-cloud-200 p-4">
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
                <label htmlFor={`${id}-q`} className="text-xs font-semibold text-ink-900">探したい名前・雰囲気(空でも可)</label>
                <input ref={searchRef} id={`${id}-q`} value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)}
                  className="tc-focus-ring mt-1 min-h-11 w-full rounded-lg border border-cloud-200 bg-cloud-0 px-3 text-ink-900" />
              </div>
              <div>
                <label htmlFor={`${id}-r`} className="text-xs font-semibold text-ink-900">半径</label>
                <select id={`${id}-r`} value={radius} onChange={(e) => setRadius(Number(e.target.value))}
                  className="tc-focus-ring mt-1 min-h-11 rounded-lg border border-cloud-200 bg-cloud-0 px-2 text-ink-900">
                  {RADII.map((r) => <option key={r} value={r}>{`${r}km`}</option>)}
                </select>
              </div>
              <Button type="submit" loading={searching} disabled={!base || searching} data-testid="consult-search">候補を探す</Button>
            </div>
            <p className="text-xs text-ink-700">
              {base ? `探す中心: ${state.selectedArea}(照会した位置)· 出典: OpenStreetMap`
                : '方面の位置が未照会のため、周りを探せません。方面の比較に戻って位置を照会するか、場所を選ばずに下書きを作れます。'}
            </p>
          </form>
          {searchError && <p role="alert" className="m-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">{searchError}</p>}
          <div className="p-4">
            {results === null ? (
              <div className="py-6 text-center text-sm text-ink-700" data-testid="consult-results-idle">
                <p className="font-semibold text-ink-900">{searching ? `${state.selectedArea ?? ''}の周りを探しています…` : 'まだ探していません'}</p>
                <p>カテゴリと半径を選んで「候補を探す」を押すと、場所・距離・出典・取得時刻つきの候補がここに並びます。</p>
              </div>
            ) : results.length === 0 ? (
              searchError ? null
                : <p className="py-6 text-center text-sm text-ink-700" data-testid="consult-results-empty">
                  {`${state.selectedArea ?? ''}の半径${radius}kmに、このカテゴリの場所は見つかりませんでした。半径・カテゴリ・言葉を変えてください。`}
                </p>
            ) : (
              <>
                <h4 className="text-sm font-semibold text-ink-900" aria-live="polite">{`見つかった場所 ${results.length}件 · 出典つき`}</h4>
                <ul className="mt-2 grid gap-2 md:grid-cols-2" aria-label="見つかった場所">
                  {results.map((res) => {
                    const on = Boolean(state.picked[res.id]);
                    return (
                      <li key={res.id} className={`rounded-xl border p-3 text-sm ${on ? 'border-accent bg-accent-soft' : 'border-cloud-200'}`}
                        data-testid={`consult-result-${res.id}`}>
                        <p className="font-semibold text-ink-900 break-words">{res.name}</p>
                        <p className="text-xs text-ink-700">{[res.category, distanceLabel(res)].filter(Boolean).join(' · ')}</p>
                        <p className="text-xs text-ink-700">{`出典: OpenStreetMap ${retrievedLabel(res.retrieved_at)} · 営業時間は未照会`}</p>
                        <Button type="button" size="sm" variant={on ? 'primary' : 'outline'} className="mt-2" aria-pressed={on}
                          onClick={() => onPick(res, !on)} data-testid={`consult-pick-${res.id}`}>
                          {on ? '✓ 旅程案に入れる' : '旅程案に入れる'}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
          <form onSubmit={addUrl} aria-label="参考の記事・SNS を足す" className="m-4 rounded-xl border border-dashed border-cloud-200 p-3">
            <label htmlFor={`${id}-url`} className="text-sm font-semibold text-ink-900">見つけた記事・SNS の投稿を参考に足す</label>
            <p className="text-xs text-ink-700">URL の中身は取りに行きません。旅程案の候補箱に出典として入り、場所は確かめてから使います。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input id={`${id}-url`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..."
                className="tc-focus-ring min-h-11 min-w-0 flex-1 rounded-lg border border-cloud-200 bg-cloud-0 px-3 text-ink-900" />
              <Button type="submit" size="sm" variant="outline">出典として足す</Button>
            </div>
            {urlError && <p role="alert" className="mt-1 text-xs text-danger">{urlError}</p>}
            {state.urls.length > 0 && (
              <ul className="mt-2 space-y-1" aria-label="参考の出典">
                {state.urls.map((u) => (
                  <li key={u} className="flex items-center justify-between gap-2 text-xs text-ink-900">
                    <span className="break-all">{u}</span>
                    <button type="button" onClick={() => onUrls(state.urls.filter((x) => x !== u))}
                      className="tc-focus-ring min-h-11 shrink-0 px-2 text-ink-700 underline" aria-label={`${u} を外す`}>外す</button>
                  </li>
                ))}
              </ul>
            )}
          </form>
        </section>
        <aside aria-labelledby={`${id}-check`} className="h-fit rounded-2xl border border-cloud-200 bg-surface p-4">
          <p className="text-xs font-semibold tracking-widest text-accent">PLAN CHECKLIST</p>
          <h3 id={`${id}-check`} className="mt-1 font-semibold text-ink-900">旅程案に必要な情報</h3>
          <ol className="mt-3 divide-y divide-cloud-200">
            {check.map((c, i) => (
              <li key={c.label} className="flex items-center gap-2 py-2" data-testid={`consult-check-${i}`}>
                <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  c.tone === 'ok' ? 'bg-success-soft text-success' : 'bg-cloud-100 text-ink-700'}`}>{c.tone === 'ok' ? '✓' : i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink-900">{c.label}</span>
                  <span className="block text-xs text-ink-700">{c.sub}</span>
                </span>
                <span className={`shrink-0 text-right text-xs ${c.tone === 'ok' ? 'text-success' : 'text-warning'}`}>{c.status}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-ink-700">全てを確かめる前でも下書きは作れます。確かめていない項目は「未照会」「日付待ち」のまま残します。</p>
          {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft p-2 text-xs text-danger">{error}</p>}
          <p id={`${id}-next`} className="mt-3 text-xs text-ink-700">
            {picked.length
              ? `押すと、${state.selectedArea ?? ''}の未確定の旅程案(旅行)を作り、選んだ${picked.length}件を日・時間帯に並べます。日付・予約はまだ決めません。`
              : `押すと、${state.selectedArea ?? ''}の未確定の旅程案(旅行)を作ります。立ち寄る場所はまだ無いため、日・時間帯の枠だけの下書きです(後から足せます)。`}
          </p>
          <Button type="button" fullWidth className="mt-2" onClick={onCreate} loading={busy} disabled={busy}
            aria-describedby={`${id}-next`} data-testid="consult-create-draft">
            {`${state.selectedArea ?? 'この方面'}で旅程案を作る →`}
          </Button>
        </aside>
      </div>
    </div>
  );
};

export default AreaDetailStep;
