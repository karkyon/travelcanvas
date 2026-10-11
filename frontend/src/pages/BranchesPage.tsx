/**
 * BranchesPage - What-if・旅程ブランチの一覧と作成(SC-17 / FR-019)。
 *
 * [Gate P7] backend/app/api/v1/branches.py の画面。雨・遅延・体力・欠席・予算・自由の想定から、
 * 本案を壊さずに分岐案を作る。分岐案の編集・本案との比較・採用は詳細画面(BranchDetailPage)で行う。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GitBranch } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api, { createBranch, getBranches, getPlanMembers } from '@/services/api';
import type { Branch, PlanMember } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  SCENARIO_LABEL, SCENARIO_OPTIONS, STATE_LABEL, createFormToPayload, emptyCreateForm, type CreateForm,
} from './branches/branchModel';

const inputClass = 'w-full border rounded-lg px-3 py-2';

const BranchesPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [days, setDays] = useState<Array<{ id: string; local_date: string }>>([]);
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [form, setForm] = useState<CreateForm>(emptyCreateForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = members.some((m) => m.is_me && (m.role === 'owner' || m.role === 'editor'));

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [b, m, detail] = await Promise.all([getBranches(planId), getPlanMembers(planId), api.getPlanDetail(planId)]);
      setBranches(b);
      setMembers(m);
      setDays((detail.data?.days ?? []).map((d) => ({ id: d.id, local_date: d.local_date })));
    } catch (e) {
      setError(errorDetailMessage(e, '分岐案の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId) return;
    const r = createFormToPayload(form);
    if (!r.ok) return setError(r.error);
    setIsSaving(true);
    setError(null);
    try {
      const created = await createBranch(planId, r.data);
      navigate(`/planner/${planId}/branches/${created.id}`);
    } catch (err) {
      setError(errorDetailMessage(err, '分岐案の作成に失敗しました'));
      setIsSaving(false);
    }
  };

  if (!planId) return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-gray-900">もしもの案(What-if)</h1>
      <p className="text-sm text-gray-700 mt-1">
        雨・遅延・疲れなどを想定した別の案を、本案(今の予定)を変えずに作って比べられます。良い案は本案へ採用できます。
      </p>

      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          {canEdit && (
            <Card padding="md" className="mt-6">
              <form onSubmit={submit} noValidate aria-labelledby="branch-create-heading">
                <h2 id="branch-create-heading" className="font-semibold text-gray-900 mb-3">新しい案を作る</h2>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="branch-title" className="block text-sm font-medium text-gray-800 mb-1">題名</label>
                    <input id="branch-title" className={inputClass} maxLength={200} value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例: 2日目が雨の場合" />
                  </div>
                  <fieldset>
                    <legend className="block text-sm font-medium text-gray-800 mb-1">想定</legend>
                    <div className="grid sm:grid-cols-2 gap-1 text-sm">
                      {SCENARIO_OPTIONS.map((o) => (
                        <label key={o.value} className="flex items-start gap-2">
                          <input type="radio" name="branch-scenario" className="mt-1" checked={form.scenario_type === o.value}
                            onChange={() => setForm({ ...form, scenario_type: o.value })} />
                          <span><span className="font-medium">{o.label}</span><span className="block text-xs text-gray-700">{o.help}</span></span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {form.scenario_type === 'delay' && (
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div>
                        <label htmlFor="branch-day" className="block text-sm font-medium text-gray-800 mb-1">遅延する日</label>
                        <select id="branch-day" className={inputClass} value={form.day_id}
                          onChange={(e) => setForm({ ...form, day_id: e.target.value })}>
                          <option value="">選んでください</option>
                          {days.map((d) => <option key={d.id} value={d.id}>{d.local_date}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="branch-after" className="block text-sm font-medium text-gray-800 mb-1">この時刻以降(任意)</label>
                        <input id="branch-after" type="time" className={inputClass} value={form.after}
                          onChange={(e) => setForm({ ...form, after: e.target.value })} />
                      </div>
                      <div>
                        <label htmlFor="branch-minutes" className="block text-sm font-medium text-gray-800 mb-1">遅れ(分)</label>
                        <input id="branch-minutes" inputMode="numeric" className={inputClass} value={form.minutes}
                          onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
                      </div>
                    </div>
                  )}
                  {form.scenario_type === 'fatigue' && (
                    <div>
                      <label htmlFor="branch-max" className="block text-sm font-medium text-gray-800 mb-1">1日の予定数の上限</label>
                      <input id="branch-max" inputMode="numeric" className={inputClass} value={form.max_events_per_day}
                        onChange={(e) => setForm({ ...form, max_events_per_day: e.target.value })} />
                    </div>
                  )}
                  {form.scenario_type === 'budget' && (
                    <div>
                      <label htmlFor="branch-budget" className="block text-sm font-medium text-gray-800 mb-1">予算の削減率(%)</label>
                      <input id="branch-budget" inputMode="numeric" className={inputClass} value={form.budget_cut_percent}
                        onChange={(e) => setForm({ ...form, budget_cut_percent: e.target.value })} />
                    </div>
                  )}
                  {form.scenario_type === 'absence' && (
                    <div>
                      <label htmlFor="branch-absent" className="block text-sm font-medium text-gray-800 mb-1">参加できない人(任意)</label>
                      <input id="branch-absent" className={inputClass} maxLength={100} value={form.absent_member}
                        onChange={(e) => setForm({ ...form, absent_member: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <label htmlFor="branch-note" className="block text-sm font-medium text-gray-800 mb-1">メモ(任意)</label>
                    <textarea id="branch-note" className={inputClass} rows={2} maxLength={500} value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })} />
                  </div>
                  <Button variant="primary" type="submit" loading={isSaving} icon={<GitBranch size={16} />}>案を作る</Button>
                </div>
              </form>
            </Card>
          )}

          <section aria-labelledby="branch-list-heading" className="mt-6">
            <h2 id="branch-list-heading" className="font-semibold text-gray-900 mb-2">作った案</h2>
            {branches.length === 0 ? (
              <Card padding="lg" className="text-center text-gray-700">まだ案はありません。</Card>
            ) : (
              <ul className="space-y-2" aria-label="作った案">
                {branches.map((b) => (
                  <li key={b.id}>
                    <Card padding="md">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-900">
                            {b.title}
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-800">{SCENARIO_LABEL[b.scenario_type]}</span>
                            <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-900">{STATE_LABEL[b.state]}</span>
                          </p>
                          <p className="text-xs text-gray-700 mt-1">
                            {b.created_by_name} ・ 追加{b.summary.added} 外す{b.summary.removed} 変更{b.summary.updated}
                            {b.state === 'draft' && b.plan_changed_since_base && ' ・ 作成後に本案が更新されています'}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => navigate(`/planner/${planId}/branches/${b.id}`)}>
                          開く
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default BranchesPage;
