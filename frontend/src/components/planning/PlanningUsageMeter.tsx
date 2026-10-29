/**
 * [FR059-B] この旅行の AI・外部検索の利用枠(docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §6)。
 *
 * - 旅行の予算(宿・交通・食事の費用)とは別の枠として「0円 / 50円」を出す(円の切り上げ)
 * - 80%(40円)から残りが少ないと知らせ、上限・月の上限では何が止まったか・案と予定が残ること・手で続ける方法を出す
 * - 外部の有料の提供元がつながっていない間は「未接続(0円)」と出す(値を作らない)
 * - 色だけで伝えない(記号と文字)。provider の名前・内部の単価は出さない
 */
import React, { useEffect, useState } from 'react';
import { getPlanningUsage } from '@/services/api/planningUsage';
import type { PlanningUsage } from '@/services/api/types/planningUsage';
import { usageMessage, yen } from './planningUsageModel';

interface Props {
  planId: string;
  className?: string;
}

const PlanningUsageMeter: React.FC<Props> = ({ planId, className = '' }) => {
  const [usage, setUsage] = useState<PlanningUsage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    getPlanningUsage(planId).then((u) => { if (active) setUsage(u); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [planId]);

  if (failed) {
    return (
      <p className={`text-xs text-ink-700 ${className}`.trim()} data-testid="planning-usage-error">
        AI・外部検索の利用枠を読めませんでした(外部の有料の提供元は呼びません)
      </p>
    );
  }
  if (!usage) return null;
  const used = usage.plan_used_yen_ceil;
  const cap = usage.plan_cap_yen;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const msg = usageMessage(usage);
  const monthly = usage.monthly_cap_jpy !== null
    ? `月の枠 ${yen(usage.monthly_used_jpy)}円 / ${yen(usage.monthly_cap_jpy)}円`
      + (usage.plans_per_month !== null ? ` · 今月の旅行 ${usage.plans_used_this_month} / ${usage.plans_per_month}` : '')
    : usage.class === 'trip_pass' ? 'この旅行の Trip Pass' : null;
  return (
    <section aria-labelledby={`planning-usage-${planId}`} data-testid="planning-usage" data-state={usage.state}
      className={`rounded-xl border border-cloud-200 bg-surface p-3 text-sm text-ink-900 ${className}`.trim()}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`planning-usage-${planId}`} className="text-sm font-semibold">この旅行の AI・外部検索の利用枠</h2>
        <p className="font-semibold tabular-nums" data-testid="planning-usage-amount">{`${used}円 / ${cap}円`}</p>
      </div>
      <div role="meter" aria-label="この旅行の AI・外部検索の利用枠の使用" aria-valuemin={0} aria-valuemax={cap}
        aria-valuenow={used} aria-valuetext={`${cap}円のうち${used}円`}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-cloud-100">
        <div className={`h-full ${usage.state === 'ok' ? 'bg-accent' : usage.state === 'warning' ? 'bg-warning' : 'bg-danger'}`}
          style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-700">
        {`クラス: ${usage.class_label}`}{monthly ? ` · ${monthly}` : ''} · 旅行の費用(予算)には足しません
      </p>
      {!usage.providers_connected && usage.state !== 'guest' && (
        <p className="mt-1 text-xs text-ink-700" data-testid="planning-usage-unconnected">
          ⓘ 外部の有料の提供元(AI・場所・経路)は未接続です(0円)。いまは無料の照会と手での編集だけを使います
        </p>
      )}
      {msg && (
        <p role={msg.tone === 'bad' ? 'alert' : 'status'} data-testid="planning-usage-message" data-tone={msg.tone}
          className={`mt-2 rounded-lg px-2 py-1 text-xs ${msg.tone === 'bad' ? 'bg-danger-soft text-danger'
            : msg.tone === 'warn' ? 'bg-warning-soft text-warning' : 'bg-cloud-100 text-ink-700'}`}>
          <span aria-hidden="true">{msg.symbol} </span>{msg.text}
        </p>
      )}
      {usage.state !== 'guest' && (
        <details className="mt-2 text-xs text-ink-700">
          <summary className="tc-focus-ring cursor-pointer">呼び出しの回数の残り</summary>
          <ul className="mt-1 grid gap-1 sm:grid-cols-2" data-testid="planning-usage-calls">
            {usage.calls.map((c) => (
              <li key={c.operation}>{`${c.label}: 残り ${c.remaining} / ${c.limit}`}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};

export default PlanningUsageMeter;
