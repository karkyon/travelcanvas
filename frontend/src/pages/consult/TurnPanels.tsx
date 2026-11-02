/**
 * [Gate F07] 会話の1ターンの変更案(予算・その他の希望・方面の取り消し)と、複数の予算・決めた方面の表示。
 * 採用・却下・外すは外へ送らない(費用・回数は戻らない)。項目(人数・泊数など)の変更案は確認の表の行に出す。
 */
import React from 'react';
import Button from '@/components/common/Button';
import type { ReviewState } from './consultModel';
import { budgetLabel, changeLabel } from './consultTurnModel';

export const TurnPanels: React.FC<{
  review: ReviewState;
  onDecide: (id: string, accept: boolean) => void;
  onBudgetConfirm: (id: string, on: boolean) => void;
  onBudgetRemove: (id: string) => void;
}> = ({ review, onDecide, onBudgetConfirm, onBudgetRemove }) => {
  const pending = review.turnPending ?? [];
  const extra = review.extraBudgets ?? [];
  if (pending.length === 0 && extra.length === 0 && !review.decidedArea) return null;
  return (
    <section className="mt-4 space-y-3 rounded-2xl border border-cloud-200 bg-surface p-4 text-sm" data-testid="consult-turn-panels"
      aria-label="会話で変わった条件">
      {review.decidedArea && (
        <p data-testid="consult-decided-area"><b>決めた方面:</b>{` ${review.decidedArea}`}
          <span className="text-xs text-ink-700">(他の方面は候補のまま)</span></p>
      )}
      {pending.length > 0 && (
        <div>
          <h3 className="font-semibold text-ink-900">確かめた条件への変更案(採用するまで変えません)</h3>
          <ul className="mt-1 space-y-1">
            {pending.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2" data-testid={`turn-change-${c.id}`}>
                <span>{changeLabel(c)}</span>
                <span className="text-xs text-ink-700">{`根拠: 「${c.evidence}」`}</span>
                <Button type="button" size="sm" onClick={() => onDecide(c.id, true)} data-testid={`turn-accept-${c.id}`}>採用</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onDecide(c.id, false)}
                  data-testid={`turn-reject-${c.id}`}>採用しない</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {extra.length > 0 && (
        <div>
          <h3 className="font-semibold text-ink-900">追加の予算(宿・旅行全体などを別々に持ちます)</h3>
          <ul className="mt-1 space-y-1">
            {extra.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2" data-testid={`turn-budget-${b.id}`}>
                <span>{budgetLabel(b)}</span>
                {b.evidence && <span className="text-xs text-ink-700">{`根拠: 「${b.evidence}」`}</span>}
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={b.confirmed} onChange={(e) => onBudgetConfirm(b.id, e.target.checked)}
                    data-testid={`turn-budget-confirm-${b.id}`} />
                  確かめた(下書きに使う)
                </label>
                <Button type="button" size="sm" variant="ghost" onClick={() => onBudgetRemove(b.id)}
                  data-testid={`turn-budget-remove-${b.id}`}>外す</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
