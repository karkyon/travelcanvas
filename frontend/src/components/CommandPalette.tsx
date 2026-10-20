/**
 * CommandPalette - 情報内検索・コマンドパレット(DOC-04 SC-10・§2.2「全体検索」・§12、FR-009)。
 *
 * [Gate C3] backend/app/api/v1/plan_search.py の画面。
 * - ヘッダーの「検索」または Ctrl+K / ⌘K で開く。プランを開いている時は「この旅行」、切り替えで「すべての旅行」
 * - 入力と同時に(止まってから250ms)日程・予定・場所・候補・予約・チケット・文書・費用・メンバー・記録を分類ごとに出す
 * - 固定の絞り込み: 今日・予約・チケット・ホテル・緊急。予約番号の末尾(4文字)は「予約」に絞った時だけ探す(結果は伏せた番号)
 * - ↑↓で選び Enter で開く。Esc で閉じ、開く前の場所へフォーカスを戻す(WAI-ARIA の combobox + listbox)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { searchEverything, searchPlan } from '@/services/api';
import type { SearchFilter, SearchHit, SearchResults } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { planIdFromPath } from '@/utils/commandPalette';

const FILTERS: Array<{ value: SearchFilter; label: string }> = [
  { value: 'today', label: '今日' }, { value: 'reservation', label: '予約' }, { value: 'ticket', label: 'チケット' },
  { value: 'hotel', label: 'ホテル' }, { value: 'emergency', label: '緊急' },
];
const DEBOUNCE_MS = 250;

const CommandPalette: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPlan = planIdFromPath(location.pathname);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<SearchFilter | null>(null);
  const [scope, setScope] = useState<'plan' | 'all'>('plan');
  const [data, setData] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const seq = useRef(0);

  const effectiveScope = currentPlan ? scope : 'all';

  const openPalette = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setActive(0);
    window.setTimeout(() => returnFocus.current?.focus?.(), 0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close();
        else openPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, openPalette]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query && !filter) {
      setData(null);
      setError(null);
      return;
    }
    const id = ++seq.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = effectiveScope === 'plan' && currentPlan
          ? await searchPlan(currentPlan, query, filter) : await searchEverything(query, filter);
        if (id !== seq.current) return; // 古い結果で上書きしない
        setData(res);
        setError(null);
        setActive(0);
      } catch (e) {
        if (id === seq.current) setError(errorDetailMessage(e, '検索できませんでした'));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q, filter, open, effectiveScope, currentPlan]);

  const flat: SearchHit[] = useMemo(() => (data?.categories ?? []).flatMap((c) => c.results), [data]);
  const planHits = data?.plans ?? [];

  const go = (link: string) => {
    close();
    navigate(link);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      go(flat[active]!.link);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  let index = -1;
  return (
    <>
      <button type="button" onClick={openPalette}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-100"
        aria-haspopup="dialog" aria-label="検索(Ctrl+K)">
        <Search size={16} aria-hidden="true" />
        <span className="hidden lg:inline text-sm">検索</span>
        <kbd className="hidden lg:inline text-xs text-gray-700 border border-gray-300 rounded px-1">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center pt-20 px-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-label="検索" className="w-full max-w-2xl bg-white rounded-xl shadow-2xl">
            <div className="p-3 border-b border-gray-200">
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey} maxLength={100}
                role="combobox" aria-expanded={flat.length > 0} aria-controls="command-palette-results"
                aria-activedescendant={flat[active] ? `cp-${flat[active]!.category}-${flat[active]!.id}` : undefined}
                aria-label="検索語" placeholder="店名・住所・日付(明日・11/3)・予約番号の末尾…"
                className="w-full px-3 py-2 text-base text-gray-900 border border-gray-300 rounded-lg" />
              <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="絞り込み">
                {FILTERS.map((f) => (
                  <button key={f.value} type="button" aria-pressed={filter === f.value}
                    onClick={() => setFilter((cur) => (cur === f.value ? null : f.value))}
                    className={`text-sm px-3 py-1 rounded-full border ${filter === f.value ? 'bg-indigo-700 text-white border-indigo-700' : 'border-gray-300 text-gray-800'}`}>
                    {f.label}
                  </button>
                ))}
                {currentPlan && (
                  <label className="ml-auto text-sm text-gray-800 inline-flex items-center gap-1">
                    <input type="checkbox" checked={scope === 'all'} onChange={() => setScope((s) => (s === 'all' ? 'plan' : 'all'))} />
                    すべての旅行
                  </label>
                )}
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              <p className="sr-only" role="status" aria-live="polite">
                {loading ? '検索中' : data ? `${data.total}件見つかりました` : ''}
              </p>
              {error && <p role="alert" className="p-3 text-sm text-red-800">{error}</p>}
              {!data && !error && (
                <p className="p-3 text-sm text-gray-700">
                  {effectiveScope === 'plan' ? 'この旅行の中' : '参加しているすべての旅行'}を探します。予約番号の末尾(4文字)は「予約」に絞って探してください。
                </p>
              )}
              {data && data.total === 0 && planHits.length === 0 && <p className="p-3 text-sm text-gray-700">見つかりませんでした。</p>}
              {planHits.length > 0 && (
                <section aria-label="旅行" className="mb-2">
                  <h3 className="px-2 text-xs font-semibold text-gray-700">旅行</h3>
                  <ul>
                    {planHits.map((p) => (
                      <li key={p.plan_id}>
                        <button type="button" className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 text-gray-900"
                          onClick={() => go(p.link)}>{p.title}</button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <ul id="command-palette-results" role="listbox" aria-label="検索の結果">
                {(data?.categories ?? []).map((cat) => (
                  <li key={cat.category} role="presentation" className="mb-2">
                    <div className="px-2 text-xs font-semibold text-gray-700" aria-hidden="true">
                      {cat.label}({cat.count}件{cat.count > cat.results.length ? `・上位${cat.results.length}件を表示` : ''})
                    </div>
                    <ul role="group" aria-label={`${cat.label}(${cat.count}件)`}>
                      {cat.results.map((h) => {
                        index += 1;
                        const i = index;
                        return (
                          <li key={`${h.category}-${h.id}`} id={`cp-${h.category}-${h.id}`} role="option" aria-selected={i === active}
                            onMouseEnter={() => setActive(i)} onClick={() => go(h.link)}
                            className={`px-3 py-2 rounded cursor-pointer ${i === active ? 'bg-indigo-50' : ''}`}>
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="font-medium text-gray-900">{h.title}</span>
                              {h.badge && <span className="text-xs px-1.5 rounded bg-amber-100 text-amber-900">{h.badge}</span>}
                              {h.when && <span className="text-xs text-gray-700">{h.when}</span>}
                              {effectiveScope === 'all' && <span className="text-xs text-gray-700">{h.plan_title}</span>}
                            </div>
                            {h.subtitle && <div className="text-sm text-gray-700">{h.subtitle}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CommandPalette;
