/**
 * [Gate P1] 準備タスクパネル(FR-026)。完了条件・担当者・期限を持つタスクの一覧と完了切替。
 *
 * - 未完了を先に、期限の近い順に表示する(backendの並び順)。期限切れは明示する。
 * - 担当者本人は(閲覧者であっても)完了/未完了だけ切り替えられる。編集・削除は編集者以上。
 */
import React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { PreparationTask } from '@/services/api';
import { formatDue } from './preparationModel';

interface Props {
  tasks: PreparationTask[];
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (t: PreparationTask) => void;
  onDelete: (t: PreparationTask) => void;
  onToggle: (t: PreparationTask) => void;
}

const TasksPanel: React.FC<Props> = ({ tasks, canEdit, onAdd, onEdit, onDelete, onToggle }) => {
  const open = tasks.filter((t) => t.status === 'open').length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-700">未完了 {open} 件 / 全 {tasks.length} 件</p>
        {canEdit && (
          <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={onAdd}>
            タスクを追加
          </Button>
        )}
      </div>
      {tasks.length === 0 ? (
        <Card padding="lg" className="text-center text-gray-700">準備タスクはまだありません。</Card>
      ) : (
        <ul className="space-y-2" aria-label="準備タスク">
          {tasks.map((t) => (
            <li key={t.id}>
              <Card padding="sm" className={t.status === 'done' ? 'opacity-75' : ''}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <input
                      id={`task-done-${t.id}`}
                      type="checkbox"
                      className="mt-1"
                      checked={t.status === 'done'}
                      disabled={!t.can_complete}
                      onChange={() => onToggle(t)}
                    />
                    <div className="min-w-0">
                      <label htmlFor={`task-done-${t.id}`} className={`font-medium text-gray-900 ${t.status === 'done' ? 'line-through' : ''}`}>
                        {t.title}
                      </label>
                      <p className="text-xs text-gray-700 mt-0.5">
                        担当: {t.assignee_name ?? (t.assignee_missing ? 'メンバー外(未割当)' : '未定')}
                        {t.due_at && ` ・ 期限: ${formatDue(t.due_at)}`}
                        {t.is_overdue && <span className="ml-1 text-red-800 font-medium">(期限切れ)</span>}
                        {t.related_label && ` ・ 関連: ${t.related_label}`}
                        {t.related_missing && ' ・ 関連先は削除されています'}
                      </p>
                      {t.completion_criteria && <p className="text-xs text-gray-700">完了条件: {t.completion_criteria}</p>}
                      {t.description && <p className="text-xs text-gray-700">{t.description}</p>}
                      {t.status === 'done' && t.completed_by_name && (
                        <p className="text-xs text-gray-700">{t.completed_by_name}さんが完了</p>
                      )}
                    </div>
                  </div>
                  {t.can_edit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => onEdit(t)} className="text-gray-600 hover:text-blue-700 p-1" aria-label={`${t.title}を編集`}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => onDelete(t)} className="text-gray-600 hover:text-red-700 p-1" aria-label={`${t.title}を削除`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TasksPanel;
