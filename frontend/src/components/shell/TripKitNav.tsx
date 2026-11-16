/**
 * [Gate MockScreens → TripKit] 旅行箱の中の画面の切り替え(旅行箱 UI/UX 改修 2026-11-15)。
 *
 * 旅行全体のナビ(左のレール・上の旅行の切り替え) → 旅行箱 → 旅行箱の中の画面、の 3 段目だけを受け持つ。
 * - 項目: 概要 / 予約・チケット / 準備・持ち物 / 予算・費用 / 文書 / 予約の取込 と、右に「旅行箱を検索」
 * - 448px 以下は 4 つ(概要・予約・準備・費用)と「その他」。その他を開くと残り(文書・取込・検索)を一覧で出す。
 *   今いる画面が「その他」の中なら、ボタンの名前をその画面にして選んでいることが分かるようにする
 * - 画面ごとに URL が違うので、タブではなくリンク(aria-current="page")
 * 右に旅行の期間と行き先(読めた時だけ。固定の値は出さない)。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, FileText, Inbox, LayoutGrid, Luggage, Search, Ticket, Wallet, X } from 'lucide-react';
import { getReadiness } from '@/services/api';
import { useTripContext } from '@/hooks/useTripContext';
import { KIT_ITEMS, attentionFromReadiness, cachedKitAttention, currentKit, md, onKitAttention, primeKitAttention,
  type KitAttention } from './tripKitModel';

// [Gate TripKitUI] 旅行箱の画面のアイコン(6 画面と概要・ナビ・要約で同じものを使う)
const KIT_ICON = { kit: LayoutGrid, reservations: Ticket, preparation: Luggage, expenses: Wallet, documents: FileText, imports: Inbox } as const;

/** [Gate TripKitUI] 準備状況から「要確認」の数を出す。画面が読み込んだ分(prime)があれば聞き直さない。失敗しても出さないだけ */
function useKitAttention(planId: string): KitAttention | null {
  const [value, setValue] = useState<KitAttention | null>(() => cachedKitAttention(planId));
  useEffect(() => {
    let alive = true;
    const sync = () => { const v = cachedKitAttention(planId); if (alive && v) setValue(v); };
    const off = onKitAttention(sync);
    if (!cachedKitAttention(planId)) {
      const timer = window.setTimeout(() => {
        if (cachedKitAttention(planId)) { sync(); return; }
        (async () => {
          try {
            const r = await getReadiness(planId);
            primeKitAttention(planId, r);
            if (alive) setValue(attentionFromReadiness(r));
          } catch { /* 数を出さないだけ(画面は止めない) */ }
        })();
      }, 400);
      return () => { alive = false; off(); window.clearTimeout(timer); };
    }
    return () => { alive = false; off(); };
  }, [planId]);
  return value;
}

const TripKitNav: React.FC<{ planId: string }> = ({ planId }) => {
  const { pathname } = useLocation();
  const trip = useTripContext(planId);
  const cur = currentKit(pathname, planId);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const range = [md(trip.startDate), md(trip.endDate)].filter(Boolean);
  const meta = [range.length ? Array.from(new Set(range)).join(' — ') : null, trip.destination].filter(Boolean).join(' · ');
  const more = [...KIT_ITEMS.filter((k) => !k.primary), { key: 'search' as const, suffix: '/kit/search', label: '旅行箱を検索', short: '検索', primary: false }];
  const curMore = more.find((k) => k.key === cur) ?? null;
  const attn = useKitAttention(planId);
  const badge = (key: string): number => (attn && (key === 'reservations' || key === 'preparation' || key === 'expenses') ? attn[key] : 0);

  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    const onDown = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [moreOpen]);

  return (
    <div className="tc-kit-nav tc-kit-nav--trip" data-testid="tripkit-nav">
      <div className="tc-kit-head">
        <p className="tc-kit-trail">
          <Link to={`/planner/${planId}`} className="tc-focus-ring">{trip.title || '旅程'}</Link>
          <span aria-hidden="true"> › </span><Link to={`/planner/${planId}/kit`} className="tc-focus-ring">旅行箱</Link>
          {cur && cur !== 'kit' && <><span aria-hidden="true"> › </span><span>{[...KIT_ITEMS, ...more].find((k) => k.key === cur)?.label}</span></>}
        </p>
        {meta && <span className="tc-kit-meta">{meta}</span>}
      </div>
      <div className="tc-kit-bar">
        <nav aria-label="旅行箱の中の画面" className="tc-kit-tabs">
          {KIT_ITEMS.map((k) => {
            const Icon = KIT_ICON[k.key];
            const n = badge(k.key);
            return (
            <Link key={k.key} to={`/planner/${planId}${k.suffix}`} aria-current={cur === k.key ? 'page' : undefined}
              aria-label={k.label} title={n > 0 ? `${k.label}(要確認 ${n})` : undefined}
              className={`tc-focus-ring tc-kit-tab${k.primary ? '' : ' tc-kit-tab--more'}`}>
              <Icon size={16} aria-hidden="true" className="tc-kit-tab__icon" />
              <span className="tc-kit-tab__long">{k.label}</span><span className="tc-kit-tab__short" aria-hidden="true">{k.short}</span>
              {n > 0 && <span className="tc-kit-cnt" data-tone="warn" aria-hidden="true">{n}</span>}
            </Link>
            );
          })}
          <div className="tc-kit-more" ref={moreRef}>
            <button type="button" className="tc-focus-ring tc-kit-tab tc-kit-more__btn" aria-expanded={moreOpen} aria-haspopup="true"
              aria-current={curMore ? 'page' : undefined} onClick={() => setMoreOpen((v) => !v)}>
              {curMore ? curMore.short : 'その他'}<ChevronDown size={14} aria-hidden="true" />
            </button>
            {moreOpen && (
              <ul className="tc-kit-more__menu" aria-label="旅行箱のその他の画面">
                {more.map((k) => (
                  <li key={k.key}>
                    <Link to={`/planner/${planId}${k.suffix}`} className="tc-focus-ring" aria-current={cur === k.key ? 'page' : undefined}>{k.label}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>
        <Link to={`/planner/${planId}/kit/search`} className="tc-focus-ring tc-kit-search" aria-current={cur === 'search' ? 'page' : undefined}
          aria-label="旅行箱を検索">
          <Search size={15} aria-hidden="true" /><span>旅行箱を検索</span>
        </Link>
      </div>
    </div>
  );
};

export default TripKitNav;

/**
 * [Gate TripKit] 旅行箱の一覧の絞り込み(状態・種類などのチップ)と、選んだ条件の表示・個別解除・全解除。
 * 選んだ値は URL の query に残す(更新・共有・戻るで同じ条件に戻る)。値は呼び出し側の一覧から数えた件数だけを出す。
 */

export interface ChipOption { value: string; label: string; count?: number; attention?: boolean }

export const KitChips: React.FC<{ label: string; options: ChipOption[]; value: string; onChange: (v: string) => void; allLabel?: string; allCount?: number }> = ({
  label, options, value, onChange, allLabel = 'すべて', allCount,
}) => (
  <div className="tc-kit-chips" role="group" aria-label={label}>
    <button type="button" className="tc-focus-ring tc-kit-chip" aria-pressed={value === ''} onClick={() => onChange('')}>
      {allLabel}{allCount != null && <span className="tc-kit-cnt">{` ${allCount}`}</span>}
    </button>
    {options.map((o) => (
      <button key={o.value} type="button" className="tc-focus-ring tc-kit-chip" data-attention={o.attention ? 'true' : undefined}
        aria-pressed={value === o.value} onClick={() => onChange(value === o.value ? '' : o.value)}>
        {o.label}{o.count != null && <span className="tc-kit-cnt" data-tone={o.attention && o.count > 0 ? 'warn' : undefined}>{` ${o.count}`}</span>}
      </button>
    ))}
  </div>
);

export interface ActiveCondition { key: string; label: string; clear: () => void }

/** 選んでいる条件をチップで常に見せ、1 つずつ・全部をはずせる。件数「N件中M件」も出す */
export const KitActiveConditions: React.FC<{ conditions: ActiveCondition[]; onClearAll: () => void; shown: number; total: number }> = ({
  conditions, onClearAll, shown, total,
}) => (
  <div className="tc-kit-active" role="status" aria-live="polite">
    <span className="tc-kit-count">{conditions.length ? `${total}件中 ${shown}件を表示` : `${total}件`}</span>
    {conditions.map((c) => (
      <button key={c.key} type="button" className="tc-focus-ring tc-kit-cond" onClick={c.clear} aria-label={`条件「${c.label}」をはずす`}>
        {c.label}<X size={13} aria-hidden="true" />
      </button>
    ))}
    {conditions.length > 1 && (
      <button type="button" className="tc-focus-ring tc-mini-link" onClick={onClearAll}>条件をすべてはずす</button>
    )}
  </div>
);

/** 絞り込みで 0 件になった時(データが 0 件の時とは分ける) */
export const KitNoMatch: React.FC<{ onClearAll: () => void }> = ({ onClearAll }) => (
  <div className="tc-kit-empty" role="status">
    <p className="font-semibold text-ink-900">条件に合うものがありません。</p>
    <p>検索の言葉を変えるか、<button type="button" className="tc-mini-link" onClick={onClearAll}>条件をすべてはずす</button>と全件を表示します。</p>
  </div>
);
