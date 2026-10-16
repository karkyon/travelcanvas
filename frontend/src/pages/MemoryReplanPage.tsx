/**
 * MemoryReplanPage - 過去の旅からの提案(FR-057 Memory Replan、DOC-15 CA-015)。
 *
 * [Gate P17] backend/app/api/v1/memory_replan.py の画面。
 * - 参加しているほかの旅行の予定と実績から見つけた傾向を、根拠(件数・旅行・例)つきで示す
 * - 提案(滞在が長くなりがちな種類の予定の後ろをずらす)は、変わる予定と動かさない予定を見せ、確認してから適用する
 * - 適用は1つの変更として記録し、プランの「元に戻す」で取り消せる。AIは使わない
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { applyMemoryReplan, getMemoryReplan } from '@/services/api';
import type { MemoryReplanProposal, MemoryReplanResult } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { eventTypeLabel } from './booklet/bookletModel';
import { KEPT_REASON, basisText, insightText } from './memoryReplan/memoryReplanModel';

const MemoryReplanPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<MemoryReplanResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      setData(await getMemoryReplan(planId));
    } catch (e) {
      setError(errorDetailMessage(e, '提案の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!planId) return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;

  const apply = async (p: MemoryReplanProposal) => {
    if (!data) return;
    const ok = window.confirm(`予定${p.changes.length}件の開始時刻を${p.minutes}分後ろへずらします。プランの「元に戻す」で取り消せます。よろしいですか?`);
    if (!ok) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await applyMemoryReplan(planId, p.id, data.input_fingerprint, data.plan_revision);
      setMessage(`予定${r.applied}件の時刻をずらしました(プランの「元に戻す」で取り消せます)`);
    } catch (e) {
      setError(errorDetailMessage(e, '提案を適用できませんでした。読み込み直してください'));
    } finally {
      setBusy(false);
      await load();
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-gray-900">過去の旅からの提案</h1>
      <p className="text-sm text-gray-700 mt-1">
        あなたが参加したほかの旅行の「振り返り」(行った・着いた・出た時刻)から傾向を見つけます。提案は適用するまで旅程を変えません。
      </p>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}
      {isLoading || !data ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          <section aria-label="見つかった傾向" className="mt-6">
            <h2 className="font-semibold text-gray-900">見つかった傾向</h2>
            {data.insights.length === 0 ? (
              <Card padding="lg" className="mt-2 text-center text-gray-700">
                {data.sample_count === 0
                  ? 'まだ材料がありません。ほかの旅行の「振り返り」で、行った予定と着いた・出た時刻を記録すると提案できます。'
                  : `記録${data.sample_count}件からは、はっきりした傾向は見つかりませんでした。`}
              </Card>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.insights.map((i) => (
                  <li key={`${i.kind}-${i.event_type ?? ''}`}>
                    <Card padding="md">
                      <p className="text-gray-900">{insightText(i)}</p>
                      <p className="text-sm text-gray-700 mt-1">{basisText(i)}</p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.proposals.length > 0 && (
            <section aria-label="この旅行への提案" className="mt-6">
              <h2 className="font-semibold text-gray-900">この旅行への提案</h2>
              <ul className="mt-2 space-y-2">
                {data.proposals.map((p) => (
                  <li key={p.id}>
                    <Card padding="md" className="space-y-2">
                      <p className="text-gray-900">{`「${eventTypeLabel(p.event_type)}」の予定の後ろを${p.minutes}分ずらす`}</p>
                      <table className="w-full text-sm">
                        <caption className="sr-only">変わる予定</caption>
                        <thead>
                          <tr className="text-left text-gray-700">
                            <th scope="col" className="font-medium">予定</th>
                            <th scope="col" className="font-medium">今</th>
                            <th scope="col" className="font-medium">提案</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.changes.map((c) => (
                            <tr key={c.event_id}>
                              <th scope="row" className="font-normal text-gray-900">{c.title}</th>
                              <td className="text-gray-900">{c.from}</td>
                              <td className="text-gray-900">{c.to}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {p.kept.length > 0 && (
                        <ul className="text-sm text-gray-800" aria-label="動かさない予定">
                          {p.kept.map((k) => <li key={k.event_id}>{`${k.title}: ${KEPT_REASON[k.reason]}`}</li>)}
                        </ul>
                      )}
                      {data.can_apply && (
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => apply(p)}>この提案を適用</Button>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default MemoryReplanPage;
