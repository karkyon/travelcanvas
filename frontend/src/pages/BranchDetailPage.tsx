/**
 * BranchDetailPage - 分岐案の編集・本案との比較・採用(SC-17 / FR-019)。
 *
 * [Gate P7] 分岐案の予定を日ごとに編集し(時刻・題名・日付の変更、外す、追加)、本案との差分と
 * 採用できない理由を見て、採用・見送り・削除を行う。採用は本案への1つの変更セットで、本案の「元に戻す」で取り消せる。
 * 採用できない理由(分岐後に本案でも変更された等)がある間は採用ボタンを押せない。
 * [Gate G7] FR-019 「移動・検証・費用で比べる」: 本案とこの案の移動時間・検証の件数と新たな問題・疲れ・費用・予約への影響。
 * [Gate G8] FR-019 案の中で移動区間・予約を変える(BranchResourcesPanel。予定と一緒に保存する)。採用の前に変更ごとに
 * 確かめ、選んだ変更だけを採用できる(AdoptionDialog)。区間・予約の変更が無い案は今までどおりの確認で採用する。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { adoptBranch, deleteBranch, getBranch, updateBranch, updateBranchContent } from '@/services/api';
import type { BranchDetail, BranchEventItem } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { compareBranches } from '@/services/api/g7';
import type { BranchComparison as ComparisonData } from '@/services/api/types/g7';
import { adoptBranchG8, branchExtras, saveBranchWithResources } from '@/services/api/g8';
import type { BranchG8Extras } from '@/services/api/decodersG8';
import type { ResourcesInput } from '@/services/api/types/g8';
import { decodeResponse } from '@/services/api/decode';
import { branchDetail } from '@/services/api/decoders';
import BranchComparison from './branches/BranchComparison';
import BranchResourcesPanel from './branches/BranchResourcesPanel';
import AdoptionDialog from './branches/AdoptionDialog';
import { emptyResources, fromExtras, validateResources } from './branches/resourcesModel';
import {
  SCENARIO_LABEL, STATE_LABEL, contentToPayload, describeConflict, describeOp, groupByDay, newItem,
} from './branches/branchModel';

const BranchDetailPage: React.FC = () => {
  const { planId, branchId } = useParams<{ planId: string; branchId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<BranchDetail | null>(null);
  const [items, setItems] = useState<BranchEventItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [extras, setExtras] = useState<BranchG8Extras | null>(null);
  const [resources, setResources] = useState<ResourcesInput>(emptyResources());
  const [resDirty, setResDirty] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const compare = async () => {
    if (!planId || !branchId) return;
    setBusy('比較');
    setError(null);
    try {
      setComparison(await compareBranches(planId, [branchId]));
    } catch (e) {
      setError(errorDetailMessage(e, '比較できませんでした'));
    } finally {
      setBusy(null);
    }
  };

  const apply = (d: BranchDetail) => {
    setDetail(d);
    setItems(d.content);
    setDirty(false);
    const x = branchExtras(d);
    setExtras(x);
    setResources(fromExtras(x.resources.segments, x.resources.reservations));
    setResDirty(false);
  };

  const load = useCallback(async () => {
    if (!planId || !branchId) return;
    try {
      apply(await getBranch(planId, branchId));
    } catch (e) {
      setError(errorDetailMessage(e, '分岐案の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const dayLabel = useMemo(() => {
    const map = new Map((detail?.days ?? []).map((d) => [d.id, d.local_date]));
    return (id: string) => map.get(id) ?? '不明な日';
  }, [detail]);

  const edit = (key: string, patch: Partial<BranchEventItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    setDirty(true);
  };

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      const detailObj = (e as { response?: { data?: { detail?: { conflicts?: unknown } } } })?.response?.data?.detail;
      setError(errorDetailMessage(e, `${label}に失敗しました`));
      if (detailObj && typeof detailObj === 'object' && 'conflicts' in detailObj) await load();
    } finally {
      setBusy(null);
    }
  };

  const hasResourceOps = resources.segments.length > 0 || resources.reservations.length > 0
    || (extras !== null && (extras.resources.segments.length > 0 || extras.resources.reservations.length > 0));

  const save = () => {
    if (!planId || !branchId || !detail) return;
    const r = contentToPayload(items);
    if (!r.ok) {
      setMessage(null);
      setError(r.error);
      return;
    }
    if (extras) {
      const v = validateResources(resources, items, {
        segments: extras.resources.base_segments, reservations: extras.resources.base_reservations });
      if (!v.ok) {
        setMessage(null);
        setError(v.error);
        return;
      }
    }
    void run('保存', async () => {
      if (resDirty || hasResourceOps) {
        const raw = await saveBranchWithResources(planId, branchId, r.data, resources, detail.revision);
        apply(decodeResponse(raw, branchDetail, 'PUT /plans/{plan_id}/branches/{branch_id}/content'));
      } else {
        apply(await updateBranchContent(planId, branchId, r.data, detail.revision));
      }
      setMessage('分岐案を保存しました');
    });
  };

  const adopt = () => {
    if (hasResourceOps) {
      setDialogOpen(true);
      return;
    }
    void run('採用', async () => {
      if (!planId || !branchId || !detail) return;
      if (!window.confirm('この案での変更を本案へ反映しますか?(本案の「元に戻す」で取り消せます)')) return;
      const res = await adoptBranch(planId, branchId, detail.revision);
      apply(res.branch);
      setMessage(`本案へ反映しました(本案の版 ${res.plan_revision})。プラン画面の「元に戻す」で取り消せます。`);
    });
  };

  const adoptSelected = (only: string[] | null) => run('採用', async () => {
    if (!planId || !branchId || !detail) return;
    const res = await adoptBranchG8(planId, branchId, detail.revision, only);
    apply(decodeResponse(res.raw, branchDetail, 'POST /plans/{plan_id}/branches/{branch_id}/adopt'));
    setDialogOpen(false);
    setMessage(`本案へ反映しました(本案の版 ${res.plan_revision})。`
      + (res.left_out.length ? `選ばなかった${res.left_out.length}件は当てていません。` : '')
      + (res.tasks_created ? `準備の一覧に「予約の取消の手続き」を${res.tasks_created}件入れました。` : '')
      + 'プラン画面の「元に戻す」で取り消せます。');
  });

  const setStatus = (status: 'draft' | 'discarded') => run(status === 'discarded' ? '見送り' : '再開', async () => {
    if (!planId || !branchId || !detail) return;
    apply(await updateBranch(planId, branchId, { status }, detail.revision));
  });

  const remove = () => run('削除', async () => {
    if (!planId || !branchId || !detail) return;
    if (!window.confirm(`案「${detail.title}」を削除しますか?(本案は変わりません)`)) return;
    await deleteBranch(planId, branchId, detail.revision);
    navigate(`/planner/${planId}/branches`);
  });

  if (isLoading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;
  if (!detail || !planId) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/branches`)}>← 案の一覧へ</Button>
      </div>
    );
  }

  const editable = detail.can_edit;
  const groups = groupByDay(detail, items);
  const anyDirty = dirty || resDirty;
  const canAdopt = editable && !anyDirty && detail.conflicts.length === 0 && (detail.ops.length > 0 || hasResourceOps);
  const canChoose = editable && !anyDirty && (detail.ops.length > 0 || hasResourceOps) && detail.status === 'draft';
  const baseTitles = new Map(detail.content.filter((i) => i.source_event_id).map((i) => [i.source_event_id as string, i.title]));

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/branches`)} className="mb-2">← 案の一覧へ</Button>
      <h1 className="text-2xl font-bold text-gray-900">{detail.title}</h1>
      <p className="text-sm text-gray-700 mt-1">
        想定: {SCENARIO_LABEL[detail.scenario_type]} ・ 状態: {STATE_LABEL[detail.state]} ・ 作成: {detail.created_by_name}
        {detail.assumptions.absent_member && ` ・ 欠席: ${detail.assumptions.absent_member}`}
        {detail.assumptions.budget_cut_percent && ` ・ 予算 ${detail.assumptions.budget_cut_percent}%減`}
      </p>
      {detail.assumptions.note && <p className="text-sm text-gray-800 mt-1">メモ: {detail.assumptions.note}</p>}

      <div aria-live="polite">
        {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}
      </div>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] mt-4">
        <div className="space-y-4">
          {groups.map(({ day, items: dayItems }) => (
            <Card key={day.id} padding="md">
              <section aria-labelledby={`branch-day-${day.id}`}>
                <h2 id={`branch-day-${day.id}`} className="font-semibold text-gray-900">{day.local_date}{day.title ? ` ${day.title}` : ''}</h2>
                {dayItems.length === 0 ? <p className="text-sm text-gray-700 mt-1">予定はありません。</p> : (
                  <ul className="mt-2 space-y-2">
                    {dayItems.map((it) => (
                      <li key={it.key} className={`border rounded-sm p-2 ${it.removed ? 'bg-gray-50' : ''}`} data-testid={`branch-item-${it.key}`}>
                        <div className="grid gap-2 sm:grid-cols-[6rem_1fr_9rem] items-end">
                          <div>
                            <label htmlFor={`time-${it.key}`} className="block text-xs text-gray-800">開始時刻</label>
                            <input id={`time-${it.key}`} type="time" className="w-full border rounded-sm px-2 py-1 text-sm"
                              value={it.local_start_time ?? ''} disabled={!editable || it.removed}
                              onChange={(e) => edit(it.key, { local_start_time: e.target.value || null })} />
                          </div>
                          <div>
                            <label htmlFor={`title-${it.key}`} className="block text-xs text-gray-800">予定名</label>
                            <input id={`title-${it.key}`} className={`w-full border rounded-sm px-2 py-1 text-sm ${it.removed ? 'line-through' : ''}`}
                              maxLength={200} value={it.title} disabled={!editable || it.removed}
                              onChange={(e) => edit(it.key, { title: e.target.value })} />
                          </div>
                          <div>
                            <label htmlFor={`day-${it.key}`} className="block text-xs text-gray-800">日付</label>
                            <select id={`day-${it.key}`} className="w-full border rounded-sm px-2 py-1 text-sm" value={it.day_id}
                              disabled={!editable || it.removed} onChange={(e) => edit(it.key, { day_id: e.target.value })}>
                              {detail.days.map((d) => <option key={d.id} value={d.id}>{d.local_date}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                          {it.locked && <span className="px-1.5 rounded-sm bg-gray-200 text-gray-900">確定済み</span>}
                          {it.source_event_id === null && <span className="px-1.5 rounded-sm bg-green-100 text-green-900">追加</span>}
                          {it.removed && <span className="px-1.5 rounded-sm bg-red-100 text-red-800">外す</span>}
                          {it.note && <span className="text-amber-900">{it.note}</span>}
                          {editable && it.source_event_id !== null && (
                            <Button variant="ghost" size="sm" onClick={() => edit(it.key, { removed: !it.removed })}>
                              {it.removed ? '戻す' : '外す'}
                            </Button>
                          )}
                          {editable && it.source_event_id === null && (
                            <Button variant="ghost" size="sm" onClick={() => { setItems((p) => p.filter((x) => x.key !== it.key)); setDirty(true); }}>
                              取り消す
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {editable && (
                  <Button variant="ghost" size="sm" className="mt-2" icon={<Plus size={14} />}
                    onClick={() => { setItems((p) => [...p, newItem(day.id, p.length + 1)]); setDirty(true); }}>
                    {day.local_date}に予定を追加
                  </Button>
                )}
              </section>
            </Card>
          ))}
          {extras && (detail.status === 'draft' || hasResourceOps) && (
            <BranchResourcesPanel resources={extras.resources} value={resources} items={items} baseTitles={baseTitles}
              editable={editable} onChange={(next) => { setResources(next); setResDirty(true); }} />
          )}
        </div>

        <div className="space-y-4">
          <Card padding="md">
            <section aria-labelledby="branch-diff">
              <h2 id="branch-diff" className="font-semibold text-gray-900">本案との違い</h2>
              {anyDirty && <p className="text-xs text-amber-900 mt-1" role="note">未保存の変更があります。保存すると違いを更新します。</p>}
              {extras && hasResourceOps && (
                <p className="text-sm text-gray-800 mt-1" data-testid="branch-resource-summary">
                  {`移動区間: 追加${extras.resource_summary.segments_added}・外す${extras.resource_summary.segments_removed}`
                    + `・変更${extras.resource_summary.segments_updated}`
                    + (extras.resources.reservations_hidden ? '' : ` / 予約: 付け替え${extras.resource_summary.reservations_relinked}`
                      + `・取り消す予定${extras.resource_summary.reservations_cancel_planned}`)}
                </p>
              )}
              <table className="w-full text-sm mt-2">
                <thead><tr className="text-left border-b"><th className="py-1">日付</th><th className="text-right">本案</th><th className="text-right">この案</th></tr></thead>
                <tbody>
                  {detail.day_counts.map((d) => (
                    <tr key={d.day_id} className="border-b"><td className="py-1">{d.local_date}</td><td className="text-right">{d.plan}件</td><td className="text-right">{d.branch}件</td></tr>
                  ))}
                </tbody>
              </table>
              {detail.ops.length === 0 ? <p className="text-sm text-gray-700 mt-2">本案からの変更はありません。</p> : (
                <ul className="text-sm mt-2 space-y-1 list-disc pl-5" aria-label="変更の一覧">
                  {detail.ops.map((o, i) => <li key={i}>{describeOp(o, dayLabel)}</li>)}
                </ul>
              )}
              <Button variant="secondary" size="sm" className="mt-3" onClick={compare} loading={busy === '比較'}
                disabled={anyDirty}>
                移動・検証・費用で比べる
              </Button>
              {anyDirty && <p className="text-xs text-gray-700 mt-1">比べる前に保存してください。</p>}
              {comparison && !anyDirty && <BranchComparison data={comparison} />}
            </section>
          </Card>
          {detail.state === 'draft' && detail.conflicts.length > 0 && (
            <Card padding="md">
              <section aria-labelledby="branch-conflicts">
                <h2 id="branch-conflicts" className="font-semibold text-red-800">採用できない理由</h2>
                <ul className="text-sm mt-2 space-y-1 list-disc pl-5" data-testid="branch-conflicts">
                  {detail.conflicts.map((c, i) => <li key={i}>{describeConflict(c)}</li>)}
                </ul>
                <p className="text-xs text-gray-700 mt-2">分岐案を本案に合わせて直してから保存すると、採用できるようになります。</p>
              </section>
            </Card>
          )}
          {detail.plan_changed_since_base && detail.state === 'draft' && (
            <p className="text-xs text-gray-700">この案を作った後に本案が更新されています(作成時の版 {detail.base_revision} → 現在 {detail.plan_revision})。</p>
          )}
          <div className="flex flex-wrap gap-2">
            {editable && <Button variant="outline" onClick={save} loading={busy === '保存'} disabled={!anyDirty}>保存</Button>}
            {editable && <Button variant="primary" onClick={adopt} loading={busy === '採用' && !dialogOpen} disabled={!canAdopt}>本案に採用</Button>}
            {canChoose && <Button variant="secondary" onClick={() => setDialogOpen(true)}>選んで採用…</Button>}
            {detail.status === 'draft' && editable && <Button variant="ghost" onClick={() => setStatus('discarded')}>見送り</Button>}
            {detail.status === 'discarded' && <Button variant="ghost" onClick={() => setStatus('draft')}>検討に戻す</Button>}
            {detail.status !== 'adopted' && <Button variant="ghost" onClick={remove}>削除</Button>}
          </div>
        </div>
      </div>
      {planId && branchId && dialogOpen && (
        <AdoptionDialog planId={planId} branchId={branchId} isOpen={dialogOpen} busy={busy === '採用'}
          onClose={() => setDialogOpen(false)} onAdopt={adoptSelected} />
      )}
    </div>
  );
};

export default BranchDetailPage;
