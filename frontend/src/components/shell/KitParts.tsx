/**
 * [Gate TripKitUI] 旅行箱の 6 画面で同じ形に使う部品(改善モックアップ 2026-11-16 の「統一の決まり」)。
 *
 * - KitHead: 小見出し「旅行箱」(アイコン)・画面名(h1)・1 行の説明・右に操作(主な操作は 1 つ)
 * - KitTiles / KitTile: 画面の最初の要約(3〜4 枚)。要確認は橙の枠で同じ形
 * - KitSeg: 画面の中の切り替え(準備・費用で同じ形)。role="tab" と id は呼び出し側の接頭辞で作る
 * - KitSection: 一覧の見出しと右の補足
 */
import React from 'react';

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
  label: string; icon?: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: 'warn' | 'plain';
  /** 0〜100 の進み具合(無ければ棒を出さない) */
  progress?: number | null; testId?: string;
}> = ({ label, icon, value, sub, tone = 'plain', progress = null, testId }) => (
  <div className="tc-kit-tile" data-tone={tone} data-testid={testId}>
    <p className="tc-kit-tile__label">{icon && <span aria-hidden="true">{icon}</span>}{label}</p>
    <p className="tc-kit-tile__value">{value}</p>
    {progress != null && (
      <span className="tc-kit-tile__bar" role="progressbar" aria-label={`${label}の進み具合`} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(progress)}><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></span>
    )}
    {sub && <p className="tc-kit-tile__sub">{sub}</p>}
  </div>
);

export interface KitSegTab<T extends string> { id: T; label: string; icon?: React.ReactNode; count?: number | null; attention?: boolean }

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
