/**
 * [Gate G11 段階7] 並べ替えの案(保存する前の影響の確認。UIX-M03)。
 * 触る・矢印キー・ドラッグで動かした並びを、まだ保存せずに見せる: 順の変化・前後が合わなくなる移動の区間・営業時間・確定の予定。
 * 「この並びにする」で1回に保存し、「やめる」で何も変えない。保存の後は ReorderImpact(実際の判定の差と元に戻す)が続く。
 */
import React from 'react';
import Button from '../common/Button';
import type { ReorderImpactModel } from './plannerModel';

interface Props {
  dayId: string;
  model: ReorderImpactModel;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}

const ReorderPreview: React.FC<Props> = ({ dayId, model, busy, onApply, onCancel }) => {
  const titleId = `reorder-preview-title-${dayId}`;
  const { mismatches, segmentCount } = model;
  return (
    <section aria-labelledby={titleId} data-testid="reorder-preview"
      className="rounded-lg border border-accent bg-surface p-3 text-sm text-ink-900 space-y-2">
      <h4 id={titleId} className="font-semibold">並べ替えの案(まだ保存していません)</h4>
      <ul className="space-y-0.5" data-testid="reorder-preview-moves">
        {model.moves.map((m) => (
          <li key={m.id}>{`「${m.title}」 ${m.from + 1}番目 → ${m.to + 1}番目`}</li>
        ))}
      </ul>
      <p data-testid="reorder-preview-segments"
        className={mismatches.length ? 'rounded-sm bg-warning-soft px-2 py-1 text-warning' : undefined}>
        {segmentCount === 0 ? 'この日には予定へ着く移動の区間がありません'
          : mismatches.length === 0 ? '移動の区間は案の並びと合っています'
            : `⚠ この並びにすると、前後が合わなくなる移動の区間が${mismatches.length}件あります(${mismatches.map((t) => `「${t}」`).join('')}へ着く区間)。区間は自動では直しません`}
      </p>
      <p data-testid="reorder-preview-hours">
        開始・終了の時刻は変えないため、営業時間の判定は変わりません(保存の後にもう一度確かめます)。確定(🔒)の予定は動かしません。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" className="min-h-11" onClick={onApply} disabled={busy} data-testid="reorder-apply">
          この並びにする
        </Button>
        <Button variant="outline" className="min-h-11" onClick={onCancel} disabled={busy} data-testid="reorder-cancel">
          やめる
        </Button>
      </div>
    </section>
  );
};

export default ReorderPreview;
