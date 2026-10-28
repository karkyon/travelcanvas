/**
 * [Gate G2] FR-040 サポートへの閲覧の許可(設定 → サポート)。
 *
 * 問い合わせの調査のため、運営のサポート担当者に読み取り専用で見せることを、本人が目的・期限つきで許可する。
 * - 対象: 1つの旅行(自分が所有するもの)か、アカウントの概要と旅行の一覧
 * - 期限: 1〜72時間。期限が来ると自動で終わる。いつでも取り消せる
 * - 担当者が閲覧するたびに、あなたに知らせが届き、回数と最後の閲覧の時刻がここに出る
 * - 住所・メモの本文・位置・予約番号・文書の中身は、許可しても担当者には見えない
 */
import React, { useCallback, useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import { api, createSupportGrant, getSupportGrants, revokeSupportGrant } from '@/services/api';
import type { SupportGrantList } from '@/services/api';
import type { TravelPlan } from '@/types';
import { apiErrorMessage } from '@/utils/apiError';

const inputClass = 'w-full border rounded-lg px-3 py-2';
const STATE_LABEL = { active: '有効', expired: '期限切れ', revoked: '取り消し済み' } as const;

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ja-JP');
}

const SupportAccessSection: React.FC = () => {
  const [data, setData] = useState<SupportGrantList | null>(null);
  const [plans, setPlans] = useState<TravelPlan[]>([]);
  const [form, setForm] = useState({ purpose: '', hours: 24, plan_id: '', ticket_ref: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await getSupportGrants();
      setData(list);
      setForm((f) => ({ ...f, hours: f.hours || list.limits.default_hours }));
    } catch (e) {
      setMessage({ type: 'error', text: apiErrorMessage(e, 'サポートへの許可を読み込めませんでした') });
    }
  }, []);

  useEffect(() => {
    void load();
    api.getPlans().then((r) => setPlans(r.data ?? [])).catch(() => setPlans([]));
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await createSupportGrant({
        purpose: form.purpose.trim(), hours: form.hours, plan_id: form.plan_id || null,
        ticket_ref: form.ticket_ref.trim() || null, password: form.password || undefined,
      });
      setForm({ purpose: '', hours: data?.limits.default_hours ?? 24, plan_id: '', ticket_ref: '', password: '' });
      setMessage({ type: 'ok', text: 'サポートへの閲覧を許可しました' });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err, '許可できませんでした') });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await revokeSupportGrant(id);
      setMessage({ type: 'ok', text: '許可を取り消しました' });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err, '取り消せませんでした') });
    } finally {
      setBusy(false);
    }
  };

  const limits = data?.limits;
  return (
    <section aria-labelledby="support-access-heading" className="space-y-4">
      <div>
        <h3 id="support-access-heading" className="text-lg font-medium text-ink-900">サポートへの閲覧の許可</h3>
        <p className="text-sm text-ink-700 mt-1">
          問い合わせの調査のため、運営のサポート担当者に読み取り専用で見せることを許可します。期限が来ると自動で終わり、
          いつでも取り消せます。担当者が閲覧するたびに、あなたに知らせが届きます。住所・メモの本文・位置・予約番号・
          文書の中身は、許可しても担当者には見えません。
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3 border rounded-lg p-4" aria-label="サポートへの閲覧を許可する">
        <div>
          <label htmlFor="support-purpose" className="block text-sm font-medium text-ink-900 mb-1">目的(担当者に伝わります)</label>
          <input id="support-purpose" required maxLength={limits?.purpose_max ?? 200} value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })} className={inputClass}
            placeholder="例: 予約が表示されない件の調査" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="support-scope" className="block text-sm font-medium text-ink-900 mb-1">見せる範囲</label>
            <select id="support-scope" value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}
              className={inputClass}>
              <option value="">アカウントの概要と旅行の一覧</option>
              {plans.map((p) => <option key={p.id} value={p.id}>旅行「{p.title}」の中身</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="support-hours" className="block text-sm font-medium text-ink-900 mb-1">
              期間(時間・{limits?.min_hours ?? 1}〜{limits?.max_hours ?? 72})
            </label>
            <input id="support-hours" type="number" required min={limits?.min_hours ?? 1} max={limits?.max_hours ?? 72}
              value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} className={inputClass} />
          </div>
          <div>
            <label htmlFor="support-ticket" className="block text-sm font-medium text-ink-900 mb-1">問い合わせ番号(任意)</label>
            <input id="support-ticket" maxLength={40} value={form.ticket_ref}
              onChange={(e) => setForm({ ...form, ticket_ref: e.target.value })} className={inputClass} />
          </div>
        </div>
        {data?.requires_password && (
          <div>
            <label htmlFor="support-password" className="block text-sm font-medium text-ink-900 mb-1">
              本人確認のためのパスワード
            </label>
            <input id="support-password" type="password" required autoComplete="current-password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} />
          </div>
        )}
        <Button type="submit" loading={busy} disabled={busy || !form.purpose.trim()}>許可する</Button>
      </form>

      {message && (
        <p role={message.type === 'error' ? 'alert' : 'status'}
          className={`text-sm ${message.type === 'error' ? 'text-red-700' : 'text-green-800'}`}>
          {message.text}
        </p>
      )}

      <div>
        <h4 className="font-medium text-ink-900 mb-2">これまでの許可</h4>
        {(data?.grants.length ?? 0) === 0 ? <p className="text-sm text-ink-700">まだありません。</p> : (
          <ul className="space-y-2">
            {data!.grants.map((g) => (
              <li key={g.id} className="border rounded-lg p-3 text-sm flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-ink-900">
                    {g.scope === 'plan' ? `旅行「${g.plan_title ?? ''}」` : 'アカウント'}・{STATE_LABEL[g.state]}
                  </p>
                  <p className="text-ink-700">目的: {g.purpose}{g.ticket_ref ? `(${g.ticket_ref})` : ''}</p>
                  <p className="text-ink-700">期限 {fmt(g.expires_at)}・閲覧 {g.access_count}回
                    {g.last_accessed_at ? `・最後の閲覧 ${fmt(g.last_accessed_at)}` : ''}</p>
                </div>
                {g.state === 'active' && (
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => void revoke(g.id)}
                    aria-label={`「${g.purpose}」の許可を取り消す`}>
                    取り消す
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default SupportAccessSection;
