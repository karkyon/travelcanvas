/**
 * SyncConflictsPage - 同期で競合した変更の確認と解決(SC-06「競合」、DOC-04 §6 Conflict: 比較・保持対象、FR-033)。
 *
 * [Gate P11] backend/app/api/v1/sync.py の画面。オフラインで行った変更が、他の人やほかの端末の変更と重なったものを、
 * 項目ごとに「自分の変更」と「サーバーの今の内容」で比べ、どちらを残すかを選ぶ。
 * 「自分の変更を使う」は本案の版(If-Match)を送り、変更セットとして記録する(「元に戻す」で取り消せる)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getSyncConflicts, resolveSyncConflict } from '@/services/api';
import type { SyncConflict, SyncConflictList } from '@/services/api';
import { usePlanStore } from '@/store/planStore';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { conflictRows, conflictSubject, conflictSummary } from './sync/syncModel';

const SyncConflictsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SyncConflictList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const res = await getSyncConflicts(planId);
      setData(res);
      usePlanStore.getState().setSyncConflictCount(planId, res.conflicts.length);
    } catch (e) {
      setError(errorDetailMessage(e, '競合の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (c: SyncConflict, resolution: 'keep_server' | 'use_mine') => {
    if (!planId || !data) return;
    setBusy(c.operation_id);
    setError(null);
    setMessage(null);
    try {
      await resolveSyncConflict(planId, c.operation_id, resolution, resolution === 'use_mine' ? data.plan_revision : undefined);
      setMessage(resolution === 'use_mine' ? '自分の変更を反映しました(プランの「元に戻す」で取り消せます)' : 'サーバーの内容を残しました');
    } catch (e) {
      setError(errorDetailMessage(e, '競合を解決できませんでした。もう一度お試しください'));
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (!planId) return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-gray-900">同期で競合した変更</h1>
      <p className="text-sm text-gray-700 mt-1">
        通信できない間に行った変更のうち、他の人やほかの端末の変更と重なったものです。どちらの内容を残すか選んでください。
      </p>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}
      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : !data || data.conflicts.length === 0 ? (
        <Card padding="lg" className="mt-6 text-center text-gray-700">競合している変更はありません。</Card>
      ) : (
        <ul className="mt-6 space-y-3" aria-label="競合している変更">
          {data.conflicts.map((c) => (
            <li key={c.operation_id}>
              <Card padding="md" className="space-y-3">
                <section aria-label={`競合: ${c.title ?? conflictSubject(c)}`}>
                  <h2 className="font-semibold text-gray-900">{c.title ?? conflictSubject(c)}</h2>
                  <p className="text-sm text-gray-800">{conflictSummary(c)}</p>
                  {conflictRows(c).length > 0 && (
                    <table className="w-full text-sm mt-2">
                      <caption className="sr-only">{`${c.title ?? conflictSubject(c)}の比較`}</caption>
                      <thead>
                        <tr className="text-left text-gray-700">
                          <th scope="col" className="font-medium">項目</th>
                          <th scope="col" className="font-medium">自分の変更</th>
                          <th scope="col" className="font-medium">サーバーの今の内容</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conflictRows(c).map((r) => (
                          <tr key={r.field}>
                            <th scope="row" className="font-normal text-gray-800">{r.label}</th>
                            <td className="text-gray-900">{r.mine}</td>
                            <td className="text-gray-900">{r.server}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button variant="outline" size="sm" disabled={busy === c.operation_id} onClick={() => resolve(c, 'keep_server')}>
                      サーバーの内容を残す
                    </Button>
                    {!(c.action === 'update' && c.server_deleted) && (
                      <Button variant="primary" size="sm" disabled={busy === c.operation_id} onClick={() => resolve(c, 'use_mine')}>
                        {c.action === 'delete' ? '削除する(自分の変更を使う)' : '自分の変更を使う'}
                      </Button>
                    )}
                  </div>
                </section>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SyncConflictsPage;
