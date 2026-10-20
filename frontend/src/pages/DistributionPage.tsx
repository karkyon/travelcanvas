/**
 * DistributionPage - 配布された旅程(/organizations/:orgId/distributions/:distId。FR-041)。
 *
 * [Gate B1]
 * - メンバー: 写しを見る、最新版を確認する(版を指定。改訂されていたら 409 で読み直し)、自分の旅行として複製する
 * - 管理者: 確認の状況(誰がどの版を確認したか)、元の旅行から改訂(変わった件数を示す)、配布をやめる
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import SharedPlanView from '@/components/share/SharedPlanView';
import api from '@/services/api';
import type { DistributionAckList, Organization, OrgDistribution } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { fmtDateTime, isOrgAdmin, myAckLabel, ROLE_LABEL, snapshotToSharedPlan } from '@/utils/organizations';

const btn = 'px-4 py-2 rounded-lg disabled:opacity-50';

const DistributionPage: React.FC = () => {
  const { orgId, distId } = useParams<{ orgId: string; distId: string }>();
  const navigate = useNavigate();
  const [org, setOrg] = useState<Organization | null>(null);
  const [dist, setDist] = useState<OrgDistribution | null>(null);
  const [acks, setAcks] = useState<DistributionAckList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!orgId || !distId) return;
    try {
      const o = await api.getOrganization(orgId);
      setOrg(o);
      setDist(await api.getDistribution(orgId, distId));
      if (isOrgAdmin(o.role)) setAcks(await api.getDistributionAcks(orgId, distId));
    } catch (e) {
      setError(errorDetailMessage(e, '配布を取得できませんでした'));
    } finally {
      setLoading(false);
    }
  }, [orgId, distId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<string | null>, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  if (!org || !dist || !orgId || !distId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p role="alert" className="text-red-800">{error ?? '配布が見つかりません'}</p>
        <Link to={orgId ? `/organizations/${orgId}` : '/organizations'} className="text-blue-800 underline">組織へ戻る</Link>
      </div>
    );
  }

  const plan = snapshotToSharedPlan(dist);
  const admin = isOrgAdmin(org.role);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="h-2" style={{ backgroundColor: org.brand_color ?? '#9ca3af' }} aria-hidden="true" />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link to={`/organizations/${orgId}`} className="text-blue-800 hover:underline">← {org.name}</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">配布: {dist.title}</h1>
        <p className="text-gray-700">
          版{dist.version}・{fmtDateTime(dist.published_at)}に配布{dist.revoked_at ? '・配布をやめました' : ''}
        </p>
        {dist.change_note && <p className="text-gray-800 mt-1">説明: {dist.change_note}</p>}
        {error && <p role="alert" className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200">{error}</p>}
        {notice && <p role="status" className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 border border-green-200">{notice}</p>}

        {!dist.revoked_at && (
          <section className="mt-4 bg-white rounded-xl shadow-sm p-4" aria-label="確認と複製">
            <p className="text-gray-900 mb-3">あなたの確認: {myAckLabel(dist)}</p>
            <div className="flex flex-wrap gap-2">
              {!dist.acknowledged && (
                <button type="button" disabled={busy} className={`${btn} bg-green-700 text-white hover:bg-green-800`}
                  onClick={() => run(async () => {
                    await api.acknowledgeDistribution(orgId, distId, dist.version);
                    return `版${dist.version}を確認しました`;
                  }, '確認を記録できませんでした')}>
                  版{dist.version}を確認しました
                </button>
              )}
              <button type="button" disabled={busy} className={`${btn} border border-blue-300 text-blue-800 hover:bg-blue-50`}
                onClick={() => run(async () => {
                  const r = await api.forkDistribution(orgId, distId);
                  navigate(`/planner/${r.plan_id}`);
                  return null;
                }, '複製できませんでした')}>
                自分の旅行として複製
              </button>
            </div>
            <p className="text-xs text-gray-700 mt-2">複製した旅行はあなたのものです。後で配布が改訂されても変わりません。組織の管理者からは見えません。</p>
          </section>
        )}

        {plan && (
          <div className="mt-6">
            <SharedPlanView plan={plan} titleLevel={2} />
          </div>
        )}

        {admin && acks && (
          <section className="mt-8 bg-white rounded-xl shadow-sm p-6" aria-labelledby="acks-heading">
            <h2 id="acks-heading" className="text-lg font-semibold text-gray-900 mb-2">確認の状況</h2>
            <p className="text-gray-800 mb-3">最新版(版{acks.version})を確認 {acks.acknowledged_latest}人・未確認 {acks.pending}人</p>
            <ul className="space-y-1 mb-6">
              {acks.members.map((m) => (
                <li key={m.member_id} className="text-sm text-gray-800">
                  {m.username ?? '(退会済み)'}({ROLE_LABEL[m.role]}):
                  {m.acked_version === acks.version ? '確認済み' : m.acked_version != null ? `版${m.acked_version}まで確認` : '未確認'}
                  {m.acked_at ? `・${fmtDateTime(m.acked_at)}` : ''}
                </li>
              ))}
            </ul>
            {!dist.revoked_at && (
              <>
                <h3 className="font-semibold text-gray-900 mb-2">元の旅行から改訂する</h3>
                <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const r = await api.reviseDistribution(orgId, distId, { base_version: dist.version, change_note: note || undefined });
                    setNote('');
                    const c = r.changes;
                    return `版${r.version}にしました${c ? `(予定の追加 ${c.events_added}・削除 ${c.events_removed}・変更 ${c.events_changed})` : ''}`;
                  }, '改訂できませんでした');
                }}>
                  <div className="flex-1 min-w-[200px]">
                    <label htmlFor="revise-note" className="block text-sm font-medium text-gray-800 mb-1">改訂の説明</label>
                    <input id="revise-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                  </div>
                  <button type="submit" disabled={busy} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>改訂する</button>
                </form>
                <button type="button" disabled={busy} className={`${btn} mt-4 border border-red-300 text-red-800 hover:bg-red-50`}
                  onClick={() => {
                    if (!window.confirm('この配布をやめますか?メンバーから見えなくなります。')) return;
                    run(async () => {
                      await api.revokeDistribution(orgId, distId);
                      return '配布をやめました';
                    }, '配布をやめられませんでした');
                  }}>
                  配布をやめる
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default DistributionPage;
