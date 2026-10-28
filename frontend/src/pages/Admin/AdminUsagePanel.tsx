/**
 * [Gate G5] BILL-02 管理者: 利用者・組織の今月の使用量を確かめ、上限を理由つきで上書きする(監査に残る)。
 * 上書きは今月だけ。空欄で保存すると既定の上限に戻す。
 */
import React, { useState } from 'react';
import Card from '../../components/common/Card';
import { adminGetUsage, adminOverrideUsage } from '@/services/api/g5';
import type { UsageMetric, UsageSummary } from '@/services/api/types/g5';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import UsageList from '../settings/UsageList';

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg';
const btn = 'px-3 py-2 rounded-lg text-sm disabled:opacity-50';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AdminUsagePanel: React.FC = () => {
  const [subject, setSubject] = useState<{ type: 'user' | 'org'; id: string }>({ type: 'user', id: '' });
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [form, setForm] = useState<{ metric: UsageMetric | ''; limit: string; reason: string }>({ metric: '', limit: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<UsageSummary>, ok: string | null, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setUsage(await fn());
      if (ok) setNotice(ok);
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const limitValue = form.limit.trim() === '' ? null : Number(form.limit);
  const limitValid = limitValue === null || (Number.isInteger(limitValue) && limitValue >= 0);
  const canOverride = !!usage && !!form.metric && limitValid && (limitValue === null || !!form.reason.trim());

  return (
    <Card className="p-6">
      <section aria-labelledby="admin-usage-heading">
        <h3 id="admin-usage-heading" className="text-lg font-semibold text-ink-900 mb-4">使用量と上限</h3>
        {error && <p role="alert" className="mb-3 p-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</p>}
        {notice && <p role="status" className="mb-3 p-3 rounded-lg bg-green-50 text-green-900 text-sm">{notice}</p>}
        <form className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end mb-4" onSubmit={(e) => {
          e.preventDefault();
          void run(() => adminGetUsage(subject.type, subject.id.trim()), null, '使用量を取得できませんでした');
        }}>
          <div>
            <label htmlFor="usage-subject-type" className="block text-sm font-medium text-ink-900 mb-1">対象</label>
            <select id="usage-subject-type" className={inputClass} value={subject.type}
              onChange={(e) => setSubject({ ...subject, type: e.target.value as 'user' | 'org' })}>
              <option value="user">利用者</option>
              <option value="org">組織</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="usage-subject-id" className="block text-sm font-medium text-ink-900 mb-1">ID</label>
            <input id="usage-subject-id" className={inputClass} value={subject.id}
              onChange={(e) => setSubject({ ...subject, id: e.target.value })} />
          </div>
          <button type="submit" disabled={busy || !UUID.test(subject.id.trim())} className={`${btn} bg-blue-700 text-white`}>
            使用量を見る
          </button>
        </form>
        {usage && (
          <>
            <UsageList usage={usage} />
            <form className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end mt-4" onSubmit={(e) => {
              e.preventDefault();
              if (!canOverride || !form.metric) return;
              void run(() => adminOverrideUsage({
                subject_type: usage.subject_type, subject_id: usage.subject_id, metric: form.metric as UsageMetric,
                limit: limitValue, ...(limitValue !== null ? { reason: form.reason.trim() } : {}),
              }), limitValue === null ? '既定の上限に戻しました' : '今月の上限を上書きしました', '上限を変えられませんでした');
            }}>
              <div>
                <label htmlFor="usage-metric" className="block text-sm font-medium text-ink-900 mb-1">指標</label>
                <select id="usage-metric" className={inputClass} value={form.metric}
                  onChange={(e) => setForm({ ...form, metric: e.target.value as UsageMetric })}>
                  <option value="">選ぶ</option>
                  {usage.metrics.map((m) => <option key={m.metric} value={m.metric}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="usage-limit" className="block text-sm font-medium text-ink-900 mb-1">今月の上限(空欄は既定)</label>
                <input id="usage-limit" inputMode="numeric" className={inputClass} value={form.limit}
                  onChange={(e) => setForm({ ...form, limit: e.target.value })} />
              </div>
              <div>
                <label htmlFor="usage-reason" className="block text-sm font-medium text-ink-900 mb-1">理由</label>
                <input id="usage-reason" className={inputClass} maxLength={200} value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
              <button type="submit" disabled={busy || !canOverride} className={`${btn} bg-blue-700 text-white`}>上限を保存</button>
            </form>
          </>
        )}
      </section>
    </Card>
  );
};

export default AdminUsagePanel;
