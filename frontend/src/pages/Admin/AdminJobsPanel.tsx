/**
 * [Gate G8] FR-004・O02 定期の処理が続いて動いているか(管理者だけ。GET /admin/ops/jobs)。
 *
 * 処理ごとに、最後の成功からの経過・続けての失敗・状態(正常 / 遅れ / 失敗が続いている / 記録なし)を出す。
 * 「記録なし」は定期実行を登録していない環境(Runbook §2.1 の tcops.py schedule install で登録する)。
 */
import React, { useEffect, useState } from 'react';
import Card from '@/components/common/Card';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { getOpsJobs } from '@/services/api/g8';
import type { JobState, OpsJobs } from '@/services/api/types/g8';

const STATE: Record<JobState, { label: string; cls: string }> = {
  ok: { label: '正常', cls: 'text-green-800' },
  overdue: { label: '遅れ', cls: 'text-red-800' },
  failing: { label: '失敗が続いている', cls: 'text-red-800' },
  never: { label: '記録なし', cls: 'text-ink-700' },
};

const interval = (m: number) => (m >= 1440 ? `${Math.round(m / 1440)}日ごと` : m >= 60 ? `${Math.round(m / 60)}時間ごと` : `${m}分ごと`);

const AdminJobsPanel: React.FC = () => {
  const [data, setData] = useState<OpsJobs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOpsJobs().then(setData).catch((e) => setError(errorDetailMessage(e, '定期の処理の状態を取得できませんでした')));
  }, []);

  return (
    <Card padding="md" className="mt-6">
      <section aria-labelledby="ops-jobs-heading">
        <h2 id="ops-jobs-heading" className="text-xl font-semibold text-ink-900">定期の処理</h2>
        <p className="text-sm text-ink-700 mt-1">
          削除の期限・送信の再送などの処理が続いて動いているかを、最後の成功からの経過で確かめます(中身は件数だけ)。
        </p>
        {error && <p className="text-sm text-red-800 mt-2" role="alert">{error}</p>}
        {data && data.attention.length > 0 && (
          <p className="text-sm text-red-800 mt-2" role="alert">{`確認が要る処理: ${data.attention.join('・')}`}</p>
        )}
        {data && (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm" aria-label="定期の処理の状態">
              <thead>
                <tr className="text-left text-ink-700">
                  <th scope="col" className="font-medium">処理</th>
                  <th scope="col" className="font-medium">間隔</th>
                  <th scope="col" className="font-medium">状態</th>
                  <th scope="col" className="font-medium">最後の成功</th>
                  <th scope="col" className="font-medium">続けての失敗</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.job} className="border-t border-gray-100">
                    <th scope="row" className="font-normal text-ink-900">{j.job}</th>
                    <td>{interval(j.expected_minutes)}</td>
                    <td className={STATE[j.state].cls}>{STATE[j.state].label}</td>
                    <td>{j.last_success_at ? `${new Date(j.last_success_at).toLocaleString('ja-JP')}(${j.minutes_since_success}分前)` : '—'}</td>
                    <td>{j.consecutive_failures ? `${j.consecutive_failures}回${j.last_error ? `(${j.last_error})` : ''}` : '0回'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Card>
  );
};

export default AdminJobsPanel;
