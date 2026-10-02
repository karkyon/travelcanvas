/**
 * PreparationPage - 出発前の準備(SC-21 持ち物 / SC-22 レディネス)。
 *
 * [Gate P1] backend/app/api/v1/preparation.py の画面。3つのタブで構成する:
 *   - 準備状況(FR-026): 未予約・未確認・未支払・期限・未割当・持ち物不足を一覧にし、
 *     予約・支払などの項目は「タスクにする」で担当・期限・完了条件を付けて対応できる
 *   - 持ち物(FR-025): 共有/自分だけ、数量・必須・担当・状態。旅程と条件から理由付きの候補を出す
 *   - タスク(FR-026): 完了条件・担当者・期限を持つ準備タスク
 * 変更のたびに3つ全てを読み直す(準備状況は持ち物・タスク・予約から算出されるため)。
 * 権限はbackendが判定し、拒否された場合は理由を表示する。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  createPackingItem, createPreparationTask, deletePackingItem, deletePreparationTask, extractApiErrorDetailMessage,
  getPackingItems, getPackingSuggestions, getPlanMembers, getPreparationTasks, getReadiness, updatePackingItem,
  updatePreparationTask,
} from '@/services/api';
import type {
  PackingItem, PackingStatus, PackingSuggestion, PackingSuggestionConditions, PackingSuggestions, PlanMember,
  PreparationTask, Readiness, ReadinessItem,
} from '@/services/api';
import PackingPanel from './preparation/PackingPanel';
import ReadinessPanel from './preparation/ReadinessPanel';
import TasksPanel from './preparation/TasksPanel';
import {
  CATEGORY_OPTIONS, STATUS_OPTIONS, emptyPackingForm, emptyTaskForm, packingFormFromItem, packingFormToPayload,
  taskFormFromTask, taskFormToPayload, type PackingForm, type TaskForm,
} from './preparation/preparationModel';

type Tab = 'readiness' | 'packing' | 'tasks';
const TABS: { id: Tab; label: string }[] = [
  { id: 'readiness', label: '準備状況' },
  { id: 'packing', label: '持ち物' },
  { id: 'tasks', label: 'タスク' },
];

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return extractApiErrorDetailMessage(detail) ?? fallback;
}

const inputClass = 'w-full border rounded-lg px-3 py-2';

const PreparationPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('readiness');
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [items, setItems] = useState<PackingItem[]>([]);
  const [tasks, setTasks] = useState<PreparationTask[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [conditions, setConditions] = useState<PackingSuggestionConditions>({});
  const [suggestions, setSuggestions] = useState<PackingSuggestions | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const [packingEditing, setPackingEditing] = useState<PackingItem | null>(null);
  const [isPackingFormOpen, setIsPackingFormOpen] = useState(false);
  const [packingForm, setPackingForm] = useState<PackingForm>(emptyPackingForm());

  const [taskEditing, setTaskEditing] = useState<PreparationTask | null>(null);
  const [taskReadinessKey, setTaskReadinessKey] = useState<string | null>(null);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm());

  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const me = useMemo(() => members.find((m) => m.is_me) ?? null, [members]);
  const canEdit = me?.role === 'owner' || me?.role === 'editor';

  const load = useCallback(async () => {
    if (!planId) return;
    // 操作の失敗理由(run()が設定)を読み直しで消さないよう、ここではerrorを消さない
    try {
      const [m, p, t, r] = await Promise.all([
        getPlanMembers(planId), getPackingItems(planId), getPreparationTasks(planId), getReadiness(planId),
      ]);
      setMembers(m);
      setItems(p);
      setTasks(t);
      setReadiness(r);
    } catch (e) {
      setError(errorMessage(e, '準備情報の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e, fallback));
      await load();
      return false;
    }
  };

  const showSuggestions = async (next: PackingSuggestionConditions = conditions) => {
    if (!planId) return;
    setIsLoadingSuggestions(true);
    try {
      setSuggestions(await getPackingSuggestions(planId, next));
    } catch (e) {
      setError(errorMessage(e, '持ち物の候補の取得に失敗しました'));
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const refreshSuggestionsIfShown = async () => {
    if (suggestions) await showSuggestions();
  };

  // ----- 持ち物
  const openPackingCreate = () => {
    setPackingEditing(null);
    setPackingForm(emptyPackingForm());
    setFormError(null);
    setIsPackingFormOpen(true);
  };
  const openPackingEdit = (item: PackingItem) => {
    setPackingEditing(item);
    setPackingForm(packingFormFromItem(item));
    setFormError(null);
    setIsPackingFormOpen(true);
  };

  const submitPacking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId) return;
    const result = packingFormToPayload(packingForm);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      if (packingEditing) {
        const d = result.data;
        await updatePackingItem(
          planId, packingEditing.id,
          {
            name: d.name, category: d.category, quantity: d.quantity, is_required: d.is_required, status: d.status,
            note: d.note ?? null,
            ...(packingEditing.scope === 'shared' ? { assignee_user_id: d.assignee_user_id ?? null } : {}),
          },
          packingEditing.revision,
        );
      } else {
        await createPackingItem(planId, result.data);
      }
      setIsPackingFormOpen(false);
      await load();
      await refreshSuggestionsIfShown();
    } catch (err) {
      setFormError(errorMessage(err, '持ち物の保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  const adoptSuggestion = async (s: PackingSuggestion) => {
    if (!planId) return;
    const ok = await run(() => createPackingItem(planId, {
      name: s.name, category: s.category, quantity: s.quantity, is_required: s.is_required, scope: s.scope,
      suggestion_key: s.key,
    }), '候補の追加に失敗しました');
    if (ok) await refreshSuggestionsIfShown();
  };

  const applyQuantity = async (itemId: string, quantity: number) => {
    if (!planId) return;
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const ok = await run(() => updatePackingItem(planId, itemId, { quantity }, item.revision), '数量の変更に失敗しました');
    if (ok) await refreshSuggestionsIfShown();
  };

  const changeStatus = (item: PackingItem, status: PackingStatus) => {
    if (!planId) return;
    void run(() => updatePackingItem(planId, item.id, { status }, item.revision), '状態の変更に失敗しました');
  };

  const removePacking = async (item: PackingItem) => {
    if (!planId) return;
    if (!window.confirm(`持ち物「${item.name ?? ''}」を削除しますか?`)) return;
    const ok = await run(() => deletePackingItem(planId, item.id, item.revision), '持ち物の削除に失敗しました');
    if (ok) await refreshSuggestionsIfShown();
  };

  // ----- タスク
  const openTaskCreate = (readinessItem?: ReadinessItem) => {
    setTaskEditing(null);
    setTaskReadinessKey(readinessItem?.key ?? null);
    setTaskForm(emptyTaskForm(readinessItem ? readinessItem.title : ''));
    setFormError(null);
    setIsTaskFormOpen(true);
  };
  const openTaskEdit = (t: PreparationTask) => {
    setTaskEditing(t);
    setTaskReadinessKey(null);
    setTaskForm(taskFormFromTask(t));
    setFormError(null);
    setIsTaskFormOpen(true);
  };

  const submitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId) return;
    const result = taskFormToPayload(taskForm);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      if (taskEditing) {
        await updatePreparationTask(planId, taskEditing.id, {
          title: result.data.title,
          description: result.data.description ?? null,
          completion_criteria: result.data.completion_criteria ?? null,
          due_at: result.data.due_at ?? null,
          assignee_user_id: result.data.assignee_user_id ?? null,
        }, taskEditing.revision);
      } else {
        await createPreparationTask(planId, { ...result.data, ...(taskReadinessKey ? { readiness_key: taskReadinessKey } : {}) });
      }
      setIsTaskFormOpen(false);
      await load();
    } catch (err) {
      setFormError(errorMessage(err, 'タスクの保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTask = (t: PreparationTask) => {
    if (!planId) return;
    void run(() => updatePreparationTask(planId, t.id, { status: t.status === 'done' ? 'open' : 'done' }, t.revision),
      'タスクの更新に失敗しました');
  };

  const completeReadinessTask = (item: ReadinessItem) => {
    if (!planId || !item.task) return;
    const taskRef = item.task;
    void run(() => updatePreparationTask(planId, taskRef.id, { status: 'done' }, taskRef.revision),
      'タスクの更新に失敗しました');
  };

  const removeTask = (t: PreparationTask) => {
    if (!planId) return;
    if (!window.confirm(`タスク「${t.title}」を削除しますか?`)) return;
    void run(() => deletePreparationTask(planId, t.id, t.revision), 'タスクの削除に失敗しました');
  };

  if (!planId) {
    return (
      <div className="p-8 text-center text-gray-700">
        プランが選択されていません。
        <div className="mt-4">
          <Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button>
        </div>
      </div>
    );
  }

  const updatePacking = <K extends keyof PackingForm>(key: K, value: PackingForm[K]) =>
    setPackingForm((prev) => ({ ...prev, [key]: value }));
  const updateTask = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) =>
    setTaskForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">
          ← プランへ戻る
        </Button>
        <h1 className="text-2xl font-bold text-gray-900">出発前の準備</h1>
        <p className="text-sm text-gray-700 mt-1">準備状況・持ち物・準備タスクをまとめて確認します。</p>
      </div>

      <div role="tablist" aria-label="準備の表示切替" className="flex gap-2 mb-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`prep-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`prep-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 -mb-px border-b-2 font-medium ${tab === t.id ? 'border-blue-600 text-blue-800' : 'border-transparent text-gray-700'}`}
          >
            {t.label}
            {t.id === 'readiness' && readiness && !readiness.is_ready ? `(${readiness.counts.total})` : ''}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <div role="tabpanel" id={`prep-panel-${tab}`} aria-labelledby={`prep-tab-${tab}`}>
          {tab === 'readiness' && (
            <ReadinessPanel
              readiness={readiness}
              canEdit={canEdit}
              onMakeTask={(item) => openTaskCreate(item)}
              onCompleteTask={completeReadinessTask}
            />
          )}
          {tab === 'packing' && (
            <PackingPanel
              items={items}
              canEdit={canEdit}
              myUserId={me?.user_id ?? null}
              suggestions={suggestions}
              conditions={conditions}
              isLoadingSuggestions={isLoadingSuggestions}
              onConditionsChange={(c) => {
                setConditions(c);
                if (suggestions) void showSuggestions(c);
              }}
              onShowSuggestions={() => void showSuggestions()}
              onAdoptSuggestion={adoptSuggestion}
              onApplyQuantity={applyQuantity}
              onAdd={openPackingCreate}
              onEdit={openPackingEdit}
              onDelete={removePacking}
              onStatusChange={changeStatus}
            />
          )}
          {tab === 'tasks' && (
            <TasksPanel
              tasks={tasks}
              canEdit={canEdit}
              onAdd={() => openTaskCreate()}
              onEdit={openTaskEdit}
              onDelete={removeTask}
              onToggle={toggleTask}
            />
          )}
        </div>
      )}

      <Modal isOpen={isPackingFormOpen} onClose={() => setIsPackingFormOpen(false)} title={packingEditing ? '持ち物の編集' : '持ち物の追加'} size="md">
        <form onSubmit={submitPacking} noValidate>
          <Modal.Body>
            <div className="space-y-4">
              {formError && <div className="p-2 rounded bg-red-50 text-red-800 text-sm" role="alert">{formError}</div>}
              <div>
                <label htmlFor="packing-name" className="block text-sm font-medium text-gray-800 mb-1">名前</label>
                <input id="packing-name" className={inputClass} maxLength={120} value={packingForm.name}
                  onChange={(e) => updatePacking('name', e.target.value)} placeholder="例: 折りたたみ傘" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label htmlFor="packing-category" className="block text-sm font-medium text-gray-800 mb-1">分類</label>
                  <select id="packing-category" className={inputClass} value={packingForm.category}
                    onChange={(e) => updatePacking('category', e.target.value as PackingForm['category'])}>
                    {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="w-28">
                  <label htmlFor="packing-quantity" className="block text-sm font-medium text-gray-800 mb-1">数量</label>
                  <input id="packing-quantity" type="number" min={1} max={999} className={inputClass} value={packingForm.quantity}
                    onChange={(e) => updatePacking('quantity', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="packing-status" className="block text-sm font-medium text-gray-800 mb-1">状態</label>
                <select id="packing-status" className={inputClass} value={packingForm.status}
                  onChange={(e) => updatePacking('status', e.target.value as PackingStatus)}>
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={packingForm.is_required} onChange={(e) => updatePacking('is_required', e.target.checked)} />
                必須(忘れると困るもの)
              </label>
              {!packingEditing && (
                <fieldset>
                  <legend className="block text-sm font-medium text-gray-800 mb-1">公開範囲</legend>
                  <div className="space-y-1 text-sm">
                    <label className="flex items-center gap-1">
                      <input type="radio" name="packing-scope" checked={packingForm.scope === 'shared'}
                        onChange={() => updatePacking('scope', 'shared')} />
                      メンバー全員(共有の持ち物)
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="packing-scope" checked={packingForm.scope === 'personal'}
                        onChange={() => updatePacking('scope', 'personal')} />
                      自分だけ(薬など。内容は自分にだけ表示されます)
                    </label>
                  </div>
                </fieldset>
              )}
              {packingForm.scope === 'shared' && (
                <div>
                  <label htmlFor="packing-assignee" className="block text-sm font-medium text-gray-800 mb-1">担当</label>
                  <select id="packing-assignee" className={inputClass} value={packingForm.assignee_user_id}
                    onChange={(e) => updatePacking('assignee_user_id', e.target.value)}>
                    <option value="">未定</option>
                    {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}{m.is_me ? '(自分)' : ''}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="packing-note" className="block text-sm font-medium text-gray-800 mb-1">メモ(任意)</label>
                <input id="packing-note" className={inputClass} maxLength={500} value={packingForm.note}
                  onChange={(e) => updatePacking('note', e.target.value)} />
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" type="button" onClick={() => setIsPackingFormOpen(false)}>キャンセル</Button>
            <Button variant="primary" type="submit" loading={isSaving}>保存</Button>
          </Modal.Footer>
        </form>
      </Modal>

      <Modal isOpen={isTaskFormOpen} onClose={() => setIsTaskFormOpen(false)} title={taskEditing ? 'タスクの編集' : 'タスクの追加'} size="md">
        <form onSubmit={submitTask} noValidate>
          <Modal.Body>
            <div className="space-y-4">
              {formError && <div className="p-2 rounded bg-red-50 text-red-800 text-sm" role="alert">{formError}</div>}
              {taskReadinessKey && (
                <p className="text-sm text-gray-700">準備状況の項目からタスクを作ります。完了にすると、その項目は対応済みになります。</p>
              )}
              <div>
                <label htmlFor="task-title" className="block text-sm font-medium text-gray-800 mb-1">題名</label>
                <input id="task-title" className={inputClass} maxLength={200} value={taskForm.title}
                  onChange={(e) => updateTask('title', e.target.value)} placeholder="例: 両替する" />
              </div>
              <div>
                <label htmlFor="task-criteria" className="block text-sm font-medium text-gray-800 mb-1">完了条件(任意)</label>
                <input id="task-criteria" className={inputClass} maxLength={500} value={taskForm.completion_criteria}
                  onChange={(e) => updateTask('completion_criteria', e.target.value)} placeholder="例: 現地通貨を受け取った" />
              </div>
              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-[12rem]">
                  <label htmlFor="task-assignee" className="block text-sm font-medium text-gray-800 mb-1">担当</label>
                  <select id="task-assignee" className={inputClass} value={taskForm.assignee_user_id}
                    onChange={(e) => updateTask('assignee_user_id', e.target.value)}>
                    <option value="">未定</option>
                    {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}{m.is_me ? '(自分)' : ''}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[12rem]">
                  <label htmlFor="task-due" className="block text-sm font-medium text-gray-800 mb-1">期限(任意)</label>
                  <input id="task-due" type="datetime-local" className={inputClass} value={taskForm.due_local}
                    onChange={(e) => updateTask('due_local', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="task-description" className="block text-sm font-medium text-gray-800 mb-1">メモ(任意)</label>
                <textarea id="task-description" className={inputClass} rows={2} maxLength={2000} value={taskForm.description}
                  onChange={(e) => updateTask('description', e.target.value)} />
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" type="button" onClick={() => setIsTaskFormOpen(false)}>キャンセル</Button>
            <Button variant="primary" type="submit" loading={isSaving}>保存</Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
};

export default PreparationPage;
