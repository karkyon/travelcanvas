/**
 * [FR059-B] 管理者: 旅程相談の利用枠のクラスの付与・Trip Pass の割り当て・Pro の契約の例外(二者の承認)。
 * 申請した管理者とは別の管理者が承認するまで効かない。取り消しは理由が要る。全て監査に残る。
 * docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §6。
 */
import React, { useState } from 'react';
import Card from '../../components/common/Card';
import {
  adminApproveEntitlement, adminListEntitlements, adminRequestEntitlement, adminRevokeEntitlement,
} from '@/services/api/planningUsage';
import type { AdminEntitlements } from '@/services/api/types/planningUsage';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const inputClass = 'w-full px-3 py-2 border border-cloud-200 rounded-lg bg-surface text-ink-900';
const btn = 'min-h-11 px-3 py-2 rounded-lg text-sm disabled:opacity-50';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEATURES: Record<'user' | 'plan', Array<{ value: string; label: string; quota?: boolean }>> = {
  user: [
    { value: 'trip_planning.class.trip', label: 'クラス Trip(行先を見つける: 場所・経路の少ない回数、AI なし)' },
    { value: 'trip_planning.class.journey', label: 'クラス Journey(計画を一緒に考える: 制限つき AI・限られた API)' },
    { value: 'trip_planning.class.explorer', label: 'クラス Explorer(比較して深掘りする: 最大の検索・AI の枠)' },
    { value: 'trip_planning.class.plus', label: '旧クラス Plus(月5旅行・250円)' },
    { value: 'trip_planning.class.family', label: 'クラス Family/Group(支払う人の月の枠)' },
    { value: 'trip_planning.class.pro', label: 'クラス Pro/B2B(契約)' },
    { value: 'trip_planning.cost_jpy_per_month', label: 'Pro の契約: 月の上限(円)', quota: true },
    { value: 'trip_planning.plans_per_month', label: 'Pro の契約: 月の旅行の数', quota: true },
    { value: 'trip_planning.cost_jpy_per_plan', label: 'Pro の契約の例外: 1旅行の上限(円)', quota: true },
  ],
  plan: [{ value: 'trip_planning.class.trip_pass', label: 'Trip Pass(この旅行だけ)' }],
};
const STATUS_LABEL = { pending: '承認待ち', active: '有効', revoked: '取り消し' } as const;

const AdminEntitlementsPanel: React.FC = () => {
  const [subject, setSubject] = useState<{ type: 'user' | 'plan'; id: string }>({ type: 'user', id: '' });
  const [data, setData] = useState<AdminEntitlements | null>(null);
  const [form, setForm] = useState({ feature: '', quota: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setData(await adminListEntitlements(subject.type, subject.id.trim()));
  const run = async (fn: () => Promise<unknown>, ok: string | null, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      if (ok) setNotice(ok);
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };
  const feature = FEATURES[subject.type].find((f) => f.value === form.feature);
  const quotaValue = form.quota.trim() === '' ? null : Number(form.quota);
  const canRequest = !!data && !!feature && !!form.reason.trim()
    && (!feature.quota || (quotaValue !== null && Number.isInteger(quotaValue) && quotaValue >= 0));

  return (
    <Card className="p-6">
      <section aria-labelledby="admin-entitlements-heading">
        <h3 id="admin-entitlements-heading" className="text-lg font-semibold text-ink-900 mb-1">旅程相談の利用枠(クラス)</h3>
        <p className="text-sm text-ink-700 mb-4">
          付与は申請した管理者とは別の管理者が承認すると有効になります(二者の承認)。1旅行の上限 50円は、Pro の契約の例外だけが変えられます。
        </p>
        {error && <p role="alert" className="mb-3 p-3 rounded-lg bg-danger-soft text-danger text-sm">{error}</p>}
        {notice && <p role="status" className="mb-3 p-3 rounded-lg bg-success-soft text-success text-sm">{notice}</p>}
        <form className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end mb-4" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => undefined, null, '付与を取得できませんでした');
        }}>
          <div>
            <label htmlFor="ent-subject-type" className="block text-sm font-medium text-ink-900 mb-1">対象</label>
            <select id="ent-subject-type" className={inputClass} value={subject.type}
              onChange={(e) => { setSubject({ ...subject, type: e.target.value as 'user' | 'plan' }); setForm({ ...form, feature: '' }); }}>
              <option value="user">利用者</option>
              <option value="plan">旅行(Trip Pass)</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="ent-subject-id" className="block text-sm font-medium text-ink-900 mb-1">ID</label>
            <input id="ent-subject-id" className={inputClass} value={subject.id}
              onChange={(e) => setSubject({ ...subject, id: e.target.value })} />
          </div>
          <button type="submit" className={`${btn} border border-accent text-accent`} disabled={busy || !UUID.test(subject.id.trim())}>
            表示
          </button>
        </form>
        {data && (
          <>
            {data.effective && (
              <p className="text-sm text-ink-900 mb-3" data-testid="ent-effective">
                {`今のクラス: ${data.effective.class_label}(${data.effective.policy_version})`}
              </p>
            )}
            <table className="w-full text-sm mb-4" data-testid="ent-grants">
              <thead><tr className="text-left text-ink-700"><th>付与</th><th>状態</th><th>理由</th><th>操作</th></tr></thead>
              <tbody>
                {data.grants.length === 0 && <tr><td colSpan={4} className="py-2 text-ink-700">付与はありません(会員は Free: 外部の AI・有料の検索なし)</td></tr>}
                {data.grants.map((g) => (
                  <tr key={g.id} className="border-t border-cloud-200">
                    <td className="py-2">{g.feature_key}{g.quota !== null ? ` = ${g.quota}` : ''}</td>
                    <td>{STATUS_LABEL[g.status]}</td>
                    <td>{g.reason ?? ''}</td>
                    <td className="space-x-2">
                      {g.status === 'pending' && (
                        <button type="button" className={`${btn} border border-cloud-200`} disabled={busy}
                          onClick={() => void run(() => adminApproveEntitlement(g.id), '承認しました', '承認できませんでした')}>
                          承認
                        </button>
                      )}
                      {g.status !== 'revoked' && (
                        <button type="button" className={`${btn} border border-cloud-200`} disabled={busy || !form.reason.trim()}
                          onClick={() => void run(() => adminRevokeEntitlement(g.id, form.reason.trim()), '取り消しました',
                            '取り消せませんでした')}>
                          取り消す
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
              <div className="md:col-span-2">
                <label htmlFor="ent-feature" className="block text-sm font-medium text-ink-900 mb-1">付与する内容</label>
                <select id="ent-feature" className={inputClass} value={form.feature}
                  onChange={(e) => setForm({ ...form, feature: e.target.value })}>
                  <option value="">選んでください</option>
                  {FEATURES[subject.type].map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              {feature?.quota && (
                <div>
                  <label htmlFor="ent-quota" className="block text-sm font-medium text-ink-900 mb-1">値</label>
                  <input id="ent-quota" inputMode="numeric" className={inputClass} value={form.quota}
                    onChange={(e) => setForm({ ...form, quota: e.target.value })} />
                </div>
              )}
              <div className="md:col-span-4">
                <label htmlFor="ent-reason" className="block text-sm font-medium text-ink-900 mb-1">理由(申請・取り消しに必須)</label>
                <input id="ent-reason" className={inputClass} maxLength={200} value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
              <button type="button" className={`${btn} border border-accent text-accent`} disabled={busy || !canRequest}
                onClick={() => void run(() => adminRequestEntitlement({
                  subject_type: subject.type, subject_id: subject.id.trim(), feature_key: form.feature, reason: form.reason.trim(),
                  ...(feature?.quota && quotaValue !== null ? { quota: quotaValue } : {}),
                }), '申請しました。別の管理者の承認で有効になります', '申請できませんでした')}>
                申請する
              </button>
            </div>
          </>
        )}
      </section>
    </Card>
  );
};

export default AdminEntitlementsPanel;
