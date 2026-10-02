/**
 * [Gate P1] 準備状況(レディネス、FR-026)パネル。
 *
 * 未予約・未確認・未支払・期限・未割当・持ち物不足を一覧にする。「確認していない」と
 * 「問題なし」を同じ表示にしない(取得前は「まだ取得していません」と出す)。
 * 予約・支払などの項目は「タスクにする」で担当者・期限・完了条件を持たせられ、
 * そのタスクを完了にすると項目は対応済みとして一覧から外れる。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { Readiness, ReadinessItem } from '@/services/api';
import { READINESS_CATEGORY_LABEL, SEVERITY_LABEL, formatDue, readinessSummary } from './preparationModel';

const SEVERITY_CLASS: Record<string, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-900',
  low: 'bg-slate-200 text-slate-800',
};

interface Props {
  readiness: Readiness | null;
  canEdit: boolean;
  onMakeTask: (item: ReadinessItem) => void;
  onCompleteTask: (item: ReadinessItem) => void;
}

const ReadinessPanel: React.FC<Props> = ({ readiness, canEdit, onMakeTask, onCompleteTask }) => {
  const navigate = useNavigate();
  const summary = readinessSummary(readiness);
  const toneClass = summary.tone === 'ready'
    ? 'bg-green-50 text-green-900 border-green-200'
    : summary.tone === 'attention' ? 'bg-amber-50 text-amber-900 border-amber-200' : 'bg-gray-50 text-gray-800 border-gray-200';

  return (
    <div className="space-y-4">
      <div className={`p-4 rounded-lg border ${toneClass}`} data-testid="readiness-summary">
        <p className="font-medium">{summary.text}</p>
        {readiness && (
          <p className="text-sm mt-1">
            持ち物: 必須 {readiness.packing.required_ready}/{readiness.packing.required_total} 件準備済み
            ・ タスク: 未完了 {readiness.tasks.open} 件 / 完了 {readiness.tasks.done} 件
          </p>
        )}
      </div>

      {readiness && !readiness.is_ready && (
        <ul className="flex flex-wrap gap-2" aria-label="分類ごとの件数">
          {(Object.keys(READINESS_CATEGORY_LABEL) as Array<keyof typeof READINESS_CATEGORY_LABEL>)
            .filter((c) => readiness.counts.by_category[c] > 0)
            .map((c) => (
              <li key={c} className="text-sm px-2 py-1 rounded bg-gray-100 text-gray-800">
                {READINESS_CATEGORY_LABEL[c]} {readiness.counts.by_category[c]}件
              </li>
            ))}
        </ul>
      )}

      {readiness && readiness.items.length > 0 && (
        <ul className="space-y-3" aria-label="準備が残っている項目">
          {readiness.items.map((item) => (
            <li key={item.key}>
              <Card padding="md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${SEVERITY_CLASS[item.severity]}`}>
                        {SEVERITY_LABEL[item.severity]}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-800">
                        {READINESS_CATEGORY_LABEL[item.category]}
                      </span>
                      <span className="font-medium text-gray-900">{item.title}</span>
                    </div>
                    <p className="text-sm text-gray-700 mt-1">{item.detail}</p>
                    {item.due_at && <p className="text-xs text-gray-700 mt-1">期限: {formatDue(item.due_at)}</p>}
                    {item.task && (
                      <p className="text-xs text-blue-900 mt-1" data-testid={`readiness-task-${item.key}`}>
                        タスクにしました(担当: {item.task.assignee_name ?? '未定'}
                        {item.task.due_at ? `、期限: ${formatDue(item.task.due_at)}` : ''})
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {item.link && (
                      <Button variant="outline" size="sm" onClick={() => navigate(item.link as string)}>
                        開く
                      </Button>
                    )}
                    {item.convertible && !item.task && canEdit && (
                      <Button variant="outline" size="sm" onClick={() => onMakeTask(item)}>
                        タスクにする
                      </Button>
                    )}
                    {item.task && (
                      <Button variant="outline" size="sm" onClick={() => onCompleteTask(item)}>
                        対応済みにする
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ReadinessPanel;
