/**
 * [FR059-B] この旅行の AI・外部検索の利用枠(docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §6)。
 *
 * - 旅行の予算(宿・交通・食事の費用)とは別の枠として「0円 / 50円」を出す(円の切り上げ)
 * - 80%(40円)から残りが少ないと知らせ、上限・月の上限では何が止まったか・案と予定が残ること・手で続ける方法を出す
 * - 外部の有料の提供元がつながっていない間は「未接続(0円)」と出す(値を作らない)
 * - 色だけで伝えない(記号と文字)。provider の名前・内部の単価は出さない
 * - [G11-UsageLayout] 全ての状態(読み込み中・通常・残り少ない・上限・月の上限・ゲスト・読めない)で、同じ高さの行の並びにする
 *   (見出しと金額 1行・帯・クラスの行 1行・知らせの場所 2行・「詳しく」の行 1行)。以前は状態・画面の幅で高さが変わり、
 *   下の予定の一覧が読み終わった後に 360px で最大 76px 動いていた(docs/trace/gate-g11-usage-layout-trace.md)。
 *   知らせは要点を先に書き、2行に収まらない分は見た目だけ省く。全文は読み上げ(要素に全文がある)と「詳しく」で読める
 */
import React, { useEffect, useState } from 'react';
import { getPlanningUsage } from '@/services/api/planningUsage';
import type { PlanningUsage } from '@/services/api/types/planningUsage';
import { usageMessage, yen } from './planningUsageModel';

interface Props {
  planId: string;
  className?: string;
}

// 行の高さは固定(状態で変えない)。文字は text-xs・行の高さ 16px
const ROW = 'mt-1 h-4 truncate text-xs leading-4 text-ink-700';
const NOTICE = 'mt-2 h-10 overflow-hidden';
const NOTICE_TEXT = 'line-clamp-2 text-xs leading-4';
const FOOT = 'mt-2 text-xs text-ink-700';
const FOOT_ROW = 'flex h-5 items-center leading-4';

const PlanningUsageMeter: React.FC<Props> = ({ planId, className = '' }) => {
  const [usage, setUsage] = useState<PlanningUsage | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setUsage(null);
    getPlanningUsage(planId).then((u) => { if (active) setUsage(u); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [planId, attempt]);

  const frame = `rounded-xl border border-cloud-200 bg-surface p-3 text-sm text-ink-900 ${className}`.trim();
  const heading = (amount: React.ReactNode) => (
    <div className="flex h-5 items-center justify-between gap-2">
      <h2 id={`planning-usage-${planId}`} className="min-w-0 truncate text-sm font-semibold leading-5">この旅行の AI・外部検索の利用枠</h2>
      {amount}
    </div>
  );

  if (failed || !usage) {
    return (
      <section aria-labelledby={`planning-usage-${planId}`} aria-busy={!failed} className={frame}
        data-testid={failed ? 'planning-usage-failed' : 'planning-usage-loading'}>
        {heading(<p className="shrink-0 font-semibold tabular-nums leading-5 text-ink-700" aria-hidden="true">— 円 / — 円</p>)}
        <div aria-hidden="true" className="mt-2 h-2 w-full rounded-full bg-cloud-100" />
        {failed ? (
          <>
            <p className={ROW} aria-hidden="true">&nbsp;</p>
            <div className={NOTICE}>
              <p className={`${NOTICE_TEXT} text-ink-700`} data-testid="planning-usage-error" role="status">
                AI・外部検索の利用枠を読めませんでした(外部の有料の提供元は呼びません)。予定の編集・保存はそのまま使えます
              </p>
            </div>
            <div className={FOOT}>
              <div className={FOOT_ROW}>
                <button type="button" className="tc-focus-ring font-semibold text-accent underline"
                  onClick={() => setAttempt((n) => n + 1)}>
                  もう一度読む
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className={ROW} role="status">利用枠を読み込んでいます…</p>
            <div className={NOTICE} aria-hidden="true" />
            <div className={FOOT} aria-hidden="true"><div className={FOOT_ROW}>&nbsp;</div></div>
          </>
        )}
      </section>
    );
  }

  const used = usage.plan_used_yen_ceil;
  const cap = usage.plan_cap_yen;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const msg = usageMessage(usage);
  const monthly = usage.monthly_cap_jpy !== null
    ? `月の枠 ${yen(usage.monthly_used_jpy)}円 / ${yen(usage.monthly_cap_jpy)}円`
      + (usage.plans_per_month !== null ? ` · 今月の旅行 ${usage.plans_used_this_month} / ${usage.plans_per_month}` : '')
    : usage.class === 'trip_pass' ? 'この旅行の Trip Pass' : null;
  const classText = `クラス: ${usage.class_label}${monthly ? ` · ${monthly}` : ''} · 旅行の費用(予算)には足しません`;
  const unconnected = !usage.providers_connected && usage.state !== 'guest' && !msg;
  const unconnectedText = '外部の有料の提供元(AI・場所・経路)は未接続です(0円)。いまは無料の照会と手での編集だけを使います';
  return (
    <section aria-labelledby={`planning-usage-${planId}`} data-testid="planning-usage" data-state={usage.state}
      className={frame}>
      {heading(<p className="shrink-0 font-semibold tabular-nums leading-5" data-testid="planning-usage-amount">{`${used}円 / ${cap}円`}</p>)}
      <div role="meter" aria-label="この旅行の AI・外部検索の利用枠の使用" aria-valuemin={0} aria-valuemax={cap}
        aria-valuenow={used} aria-valuetext={`${cap}円のうち${used}円`}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-cloud-100">
        <div className={`h-full ${usage.state === 'ok' ? 'bg-accent' : usage.state === 'warning' ? 'bg-warning' : 'bg-danger'}`}
          style={{ width: `${pct}%` }} />
      </div>
      <p className={ROW} title={classText} data-testid="planning-usage-class">{classText}</p>
      <div className={NOTICE}>
        {msg ? (
          <p role={msg.tone === 'bad' ? 'alert' : 'status'} data-testid="planning-usage-message" data-tone={msg.tone}
            title={msg.text}
            className={`h-10 rounded-lg px-2 py-1 ${msg.tone === 'bad' ? 'bg-danger-soft text-danger'
              : msg.tone === 'warn' ? 'bg-warning-soft text-warning' : 'bg-cloud-100 text-ink-700'}`}>
            <span className={NOTICE_TEXT}><span aria-hidden="true">{msg.symbol} </span>{msg.text}</span>
          </p>
        ) : unconnected ? (
          <p className={`${NOTICE_TEXT} text-ink-700`} data-testid="planning-usage-unconnected" title={unconnectedText}>
            ⓘ {unconnectedText}
          </p>
        ) : null}
      </div>
      <details className={FOOT} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className={`tc-focus-ring cursor-pointer ${FOOT_ROW}`} data-testid="planning-usage-more">
          <span aria-hidden="true" className="mr-1">{open ? '▴' : '▾'}</span>
          {usage.state === 'guest' ? '詳しく' : '詳しく(呼び出しの回数の残り)'}
        </summary>
        {/* 開いた時だけ全文を見せる(利用者が開いた時の高さの変化だけ。読み込みの後に勝手には動かない) */}
        <div className="mt-1 space-y-1" data-testid="planning-usage-details">
          {msg && <p>{msg.text}</p>}
          {unconnected && <p>{unconnectedText}</p>}
          <p>{classText}</p>
          {usage.state !== 'guest' && (
            <ul className="grid gap-1 sm:grid-cols-2" data-testid="planning-usage-calls">
              {usage.calls.map((c) => (
                <li key={c.operation}>{`${c.label}: 残り ${c.remaining} / ${c.limit}`}</li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
};

export default PlanningUsageMeter;
