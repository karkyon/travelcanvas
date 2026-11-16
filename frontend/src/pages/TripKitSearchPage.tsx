/**
 * [Gate TripKit] 旅行箱を検索(TK-02)。旅行箱 UI/UX 改修 2026-11-15。
 *
 * この旅行の中だけを、既存の情報内検索 API(GET /plans/{id}/search、FR-009・DOC-04 SC-10)で探す。
 * - 権限の無い分類は API が返さない(件数も無い)。この画面は返ってきた分類だけを出す(見えない分類の件数を作らない)
 * - 予約番号は API の規則どおり、末尾の一致だけ(blind index)。平文の番号・PIN・QR は結果に出ない
 * - 条件(検索語・絞り込み・分類)は URL に置き、詳細へ行って戻ると同じ結果に戻る
 * - 0 件・絞り込みで 0 件・失敗(再試行)・回数の上限を分けて出す
 * API に無い条件(担当者・未接続など)は、ここでは出さない(偽の絞り込みを作らない)。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import PageHead from '@/components/shell/PageHead';
import TripKitNav from '@/components/shell/TripKitNav';
import { KitActiveConditions, KitChips } from '@/components/shell/TripKitNav';
import { useQueryState } from '@/components/shell/tripKitModel';
import { searchPlan } from '@/services/api';
import type { SearchFilter, SearchResults } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeInternalPath } from '@/utils/safeNavigation';

const FILTERS: { value: SearchFilter; label: string }[] = [
  { value: 'today', label: '今日' }, { value: 'reservation', label: '予約' }, { value: 'ticket', label: 'チケット' },
  { value: 'hotel', label: '宿' }, { value: 'emergency', label: '緊急' },
];

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; data: SearchResults } | { kind: 'error'; message: string; limited: boolean };

const TripKitSearchPage: React.FC = () => {
  const { planId = '' } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [cond, setCond] = useQueryState({ q: '', f: '', cat: '' });
  const [draft, setDraft] = useState(cond.q);
  const [st, setSt] = useState<State>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setDraft(cond.q); }, [cond.q]);
  useEffect(() => {
    const q = cond.q.trim();
    const f = (FILTERS.some((x) => x.value === cond.f) ? cond.f : null) as SearchFilter | null;
    if (!q && !f) { setSt({ kind: 'idle' }); return undefined; }
    let alive = true;
    setSt({ kind: 'loading' });
    searchPlan(planId, q, f).then((data) => { if (alive) setSt({ kind: 'ok', data }); }).catch((e) => {
      if (!alive) return;
      const status = (e as { response?: { status?: number } } | null)?.response?.status ?? 0;
      setSt({ kind: 'error', limited: status === 429, message: errorDetailMessage(e, '検索できませんでした') });
    });
    return () => { alive = false; };
  }, [planId, cond.q, cond.f, tick]);

  const submit = (e: React.FormEvent) => { e.preventDefault(); setCond({ q: draft.trim(), cat: '' }); };
  const clearAll = () => { setDraft(''); setCond({ q: '', f: '', cat: '' }); inputRef.current?.focus(); };
  const fLabel = FILTERS.find((x) => x.value === cond.f)?.label;
  const data = st.kind === 'ok' ? st.data : null;
  const cats = data?.categories.filter((c) => c.count > 0) ?? [];
  const shownCats = cond.cat ? cats.filter((c) => c.category === cond.cat) : cats;
  const total = data?.total ?? 0;
  const shown = shownCats.reduce((n, c) => n + c.results.length, 0);
  const catLabel = cats.find((c) => c.category === cond.cat)?.label;
  const conds = [
    ...(cond.q ? [{ key: 'q', label: `「${cond.q}」`, clear: () => { setDraft(''); setCond({ q: '' }); } }] : []),
    ...(fLabel ? [{ key: 'f', label: `絞り込み: ${fLabel}`, clear: () => setCond({ f: '' }) }] : []),
    ...(catLabel ? [{ key: 'cat', label: `種類: ${catLabel}`, clear: () => setCond({ cat: '' }) }] : []),
  ];

  return (
    <div className="tc-page" data-testid="tripkit-search">
      <PageHead eyebrow="TRIP KIT · 旅行箱" title="旅行箱を検索"
        sub="この旅行の予定・場所・予約・チケット・文書・費用などを、あなたが見られる範囲だけ探します。予約番号は末尾の一致だけで探せます。" />
      <TripKitNav planId={planId} />

      <form className="tc-kit-searchrow" role="search" onSubmit={submit}>
        <label className="tc-kit-searchbox">
          <span className="sr-only">検索する言葉</span>
          <input ref={inputRef} type="search" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={400}
            placeholder="例: 宿の名前、駅、領収書、予約番号の末尾" />
        </label>
        <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--primary"><Search size={15} aria-hidden="true" />検索する</button>
      </form>
      <KitChips label="よく使う絞り込み" allLabel="絞り込みなし" value={cond.f} onChange={(v) => setCond({ f: v, cat: '' })}
        options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
      {cats.length > 1 && (
        <KitChips label="見つかった種類で絞り込む" allLabel="種類すべて" allCount={total} value={cond.cat} onChange={(v) => setCond({ cat: v })}
          options={cats.map((c) => ({ value: c.category, label: c.label, count: c.count }))} />
      )}
      {st.kind !== 'idle' && <KitActiveConditions conditions={conds} shown={shown} total={total} onClearAll={clearAll} />}

      <section aria-labelledby="kit-search-results" aria-busy={st.kind === 'loading'}>
        <h2 id="kit-search-results" className="sr-only">検索の結果</h2>
        {st.kind === 'idle' && (
          <div className="tc-kit-empty">
            <p className="font-semibold text-ink-900">言葉を入れるか、絞り込みを選んでください。</p>
            <p>正確な名前を覚えていなくても、駅・宿・お店の名前の一部や、「予約」「チケット」「緊急」の絞り込みから探せます。</p>
          </div>
        )}
        {st.kind === 'loading' && <p className="tc-kit-state" aria-busy="true">探しています…</p>}
        {st.kind === 'error' && (
          <div className="tc-kit-empty" role="alert">
            <p className="font-semibold text-ink-900">{st.limited ? '短い時間に検索が多すぎました。少し待ってからもう一度。' : st.message}</p>
            <p><button type="button" className="tc-mini-link" onClick={() => setTick((n) => n + 1)}>もう一度検索する</button></p>
          </div>
        )}
        {st.kind === 'ok' && total === 0 && (
          <div className="tc-kit-empty" role="status">
            <p className="font-semibold text-ink-900">見つかりませんでした。</p>
            <p>言葉を短くするか、<button type="button" className="tc-mini-link" onClick={clearAll}>条件をすべてはずして</button>ください。見る権限の無い情報は結果に出ません。</p>
          </div>
        )}
        {st.kind === 'ok' && shownCats.map((c) => (
          <div key={c.category} className="tc-card tc-kit-card tc-kit-group">
            <h3 className="tc-kit-day">{`${c.label} ${c.count}件`}</h3>
            <ul className="tc-kit-list" aria-label={`${c.label}の結果`}>
              {c.results.map((h) => {
                const to = safeInternalPath(h.link);
                return (
                  <li key={`${h.category}:${h.id}`}>
                    <button type="button" className="tc-focus-ring tc-kit-open tc-kit-open--plain" disabled={!to} onClick={() => to && navigate(to)}>
                      <span className="min-w-0">
                        <b>{h.title}</b>
                        <small>{[c.label, h.when, h.subtitle].filter(Boolean).join(' ・ ')}</small>
                      </span>
                      {h.badge && <span className="tc-pill">{h.badge}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
};

export default TripKitSearchPage;
