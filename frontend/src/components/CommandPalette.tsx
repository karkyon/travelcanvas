/**
 * CommandPalette - 情報内検索・コマンドパレット(DOC-04 SC-10・§2.2「全体検索」・§12、FR-009)。
 *
 * [Gate C3] backend/app/api/v1/plan_search.py の画面。
 * - ヘッダーの「検索」または Ctrl+K / ⌘K で開く。プランを開いている時は「この旅行」、切り替えで「すべての旅行」
 * - 入力と同時に(止まってから250ms)日程・予定・場所・候補・予約・チケット・文書・費用・メンバー・記録を分類ごとに出す
 * - 固定の絞り込み: 今日・予約・チケット・ホテル・緊急。予約番号の末尾(4文字)は「予約」に絞った時だけ探す(結果は伏せた番号)
 * - ↑↓で選び Enter で開く。Esc で閉じ、開く前の場所へフォーカスを戻す(WAI-ARIA の combobox + listbox)
 * - [Gate G4] MAP-03 「>」から始めるとコマンド(>予定を追加 11/3 10:00 清水寺 等。backend/app/api/v1/commands.py)。
 *   検索と操作を分ける: Enter は確認の表示まで(何も変えない)。「実行する」を押した時だけ実行し(Idempotency-Key・旅行の revision)、
 *   結果から「元に戻す」ができる。閲覧だけの人には理由を示して実行させない。画面を開くコマンドは確認なしで移る
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { searchEverything, searchPlan } from '@/services/api';
import { executeCommand, getCommands, previewCommand, undoCommand } from '@/services/api/g4';
import type { CommandDef, CommandPreview, CommandResult, SearchFilter, SearchHit, SearchResults } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeInternalPath } from '@/utils/safeNavigation';
import { PLAN_MUTATED_EVENT, planIdFromPath } from '@/utils/commandPalette';

const FILTERS: Array<{ value: SearchFilter; label: string }> = [
  { value: 'today', label: '今日' }, { value: 'reservation', label: '予約' }, { value: 'ticket', label: 'チケット' },
  { value: 'hotel', label: 'ホテル' }, { value: 'emergency', label: '緊急' },
];
const DEBOUNCE_MS = 250;

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID() : `cmd_${Date.now()}_${Math.random().toString(36).slice(2)}`);
/** 「>」の後の本文 */
const commandBody = (text: string) => text.trim().replace(/^>/, '').trim();
const matchesAlias = (c: CommandDef, body: string) =>
  c.aliases.some((a) => body === a || body.startsWith(`${a} `) || body.startsWith(`${a}\u3000`));

interface Props {
  /** [Gate G2] 読み込み中に Ctrl+K・ボタンで開くよう求められていた時は、開いた状態で始める(CommandPaletteLauncher) */
  defaultOpen?: boolean;
  /** [Gate G3] Ctrl+K を自分で受け取り始めた時に呼ぶ(CommandPaletteLauncher がそれまで代わりに受け取る) */
  onLive?: () => void;
}

const CommandPalette: React.FC<Props> = ({ defaultOpen = false, onLive }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPlan = planIdFromPath(location.pathname);
  const [open, setOpen] = useState(defaultOpen);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<SearchFilter | null>(null);
  const [scope, setScope] = useState<'plan' | 'all'>('plan');
  const [data, setData] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [commands, setCommands] = useState<CommandDef[] | null>(null);
  const [preview, setPreview] = useState<CommandPreview | null>(null);
  const [confirmKey, setConfirmKey] = useState('');
  const [result, setResult] = useState<CommandResult | null>(null);
  const [cmdMessage, setCmdMessage] = useState<string | null>(null);
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [cmdBusy, setCmdBusy] = useState(false);
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
    onLive?.();
  }, [onLive]);

  // 受け取りの切り替えの間に Launcher が受け取った「開く」も反映する
  useEffect(() => {
    if (defaultOpen) openPalette();
  }, [defaultOpen, openPalette]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const commandMode = q.trimStart().startsWith('>');

  useEffect(() => {
    if (!open || !commandMode || !currentPlan || commands) return;
    let alive = true;
    getCommands(currentPlan).then((r) => { if (alive) setCommands(r.commands); })
      .catch((e) => { if (alive) setCmdError(errorDetailMessage(e, 'コマンドの一覧を読めませんでした')); });
    return () => { alive = false; };
  }, [open, commandMode, currentPlan, commands]);

  useEffect(() => {
    setCommands(null); // 旅行が変われば役割も変わる
  }, [currentPlan]);

  useEffect(() => {
    if (!open || commandMode) return;
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
  }, [q, filter, open, effectiveScope, currentPlan, commandMode]);

  const flat: SearchHit[] = useMemo(
    () => (commandMode ? [] : (data?.categories ?? []).flatMap((c) => c.results)), [data, commandMode]);
  const body = commandBody(q);
  const suggestions: CommandDef[] = useMemo(() => {
    if (!commandMode || !commands) return [];
    const head = body.split(/[ \u3000]/)[0] ?? '';
    return commands.filter((c) => !head || matchesAlias(c, body) || c.aliases.some((a) => a.startsWith(head)) || c.label.startsWith(head));
  }, [commandMode, commands, body]);

  // 開いている旅程の画面に読み直させる(store/planStore.ts が受け取る。この画面から store を読み込まない)
  // コマンドの一覧が画面にある時だけ、入力欄から一覧を指す(確認の表示中・旅行の外では一覧が無い)
  const commandListShown = commandMode && !!currentPlan && !preview;

  const reloadPlan = (planId: string) => {
    window.dispatchEvent(new CustomEvent(PLAN_MUTATED_EVENT, { detail: { planId } }));
  };

  const runPreview = async (text: string) => {
    if (!currentPlan) return;
    setCmdError(null);
    setCmdMessage(null);
    setCmdBusy(true);
    try {
      const pv = await previewCommand(currentPlan, text);
      if (!pv.needs_confirmation && pv.link) {
        go(pv.link); // 画面を開くだけ(何も変えない)
        return;
      }
      setConfirmKey(newKey()); // 確認ごとに1つ(2回押しても二重に作らない)
      setPreview(pv);
    } catch (e) {
      setPreview(null);
      setCmdError(errorDetailMessage(e, 'コマンドを読み取れませんでした'));
    } finally {
      setCmdBusy(false);
    }
  };

  const runExecute = async () => {
    if (!currentPlan || !preview) return;
    setCmdBusy(true);
    setCmdError(null);
    try {
      const res = await executeCommand(currentPlan, q, preview.plan_revision, confirmKey);
      setResult(res);
      setPreview(null);
      setCmdMessage(res.message);
      reloadPlan(currentPlan);
    } catch (e) {
      setCmdError(errorDetailMessage(e, '実行できませんでした'));
    } finally {
      setCmdBusy(false);
    }
  };

  const runUndo = async () => {
    if (!currentPlan || !result) return;
    setCmdBusy(true);
    setCmdError(null);
    try {
      const res = await undoCommand(currentPlan, result.run_id, result.plan_revision);
      setResult(null);
      setCmdMessage(res.message);
      reloadPlan(currentPlan);
    } catch (e) {
      setCmdError(errorDetailMessage(e, '元に戻せませんでした'));
    } finally {
      setCmdBusy(false);
    }
  };

  const pickSuggestion = (c: CommandDef) => {
    const alias = c.aliases[0] ?? c.label;
    if (c.kind === 'mutate') {
      setQ(`>${alias} `);
      setPreview(null);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQ(`>${alias}`);
      void runPreview(`>${alias}`);
    }
  };
  const planHits = data?.plans ?? [];

  const go = (link: string) => {
    close();
    // [Gate G3] DEP-02 検索の結果の移動先はサーバーの値。アプリ内のパスだけを通す
    const target = safeInternalPath(link);
    if (target) navigate(target);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (commandMode) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (preview) setPreview(null);
        else close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, Math.max(0, suggestions.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // Enter は確認まで(実行は「実行する」を押した時だけ)
        if (commands?.some((c) => matchesAlias(c, body))) void runPreview(q);
        else if (suggestions[active]) pickSuggestion(suggestions[active]!);
        else void runPreview(q);
      }
      return;
    }
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
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-ink-900 hover:bg-gray-100"
        aria-haspopup="dialog" aria-label="検索(Ctrl+K)">
        <Search size={16} aria-hidden="true" />
        <span className="hidden lg:inline text-sm">検索</span>
        <kbd className="hidden lg:inline text-xs text-ink-700 border border-gray-300 rounded-sm px-1">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-60 bg-black/40 flex items-start justify-center pt-20 px-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-label="検索" className="w-full max-w-2xl bg-surface rounded-xl shadow-2xl">
            <div className="p-3 border-b border-gray-200">
              <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setPreview(null); setActive(0); }}
                onKeyDown={onInputKey} maxLength={commandMode ? 300 : 100}
                role="combobox" aria-expanded={commandMode ? commandListShown && suggestions.length > 0 : flat.length > 0}
                aria-controls={commandMode ? (commandListShown ? 'command-palette-commands' : undefined) : 'command-palette-results'}
                aria-activedescendant={commandMode
                  ? (commandListShown && suggestions[active] ? `cmd-${suggestions[active]!.name}` : undefined)
                  : (flat[active] ? `cp-${flat[active]!.category}-${flat[active]!.id}` : undefined)}
                aria-label="検索語" placeholder="店名・住所・日付(明日・11/3)・予約番号の末尾…「>」でコマンド"
                className="w-full px-3 py-2 text-base text-ink-900 border border-gray-300 rounded-lg" />
              {!commandMode && <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="絞り込み">
                {FILTERS.map((f) => (
                  <button key={f.value} type="button" aria-pressed={filter === f.value}
                    onClick={() => setFilter((cur) => (cur === f.value ? null : f.value))}
                    className={`text-sm px-3 py-1 rounded-full border ${filter === f.value ? 'bg-indigo-700 text-white border-indigo-700' : 'border-gray-300 text-ink-900'}`}>
                    {f.label}
                  </button>
                ))}
                {currentPlan && (
                  <label className="ml-auto text-sm text-ink-900 inline-flex items-center gap-1">
                    <input type="checkbox" checked={scope === 'all'} onChange={() => setScope((s) => (s === 'all' ? 'plan' : 'all'))} />
                    すべての旅行
                  </label>
                )}
              </div>}
            </div>
            {commandMode && (
              <div className="max-h-[60vh] overflow-y-auto p-2">
                <p className="sr-only" role="status" aria-live="polite">{cmdBusy ? '処理中' : (cmdMessage ?? '')}</p>
                {!currentPlan && (
                  <p className="p-3 text-sm text-ink-900">コマンドは、旅行を開いている時だけ使えます。</p>
                )}
                {cmdError && <p role="alert" className="p-3 text-sm text-red-800">{cmdError}</p>}
                {currentPlan && !preview && (
                  <>
                    <p className="px-2 pb-1 text-xs text-ink-700">
                      コマンドは Enter で確認を表示し、「実行する」を押した時だけ変更します。
                    </p>
                    <ul id="command-palette-commands" role="listbox" aria-label="コマンド">
                      {suggestions.map((c, i) => (
                        <li key={c.name} id={`cmd-${c.name}`} role="option" aria-selected={i === active} aria-disabled={!c.allowed}
                          onMouseEnter={() => setActive(i)} onClick={() => pickSuggestion(c)}
                          className={`px-3 py-2 rounded-sm cursor-pointer ${i === active ? 'bg-indigo-50' : ''}`}>
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-medium text-ink-900">{c.label}</span>
                            {!c.allowed && <span className="text-xs px-1.5 rounded-sm bg-gray-200 text-ink-900">閲覧だけのため使えません</span>}
                          </div>
                          <div className="text-sm text-ink-700">例: &gt;{c.usage}</div>
                        </li>
                      ))}
                    </ul>
                    {commands && suggestions.length === 0 && (
                      <p className="p-3 text-sm text-ink-700">合うコマンドがありません。「&gt;」だけを入れると一覧を表示します。</p>
                    )}
                  </>
                )}
                {preview && (
                  <section aria-label="コマンドの確認" className="p-3">
                    <h3 className="font-semibold text-ink-900">{preview.label}</h3>
                    <ul className="mt-1 list-disc ml-5 text-sm text-ink-900">
                      {preview.summary.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                    {preview.undoable && <p className="mt-1 text-xs text-ink-700">実行した後に「元に戻す」ができます。</p>}
                    {preview.problem && <p role="alert" className="mt-2 text-sm text-red-800">{preview.problem.message}</p>}
                    {!preview.allowed && preview.reason && <p role="alert" className="mt-2 text-sm text-red-800">{preview.reason}</p>}
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={cmdBusy || !preview.allowed || !!preview.problem} onClick={() => void runExecute()}
                        className="px-3 py-1.5 rounded-sm bg-indigo-700 text-white text-sm disabled:opacity-50">実行する</button>
                      <button type="button" onClick={() => { setPreview(null); inputRef.current?.focus(); }}
                        className="px-3 py-1.5 rounded-sm border border-gray-300 text-ink-900 text-sm">やめる</button>
                    </div>
                  </section>
                )}
                {cmdMessage && !preview && (
                  <div className="p-3 flex flex-wrap items-center gap-2" aria-label="コマンドの結果">
                    <span className="text-sm text-ink-900">{cmdMessage}</span>
                    {result?.undoable && (
                      <button type="button" disabled={cmdBusy} onClick={() => void runUndo()}
                        className="px-3 py-1.5 rounded-sm border border-gray-300 text-ink-900 text-sm">元に戻す</button>
                    )}
                    {result?.link && (
                      <button type="button" onClick={() => go(result.link!)}
                        className="px-3 py-1.5 rounded-sm border border-gray-300 text-ink-900 text-sm">開く</button>
                    )}
                  </div>
                )}
              </div>
            )}
            {!commandMode && <div className="max-h-[60vh] overflow-y-auto p-2">
              <p className="sr-only" role="status" aria-live="polite">
                {loading ? '検索中' : data ? `${data.total}件見つかりました` : ''}
              </p>
              {error && <p role="alert" className="p-3 text-sm text-red-800">{error}</p>}
              {!data && !error && (
                <p className="p-3 text-sm text-ink-700">
                  {effectiveScope === 'plan' ? 'この旅行の中' : '参加しているすべての旅行'}を探します。予約番号の末尾(4文字)は「予約」に絞って探してください。
                </p>
              )}
              {data && data.total === 0 && planHits.length === 0 && <p className="p-3 text-sm text-ink-700">見つかりませんでした。</p>}
              {planHits.length > 0 && (
                <section aria-label="旅行" className="mb-2">
                  <h3 className="px-2 text-xs font-semibold text-ink-700">旅行</h3>
                  <ul>
                    {planHits.map((p) => (
                      <li key={p.plan_id}>
                        <button type="button" className="w-full text-left px-3 py-2 rounded-sm hover:bg-gray-100 text-ink-900"
                          onClick={() => go(p.link)}>{p.title}</button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <ul id="command-palette-results" role="listbox" aria-label="検索の結果">
                {(data?.categories ?? []).map((cat) => (
                  <li key={cat.category} role="presentation" className="mb-2">
                    <div className="px-2 text-xs font-semibold text-ink-700" aria-hidden="true">
                      {cat.label}({cat.count}件{cat.count > cat.results.length ? `・上位${cat.results.length}件を表示` : ''})
                    </div>
                    <ul role="group" aria-label={`${cat.label}(${cat.count}件)`}>
                      {cat.results.map((h) => {
                        index += 1;
                        const i = index;
                        return (
                          <li key={`${h.category}-${h.id}`} id={`cp-${h.category}-${h.id}`} role="option" aria-selected={i === active}
                            onMouseEnter={() => setActive(i)} onClick={() => go(h.link)}
                            className={`px-3 py-2 rounded-sm cursor-pointer ${i === active ? 'bg-indigo-50' : ''}`}>
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="font-medium text-ink-900">{h.title}</span>
                              {h.badge && <span className="text-xs px-1.5 rounded-sm bg-amber-100 text-amber-900">{h.badge}</span>}
                              {h.when && <span className="text-xs text-ink-700">{h.when}</span>}
                              {effectiveScope === 'all' && <span className="text-xs text-ink-700">{h.plan_title}</span>}
                            </div>
                            {h.subtitle && <div className="text-sm text-ink-700">{h.subtitle}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>}
          </div>
        </div>
      )}
    </>
  );
};

export default CommandPalette;
