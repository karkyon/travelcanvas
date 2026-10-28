/**
 * [Gate A2] FR-040 監査ログ(SC-32)。backend GET /admin/audit-logs(管理者・多要素認証の確認済みだけ)。
 *
 * - 種類・対象の種類・対象の ID・期間で絞り込み、新しい順にページで見る
 * - 接続元は backend が末尾を伏せて返す(例: 203.0.113.x)。監査の詳細には秘密・本文を入れていない
 *   (各機能が件数・ID だけを残す)。この画面を見たことも監査に残る(admin_audit_logs_viewed)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { getAuditLogs } from '@/services/api';
import { apiErrorMessage } from '@/utils/apiError';
import type { AuditLogPage, AuditLogQuery } from '@/services/api';

const PAGE_SIZE = 25;
const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2';

function detailsText(details: Record<string, unknown> | null): string {
  if (!details || Object.keys(details).length === 0) return '—';
  return Object.entries(details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' / ');
}

function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const AdminAuditLogs: React.FC = () => {
  const [query, setQuery] = useState<AuditLogQuery>({ page: 1, page_size: PAGE_SIZE });
  const [draft, setDraft] = useState({ action: '', resource_type: '', resource_id: '', since: '', until: '' });
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: AuditLogQuery) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAuditLogs(q));
    } catch (e) {
      setError(apiErrorMessage(e, '監査ログを読み込めませんでした'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery({
      page: 1, page_size: PAGE_SIZE,
      action: draft.action || undefined, resource_type: draft.resource_type.trim() || undefined,
      resource_id: draft.resource_id.trim() || undefined,
      since: localInputToIso(draft.since), until: localInputToIso(draft.until),
    });
  };

  const page = data?.pagination;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink-900">監査ログ</h1>
          <p className="text-ink-700 mt-1">
            ログイン・権限・機密の表示・管理者の操作などの記録です。接続元は末尾を伏せています。
            この画面を見たことも記録されます。
          </p>
        </div>
        <Link to="/admin" className="text-blue-700 underline">管理者ダッシュボードへ</Link>
      </div>

      <Card className="p-4">
        <form onSubmit={apply} className="grid gap-3 md:grid-cols-5" aria-label="監査ログの絞り込み">
          <div>
            <label htmlFor="audit-action" className="block text-sm font-medium text-ink-700 mb-1">種類</label>
            <select id="audit-action" className={inputClass} value={draft.action}
              onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}>
              <option value="">すべて</option>
              {(data?.actions ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="audit-resource-type" className="block text-sm font-medium text-ink-700 mb-1">対象の種類</label>
            <input id="audit-resource-type" className={inputClass} value={draft.resource_type} placeholder="例: user"
              onChange={(e) => setDraft((d) => ({ ...d, resource_type: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="audit-resource-id" className="block text-sm font-medium text-ink-700 mb-1">対象の ID</label>
            <input id="audit-resource-id" className={inputClass} value={draft.resource_id}
              onChange={(e) => setDraft((d) => ({ ...d, resource_id: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="audit-since" className="block text-sm font-medium text-ink-700 mb-1">この時刻から</label>
            <input id="audit-since" type="datetime-local" className={inputClass} value={draft.since}
              onChange={(e) => setDraft((d) => ({ ...d, since: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="audit-until" className="block text-sm font-medium text-ink-700 mb-1">この時刻まで</label>
            <input id="audit-until" type="datetime-local" className={inputClass} value={draft.until}
              onChange={(e) => setDraft((d) => ({ ...d, until: e.target.value }))} />
          </div>
          <div className="md:col-span-5">
            <Button type="submit" variant="primary">絞り込む</Button>
          </div>
        </form>
      </Card>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <Card className="overflow-hidden">
        {loading && !data ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="監査ログの一覧">
              <thead className="bg-gray-50 text-left text-ink-700">
                <tr>
                  <th scope="col" className="px-4 py-2">日時</th>
                  <th scope="col" className="px-4 py-2">種類</th>
                  <th scope="col" className="px-4 py-2">操作した人</th>
                  <th scope="col" className="px-4 py-2">対象</th>
                  <th scope="col" className="px-4 py-2">接続元</th>
                  <th scope="col" className="px-4 py-2">詳細</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {(data?.audit_logs ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-700">該当する記録はありません</td></tr>
                ) : data?.audit_logs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2 whitespace-nowrap">{log.created_at ? new Date(log.created_at).toLocaleString('ja-JP') : '—'}</td>
                    <td className="px-4 py-2 font-mono">{log.action}</td>
                    <td className="px-4 py-2 font-mono text-xs">{log.user_id ?? '(運用・システム)'}</td>
                    <td className="px-4 py-2 text-xs">{log.resource_type ?? '—'} {log.resource_id ? <span className="font-mono">{log.resource_id}</span> : null}</td>
                    <td className="px-4 py-2 font-mono text-xs">{log.ip_address ?? '—'}</td>
                    <td className="px-4 py-2 text-xs break-all">{detailsText(log.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {page && page.total_pages > 1 && (
        <nav aria-label="監査ログのページ" className="flex items-center justify-between">
          <span className="text-sm text-ink-700">{page.total_count}件中 {page.page}/{page.total_pages}ページ</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!page.has_prev}
              onClick={() => setQuery((q) => ({ ...q, page: (q.page ?? 1) - 1 }))}>前へ</Button>
            <Button size="sm" variant="outline" disabled={!page.has_next}
              onClick={() => setQuery((q) => ({ ...q, page: (q.page ?? 1) + 1 }))}>次へ</Button>
          </div>
        </nav>
      )}
    </div>
  );
};

export default AdminAuditLogs;
