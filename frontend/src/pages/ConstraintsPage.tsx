/**
 * ConstraintsPage - FR-016 制約管理(SC-15の制約部分)。
 *
 * [Gate L2] backend/app/api/v1/constraints.py の画面。ハード制約(違反できない条件)と
 * ソフト制約(重み付きの希望)を、プラン全体・日・イベント・個人の単位で登録する。
 *
 * - 「自分だけ(秘匿)」の制約は、題名・値・理由が作成者本人にだけ表示される。
 *   他のメンバーの画面には「秘匿制約がある」ことと、ハード/ソフトの別だけが出る。
 * - 理由は共有の制約でも作成者本人にだけ表示される。
 * - 旅程が制約を満たすかの検証(FR-017 実行可能性)はまだ行わない。
 *   「制約が無い」ことと「検証していない」ことを同じ表示にしない(SC-15)。
 * - 権限(共有制約の変更は編集者以上、秘匿制約は本人のみ)はbackendが判定し、
 *   拒否された場合は理由を表示する。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  api, createConstraint, deleteConstraint, extractApiErrorDetailMessage, getConstraints, updateConstraint,
} from '@/services/api';
import type { ConstraintType, NormalizedDay, PlanConstraint } from '@/services/api';
import {
  OPERATOR_OPTIONS, TYPE_OPTIONS, UNIT_OPTIONS, applyTypePreset, describeCondition, describeScope, emptyForm,
  formFromConstraint, formToPayload, operatorKind, splitByHardness, typeLabel, unitLabel,
  type ConstraintForm,
} from './constraints/constraintModel';

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return extractApiErrorDetailMessage(detail) ?? fallback;
}

const inputClass = 'w-full border rounded-lg px-3 py-2';

const ConstraintsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [items, setItems] = useState<PlanConstraint[]>([]);
  const [days, setDays] = useState<NormalizedDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<PlanConstraint | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<ConstraintForm>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    if (!planId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [constraints, detail] = await Promise.all([
        getConstraints(planId),
        api.getPlanDetail(planId).catch(() => null),
      ]);
      setItems(constraints);
      setDays(detail?.data?.days ?? []);
    } catch (e) {
      setError(errorMessage(e, '制約の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const events = useMemo(
    () => days.flatMap((d) => (d.events ?? []).map((ev) => ({ id: ev.id, label: `${d.local_date} ${ev.title}` }))),
    [days]
  );
  const { hard, soft } = useMemo(() => splitByHardness(items), [items]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (c: PlanConstraint) => {
    setEditing(c);
    setForm(formFromConstraint(c));
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
  };

  const update = <K extends keyof ConstraintForm>(key: K, value: ConstraintForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId) return;
    const result = formToPayload(form);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      if (editing && editing.revision != null) {
        // 理由を空にした場合は削除する(未指定=変更なし、と区別する)
        await updateConstraint(planId, editing.id, { ...result.data, reason: result.data.reason ?? null }, editing.revision);
      } else {
        await createConstraint(planId, result.data);
      }
      closeForm();
      await load();
    } catch (err) {
      setFormError(errorMessage(err, '制約の保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (c: PlanConstraint) => {
    if (!planId || c.revision == null) return;
    setError(null);
    try {
      await updateConstraint(planId, c.id, { is_active: !c.is_active }, c.revision);
      await load();
    } catch (err) {
      setError(errorMessage(err, '制約の切り替えに失敗しました'));
    }
  };

  const handleDelete = async (c: PlanConstraint) => {
    if (!planId || c.revision == null) return;
    if (!window.confirm(`制約「${c.title ?? ''}」を削除しますか?`)) return;
    setError(null);
    try {
      await deleteConstraint(planId, c.id, c.revision);
      await load();
    } catch (err) {
      setError(errorMessage(err, '制約の削除に失敗しました'));
    }
  };

  if (!planId) {
    return (
      <div className="p-8 text-center text-gray-500">
        プランが選択されていません。
        <div className="mt-4">
          <Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button>
        </div>
      </div>
    );
  }

  const renderCard = (c: PlanConstraint) => {
    if (c.visibility === 'masked') {
      return (
        <Card key={c.id} padding="md" className="bg-gray-50">
          <div className="flex items-center gap-2 text-gray-600">
            <Lock size={16} aria-hidden="true" />
            <span>他のメンバーの秘匿制約</span>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-200">{c.hardness === 'hard' ? 'ハード' : 'ソフト'}</span>
            {!c.is_active && <span className="text-xs px-2 py-0.5 rounded bg-gray-200">無効</span>}
          </div>
          <p className="text-xs text-gray-500 mt-1">内容は作成した本人にだけ表示されます(旅程の判定には使われます)。</p>
        </Card>
      );
    }
    if (c.visibility === 'unavailable') {
      return (
        <Card key={c.id} padding="md" className="bg-yellow-50">
          <div className="text-yellow-800">この秘匿制約の内容を復号できません(サーバーの暗号鍵を確認してください)。</div>
        </Card>
      );
    }
    return (
      <Card key={c.id} padding="md" className={c.is_active ? '' : 'opacity-60'}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{c.title}</span>
              {c.privacy_level === 'private' && (
                <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-800">自分だけ(秘匿)</span>
              )}
              {!c.is_active && <span className="text-xs px-2 py-0.5 rounded bg-gray-200">無効</span>}
            </div>
            <div className="text-sm text-gray-600 mt-1">
              {typeLabel(c.constraint_type)} ・ {describeCondition(c)}
              {c.hardness === 'soft' && c.weight != null && ` ・ 重み ${c.weight}`}
            </div>
            <div className="text-xs text-gray-500 mt-1">適用範囲: {describeScope(c)}</div>
            {c.reason && <div className="text-xs text-gray-500 mt-1">理由(自分だけに表示): {c.reason}</div>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => handleToggle(c)}
              className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
            >
              {c.is_active ? '無効にする' : '有効にする'}
            </button>
            <button type="button" onClick={() => openEdit(c)} className="text-gray-400 hover:text-blue-600 p-1" aria-label={`${c.title}を編集`}>
              <Pencil size={16} />
            </button>
            <button type="button" onClick={() => handleDelete(c)} className="text-gray-400 hover:text-red-600 p-1" aria-label={`${c.title}を削除`}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </Card>
    );
  };

  const kind = operatorKind(form.operator);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">
            ← プランへ戻る
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">制約</h1>
          <p className="text-sm text-gray-500 mt-1">
            守らなければならない条件(ハード)と、できれば叶えたい希望(ソフト)を登録します。
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={18} />} onClick={openCreate}>
          制約を追加
        </Button>
      </div>

      <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-800 text-sm" role="note">
        旅程が制約を満たしているかの検証(実行可能性チェック)はまだ行っていません。
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm" role="alert">{error}</div>}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : items.length === 0 ? (
        <Card padding="lg" className="text-center text-gray-500">
          制約はまだ登録されていません。「制約を追加」から登録できます。
        </Card>
      ) : (
        <div className="space-y-6">
          <section aria-labelledby="hard-heading">
            <h2 id="hard-heading" className="text-lg font-semibold text-gray-900 mb-2">
              ハード制約(守らなければならない条件) {hard.length}件
            </h2>
            <div className="space-y-3">
              {hard.length === 0 ? <p className="text-sm text-gray-500">ありません</p> : hard.map(renderCard)}
            </div>
          </section>
          <section aria-labelledby="soft-heading">
            <h2 id="soft-heading" className="text-lg font-semibold text-gray-900 mb-2">
              ソフト制約(できれば叶えたい希望) {soft.length}件
            </h2>
            <div className="space-y-3">
              {soft.length === 0 ? <p className="text-sm text-gray-500">ありません</p> : soft.map(renderCard)}
            </div>
          </section>
        </div>
      )}

      <Modal isOpen={isFormOpen} onClose={closeForm} title={editing ? '制約の編集' : '制約の追加'} size="md">
        <form onSubmit={handleSubmit} noValidate>
          <Modal.Body>
            <div className="space-y-4">
              {formError && <div className="p-2 rounded bg-red-50 text-red-700 text-sm" role="alert">{formError}</div>}

              <div>
                <label htmlFor="constraint-title" className="block text-sm font-medium text-gray-700 mb-1">題名</label>
                <input
                  id="constraint-title"
                  className={inputClass}
                  value={form.title}
                  maxLength={200}
                  onChange={(e) => update('title', e.target.value)}
                  placeholder="例: 帰りの新幹線に間に合わせる"
                />
              </div>

              <div>
                <label htmlFor="constraint-type" className="block text-sm font-medium text-gray-700 mb-1">種類</label>
                <select
                  id="constraint-type"
                  className={inputClass}
                  value={form.constraint_type}
                  onChange={(e) => setForm((prev) => applyTypePreset(prev, e.target.value as ConstraintType))}
                >
                  {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <fieldset>
                <legend className="block text-sm font-medium text-gray-700 mb-1">強さ</legend>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="radio" name="hardness" checked={form.hardness === 'hard'} onChange={() => update('hardness', 'hard')} />
                    ハード(必ず守る)
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="hardness" checked={form.hardness === 'soft'} onChange={() => update('hardness', 'soft')} />
                    ソフト(できれば)
                  </label>
                </div>
              </fieldset>

              {form.hardness === 'soft' && (
                <div>
                  <label htmlFor="constraint-weight" className="block text-sm font-medium text-gray-700 mb-1">重み(1〜100、大きいほど重視)</label>
                  <input
                    id="constraint-weight"
                    type="number"
                    min={1}
                    max={100}
                    className={inputClass}
                    value={form.weight}
                    onChange={(e) => update('weight', e.target.value)}
                  />
                </div>
              )}

              <div>
                <label htmlFor="constraint-operator" className="block text-sm font-medium text-gray-700 mb-1">条件</label>
                <select
                  id="constraint-operator"
                  className={inputClass}
                  value={form.operator}
                  onChange={(e) => {
                    const next = e.target.value as ConstraintForm['operator'];
                    setForm((prev) => ({
                      ...prev,
                      operator: next,
                      ...(operatorKind(next) !== operatorKind(prev.operator)
                        ? { value: '', value_to: '', unit: operatorKind(next) === 'number' ? 'JPY' : '' }
                        : {}),
                    }));
                  }}
                >
                  {OPERATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {kind === 'time' && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label htmlFor="constraint-value" className="block text-sm font-medium text-gray-700 mb-1">
                      {form.operator === 'between' ? '開始時刻' : '時刻'}
                    </label>
                    <input id="constraint-value" type="time" className={inputClass} value={form.value} onChange={(e) => update('value', e.target.value)} />
                  </div>
                  {form.operator === 'between' && (
                    <div className="flex-1">
                      <label htmlFor="constraint-value-to" className="block text-sm font-medium text-gray-700 mb-1">終了時刻</label>
                      <input id="constraint-value-to" type="time" className={inputClass} value={form.value_to} onChange={(e) => update('value_to', e.target.value)} />
                    </div>
                  )}
                </div>
              )}
              {kind === 'number' && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label htmlFor="constraint-value" className="block text-sm font-medium text-gray-700 mb-1">数値</label>
                    <input id="constraint-value" type="number" min={0} className={inputClass} value={form.value} onChange={(e) => update('value', e.target.value)} />
                  </div>
                  <div className="w-36">
                    <label htmlFor="constraint-unit" className="block text-sm font-medium text-gray-700 mb-1">単位</label>
                    <select id="constraint-unit" className={inputClass} value={form.unit} onChange={(e) => update('unit', e.target.value)}>
                      <option value="">選択</option>
                      {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {kind === 'text' && (
                <div>
                  <label htmlFor="constraint-value" className="block text-sm font-medium text-gray-700 mb-1">内容</label>
                  <input id="constraint-value" className={inputClass} maxLength={200} value={form.value} onChange={(e) => update('value', e.target.value)} />
                </div>
              )}

              <div>
                <label htmlFor="constraint-scope" className="block text-sm font-medium text-gray-700 mb-1">適用範囲</label>
                <select
                  id="constraint-scope"
                  className={inputClass}
                  value={form.scope_type}
                  onChange={(e) => setForm((prev) => ({ ...prev, scope_type: e.target.value as ConstraintForm['scope_type'], scope_id: '' }))}
                >
                  <option value="plan">プラン全体(グループ)</option>
                  <option value="day">日</option>
                  <option value="event">イベント</option>
                  <option value="member">自分個人</option>
                </select>
              </div>
              {form.scope_type === 'day' && (
                <div>
                  <label htmlFor="constraint-scope-id" className="block text-sm font-medium text-gray-700 mb-1">対象の日</label>
                  <select id="constraint-scope-id" className={inputClass} value={form.scope_id} onChange={(e) => update('scope_id', e.target.value)}>
                    <option value="">選択してください</option>
                    {days.map((d) => <option key={d.id} value={d.id}>{d.local_date}</option>)}
                  </select>
                </div>
              )}
              {form.scope_type === 'event' && (
                <div>
                  <label htmlFor="constraint-scope-id" className="block text-sm font-medium text-gray-700 mb-1">対象のイベント</label>
                  <select id="constraint-scope-id" className={inputClass} value={form.scope_id} onChange={(e) => update('scope_id', e.target.value)}>
                    <option value="">選択してください</option>
                    {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
                  </select>
                </div>
              )}

              <fieldset>
                <legend className="block text-sm font-medium text-gray-700 mb-1">公開範囲</legend>
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="radio" name="privacy" checked={form.privacy_level === 'shared'} onChange={() => update('privacy_level', 'shared')} />
                    メンバー全員に表示
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="privacy" checked={form.privacy_level === 'private'} onChange={() => update('privacy_level', 'private')} />
                    自分だけ(秘匿: 内容は自分にだけ表示し、旅程の判定には使う)
                  </label>
                </div>
              </fieldset>

              <div>
                <label htmlFor="constraint-reason" className="block text-sm font-medium text-gray-700 mb-1">理由(任意・自分だけに表示)</label>
                <textarea
                  id="constraint-reason"
                  className={inputClass}
                  rows={2}
                  maxLength={1000}
                  value={form.reason}
                  onChange={(e) => update('reason', e.target.value)}
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => update('is_active', e.target.checked)} />
                有効にする
              </label>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" type="button" onClick={closeForm}>キャンセル</Button>
            <Button variant="primary" type="submit" loading={isSaving}>保存</Button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
};

export default ConstraintsPage;
