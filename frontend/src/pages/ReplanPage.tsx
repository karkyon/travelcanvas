/**
 * ReplanPage - 再計画案A/Bの比較と承認(SC-24 / FR-031)。
 *
 * [Gate P10] backend/app/api/v1/replans.py の画面。案ごとに、変わる予定(前→後)・外す予定・守る予定(確定・予約付き)・
 * 最大の遅れ・日の終わりの変化・外す予定に支払い済みの費用・通知するメンバーを並べて示す。
 * 承認(適用)するまで旅程は変わらない。案を作った後に旅程が変わっていれば適用せず、作り直しを案内する。
 * 適用はプランの「元に戻す」で取り消せる。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { applyReplan, createReplan, getAlerts, getReplan, rejectReplan } from '@/services/api';
import type { PlanAlert, Replan, ReplanCandidate } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  CONFIDENCE_LABEL, REPLAN_STATE_LABEL, SOURCE_LABEL, confirmText, describeChange, formatCost, formatMinutes,
  formatObserved, replanErrorInfo, sameOutcome,
} from './replan/replanModel';

const CandidateCard: React.FC<{
  c: ReplanCandidate;
  canApply: boolean;
  applying: boolean;
  applied: boolean;
  onApply: (c: ReplanCandidate) => void;
}> = ({ c, canApply, applying, applied, onApply }) => (
  <Card padding="md" className={`space-y-3 ${applied ? 'ring-2 ring-green-600' : ''}`}>
    <section aria-label={`案${c.id}`}>
      <h2 className="text-lg font-bold text-gray-900">
        {`案${c.id}: ${c.label}`}
        {applied && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-900">適用した案</span>}
      </h2>
      <p className="text-sm text-gray-700 mt-1">{c.description}</p>
      {!c.available ? (
        <p className="mt-3 text-sm text-gray-800">{`この案は使えません: ${c.unavailable_reason ?? ''}`}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
            <div><dt className="text-gray-700">変わる予定</dt><dd className="font-semibold text-gray-900">{`${c.metrics.changed_count}件`}</dd></div>
            <div><dt className="text-gray-700">外す予定</dt><dd className="font-semibold text-gray-900">{`${c.metrics.lost_count}件`}</dd></div>
            <div><dt className="text-gray-700">最大の遅れ</dt><dd className="font-semibold text-gray-900">{formatMinutes(c.metrics.max_delay_minutes)}</dd></div>
            <div><dt className="text-gray-700">その日の最後の予定</dt><dd className="font-semibold text-gray-900">{formatMinutes(c.metrics.day_end_shift_minutes)}</dd></div>
          </dl>
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-gray-900">変わる予定</h3>
            {c.changes.length === 0 ? <p className="text-sm text-gray-700">ありません</p> : (
              <ul className="text-sm text-gray-900 list-disc pl-5">{c.changes.map((x) => <li key={x.event_id}>{describeChange(x)}</li>)}</ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">外す予定(失う予定)</h3>
            {c.lost.length === 0 ? <p className="text-sm text-gray-700">ありません</p> : (
              <ul className="text-sm text-red-800 list-disc pl-5">{c.lost.map((x) => <li key={x.event_id}>{x.title}</li>)}</ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              <ShieldCheck size={14} aria-hidden="true" className="inline mr-1 text-green-700" />守る予定(時刻を変えません)
            </h3>
            {c.protected.length === 0 ? <p className="text-sm text-gray-700">ありません</p> : (
              <ul className="text-sm text-gray-900 list-disc pl-5">
                {c.protected.map((x) => (
                  <li key={x.event_id}>{`${x.local_start_time ?? '時刻未定'} ${x.title}${x.has_reservation ? '(予約あり)' : '(確定済み)'}`}</li>
                ))}
              </ul>
            )}
          </div>
          {c.warnings.length > 0 && (
            <ul className="text-sm text-amber-900 bg-amber-50 rounded p-2 list-disc pl-6" aria-label={`案${c.id}の注意`}>
              {c.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <p className="text-sm text-gray-800">{`費用: ${formatCost(c.cost_impact)}`}</p>
          <p className="text-sm text-gray-800">
            {c.notify_member_names.length > 0 ? `通知する人: ${c.notify_member_names.join('、')}` : '通知する人: いません(自分だけの旅行)'}
          </p>
          {canApply && (
            <Button variant="primary" loading={applying} icon={<CheckCircle2 size={16} />} onClick={() => onApply(c)}>
              {`案${c.id}で旅程を変更する`}
            </Button>
          )}
        </>
      )}
    </section>
  </Card>
);

const ReplanPage: React.FC = () => {
  const { planId, replanId } = useParams<{ planId: string; replanId: string }>();
  const navigate = useNavigate();
  const [replan, setReplan] = useState<Replan | null>(null);
  const [alert, setAlert] = useState<PlanAlert | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; items: string[]; stale: boolean } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId || !replanId) return;
    try {
      const [r, alerts] = await Promise.all([getReplan(planId, replanId), getAlerts(planId)]);
      setReplan(r);
      setAlert(alerts.alerts.find((a) => a.id === r.alert_id) ?? null);
    } catch (e) {
      setError({ message: errorDetailMessage(e, '再計画案の取得に失敗しました'), items: [], stale: false });
    } finally {
      setIsLoading(false);
    }
  }, [planId, replanId]);

  useEffect(() => {
    setIsLoading(true);
    setDone(null);
    setError(null);
    load();
  }, [load]);

  const apply = async (c: ReplanCandidate) => {
    if (!planId || !replan) return;
    if (!window.confirm(confirmText(c))) return;
    setApplying(c.id);
    setError(null);
    try {
      const res = await applyReplan(planId, replan.id, c.id, replan.plan_revision);
      setReplan(res.replan);
      setDone(`案${c.id}で旅程を変更しました。取り消す場合はプラン画面の「元に戻す」を使ってください`);
    } catch (err) {
      const info = replanErrorInfo(err);
      setError({ message: info.message, items: info.items, stale: info.code === 'replan_stale' || info.code === 'replan_conflict' });
      await load();
    } finally {
      setApplying(null);
    }
  };

  const remake = async () => {
    if (!planId || !replan) return;
    setError(null);
    try {
      const created = await createReplan(planId, replan.alert_id);
      navigate(`/planner/${planId}/replans/${created.id}`);
    } catch (err) {
      setError({ ...replanErrorInfo(err), stale: false });
    }
  };

  const reject = async () => {
    if (!planId || !replan) return;
    try {
      setReplan(await rejectReplan(planId, replan.id, replan.revision));
    } catch (err) {
      setError({ ...replanErrorInfo(err), stale: false });
    }
  };

  if (!planId || !replanId) return <div className="p-8 text-center text-gray-700">再計画案が選択されていません。</div>;
  const [a, b] = replan?.candidates ?? [];
  const canApply = !!replan?.can_apply && !done;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex flex-wrap gap-2 mb-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/alerts`)}>← 状況の一覧へ</Button>
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)}>プランを見る</Button>
      </div>
      <h1 className="text-2xl font-bold text-gray-900">再計画案の比較</h1>
      {alert && (
        <p className="text-sm text-gray-800 mt-1">
          {`${alert.kind_label}: ${alert.event_title ?? `${alert.local_date ?? ''} の屋外の予定`}`}
          {alert.delay_minutes !== null && `(約${alert.delay_minutes}分の遅れ)`}
          {` ・ ${alert.source_label ?? SOURCE_LABEL[alert.source]} ・ ${formatObserved(alert.observed_at)} ・ ${CONFIDENCE_LABEL[alert.confidence]}`}
        </p>
      )}
      {alert?.is_stale && (
        <p className="text-sm text-red-800 mt-1">状況の情報は取得から3時間以上たっています。最新の状況を確認してから判断してください</p>
      )}
      <p className="text-sm text-gray-700 mt-1">承認するまで旅程は変わりません。予約付き・確定済みの予定はどちらの案でも動かしません。</p>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">
          <p>{error.message}</p>
          {error.items.length > 0 && <ul className="list-disc pl-5 mt-1">{error.items.map((i) => <li key={i}>{i}</li>)}</ul>}
        </div>
      )}
      {done && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{done}</div>}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : !replan ? null : (
        <>
          <p className="mt-4 text-sm text-gray-800">
            {`状態: ${REPLAN_STATE_LABEL[replan.state]} ・ 作成: ${replan.created_by_name}`}
            {replan.applied_by_name && ` ・ 適用: ${replan.applied_by_name}`}
          </p>
          {replan.is_stale && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 text-amber-900 text-sm flex flex-wrap items-center justify-between gap-2">
              <span>この案を作った後に旅程が変わったため、この案は適用できません。今の旅程で作り直してください。</span>
              {alert?.status === 'active' && <Button variant="outline" size="sm" onClick={remake}>案を作り直す</Button>}
            </div>
          )}
          {a && b && sameOutcome(a, b) && (
            <p className="mt-3 text-sm text-gray-800">この状況では、案Aと案Bの結果は同じです。</p>
          )}
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            {replan.candidates.map((c) => (
              <CandidateCard key={c.id} c={c} canApply={canApply} applying={applying === c.id}
                applied={replan.applied_candidate === c.id} onApply={apply} />
            ))}
          </div>
          {replan.status === 'proposed' && replan.can_apply && !done && (
            <div className="mt-4">
              <Button variant="ghost" onClick={reject}>どちらも採用しない</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ReplanPage;
