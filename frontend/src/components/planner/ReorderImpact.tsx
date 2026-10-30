/**
 * [Gate G11] 並べ替えの影響(UIX-M03): 順の変化・営業時間の判定の変化・前後が合わなくなった移動の区間を並べ、
 * 「元に戻す」(動かす前の並びへ)と「このままにする」を出す。時刻・区間・確定の予定は自動では変えない。
 */
import React from 'react';
import Button from '../common/Button';
import type { ReorderImpactModel } from './plannerModel';

interface Props {
  dayId: string;
  model: ReorderImpactModel;
  busy: boolean;
  onUndo: () => void;
  onKeep: () => void;
}

const HOURS_TEXT: Record<Exclude<ReorderImpactModel['hours']['state'], 'changed'>, string> = {
  pending: '営業時間を確かめています…',
  no_place: '営業時間を照合できる場所の予定はありません',
  no_baseline: '動かす前の営業時間の判定が無いため、比べられません',
  unchanged: '営業時間の判定に変化はありません',
};

const ReorderImpact: React.FC<Props> = ({ dayId, model, busy, onUndo, onKeep }) => {
  const titleId = `reorder-impact-title-${dayId}`;
  const { hours, mismatches, segmentCount } = model;
  return (
    <section aria-labelledby={titleId} data-testid="reorder-impact"
      className="rounded-lg border border-cloud-200 bg-surface p-3 text-sm text-ink-900 space-y-2">
      <h4 id={titleId} className="font-semibold">並べ替えの影響</h4>
      <ul className="space-y-0.5" data-testid="reorder-impact-moves">
        {model.moves.map((m) => (
          <li key={m.id}>{`「${m.title}」 ${m.from + 1}番目 → ${m.to + 1}番目`}</li>
        ))}
      </ul>
      <div data-testid="reorder-impact-hours">
        {hours.state === 'changed' ? (
          <>
            <p>営業時間の判定が変わった予定:</p>
            <ul className="space-y-0.5">
              {hours.changes.map((c) => <li key={c.id}>{`「${c.title}」: ${c.before} → ${c.after}`}</li>)}
            </ul>
          </>
        ) : <p>{HOURS_TEXT[hours.state]}</p>}
      </div>
      <p data-testid="reorder-impact-segments"
        className={mismatches.length ? 'rounded-sm bg-warning-soft px-2 py-1 text-warning' : undefined}>
        {segmentCount === 0 ? 'この日には予定へ着く移動の区間がありません'
          : mismatches.length === 0 ? '移動の区間は今の並びと合っています'
            : `⚠ 前後が合わなくなった移動の区間が${mismatches.length}件あります(${mismatches.map((t) => `「${t}」`).join('')}へ着く区間)。区間は自動では直しません`}
      </p>
      <p className="text-xs text-ink-700">
        並びは保存済みです。開始・終了の時刻は自動では変えていません。確定の予定は動かしていません。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" onClick={onUndo} disabled={busy} data-testid="reorder-undo">
          元に戻す
        </Button>
        <Button variant="primary" className="min-h-11" onClick={onKeep} disabled={busy} data-testid="reorder-keep">
          このままにする
        </Button>
      </div>
    </section>
  );
};

export default ReorderImpact;
