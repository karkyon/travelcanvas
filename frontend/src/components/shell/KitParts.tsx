/**
 * [Gate TripKitUI] 旅行箱の 6 画面で同じ形に使う部品(改善モックアップ 2026-11-16 の「統一の決まり」)。
 *
 * - KitHead: 小見出し「旅行箱」(アイコン)・画面名(h1)・1 行の説明・右に操作(主な操作は 1 つ)
 * - KitTiles / KitTile: 画面の最初の要約(3〜4 枚)。要確認は橙の枠で同じ形
 * - KitSeg: 画面の中の切り替え(準備・費用で同じ形)。role="tab" と id は呼び出し側の接頭辞で作る
 * - KitSection: 一覧の見出しと右の補足
 * - KitAddReservation: 「予約を追加」1 つから、取り込む・手入力を選ぶ([Gate TripKitFix] 主な操作を 1 つにする)
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Inbox, PencilLine, Plus } from 'lucide-react';

export const KitHead: React.FC<{
  icon: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; titleId?: string;
}> = ({ icon, title, sub, actions, titleId }) => (
  <div className="tc-page-head tc-kit-pagehead">
    <div className="min-w-0">
      <p className="tc-eyebrow tc-kit-eyebrow"><span aria-hidden="true">{icon}</span>旅行箱</p>
      <h1 id={titleId}>{title}</h1>
      {sub && <p className="tc-subhead">{sub}</p>}
    </div>
    {actions && <div className="tc-page-actions">{actions}</div>}
  </div>
);

export const KitTiles: React.FC<{ children: React.ReactNode; label?: string }> = ({ children, label = 'まとめ' }) => (
  <section className="tc-kit-tiles" aria-label={label}>{children}</section>
);

export const KitTile: React.FC<{
  /** muted: まだ無い・未設定(値を灰色で出す。0 件や「済み」と区別する) */
  label: string; icon?: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: 'warn' | 'plain' | 'muted';
  /** 0〜100 の進み具合(無ければ棒を出さない) */
  progress?: number | null; testId?: string;
  /** [Gate TripKitFix] 札から次の操作へ(例: 「持ち物を作る ›」) */
  action?: { label: string; onClick: () => void };
}> = ({ label, icon, value, sub, tone = 'plain', progress = null, testId, action }) => (
  <div className="tc-kit-tile" data-tone={tone} data-testid={testId}>
    <p className="tc-kit-tile__label">{icon && <span aria-hidden="true">{icon}</span>}{label}</p>
    <p className="tc-kit-tile__value">{value}</p>
    {progress != null && (
      <span className="tc-kit-tile__bar" role="progressbar" aria-label={`${label}の進み具合`} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(progress)}><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></span>
    )}
    {sub && <p className="tc-kit-tile__sub">{sub}</p>}
    {action && (
      <button type="button" className="tc-focus-ring tc-kit-tile__act" onClick={action.onClick}>{action.label} ›</button>
    )}
  </div>
);

export interface KitSegTab<T extends string> { id: T; label: string; icon?: React.ReactNode; count?: number | string | null; attention?: boolean }

export function KitSeg<T extends string>({ label, idPrefix, tabs, value, onChange, panelReady = true }: {
  label: string; idPrefix: string; tabs: KitSegTab<T>[]; value: T; onChange: (v: T) => void;
  /** 選んだタブの中身(id=`${idPrefix}-panel-${value}`)が画面にある時だけ aria-controls で指す(無い要素を指さない) */
  panelReady?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className="tc-kit-seg">
      {tabs.map((t) => (
        <button key={t.id} id={`${idPrefix}-tab-${t.id}`} type="button" role="tab" aria-selected={value === t.id}
          aria-controls={value === t.id && panelReady ? `${idPrefix}-panel-${t.id}` : undefined} tabIndex={value === t.id ? 0 : -1}
          className="tc-focus-ring tc-kit-seg__tab" onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const i = tabs.findIndex((x) => x.id === value);
            const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
            onChange(next.id);
            document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
          }}>
          {t.icon && <span aria-hidden="true">{t.icon}</span>}
          {t.label}
          {t.count != null && <span className="tc-kit-cnt" data-tone={t.attention ? 'warn' : undefined}>{` ${t.count}`}</span>}
        </button>
      ))}
    </div>
  );
}

export const KitSection: React.FC<{ title: React.ReactNode; aside?: React.ReactNode; id?: string; children: React.ReactNode; icon?: React.ReactNode }> = ({
  title, aside, id, children, icon,
}) => (
  <section className="tc-kit-section" aria-labelledby={id}>
    <div className="tc-kit-section__head">
      <h2 id={id}>{icon && <span aria-hidden="true">{icon}</span>}{title}</h2>
      {aside && <span>{aside}</span>}
    </div>
    {children}
  </section>
);

/**
 * [Gate TripKitFix] 「予約を追加」。画面ごとに「予約を手入力」「予約を取り込む」を並べず、1 つのボタンから選ぶ。
 * 取り込む(メール・画像)を先に出す。Esc・外を押すと閉じ、開いた時は最初の項目へ移る。
 */
export const KitAddReservation: React.FC<{ onImport: () => void; onManual: () => void }> = ({ onImport, onManual }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const pick = (fn: () => void) => { setOpen(false); fn(); };
  return (
    <div className="tc-kit-addmenu" ref={wrap}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); btn.current?.focus(); } }}>
      <button ref={btn} type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" aria-haspopup="menu"
        aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((v) => !v)} data-testid="kit-add-reservation">
        <Plus size={15} aria-hidden="true" />予約を追加<ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="tc-kit-addmenu__pop" role="menu" id={menuId} aria-label="予約の追加のしかた">
          <button ref={first} type="button" role="menuitem" className="tc-focus-ring tc-kit-addmenu__item" onClick={() => pick(onImport)}>
            <span className="tc-kit-icon" aria-hidden="true"><Inbox size={18} /></span>
            <span><b>メール・画像から取り込む</b><small>読み取った内容を確かめてから登録します</small></span>
          </button>
          <button type="button" role="menuitem" className="tc-focus-ring tc-kit-addmenu__item" onClick={() => pick(onManual)}>
            <span className="tc-kit-icon" data-tone="plain" aria-hidden="true"><PencilLine size={18} /></span>
            <span><b>手入力で作る</b><small>施設名・日時・金額を入れます</small></span>
          </button>
        </div>
      )}
    </div>
  );
};
