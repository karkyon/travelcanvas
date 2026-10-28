/**
 * [Gate G2] FR-040 サポート閲覧と運用の要約(管理者・多要素認証の確認済みだけ)。
 *
 * - 運用の要約: 有効な共有リンク(編集できるもの・期限の無いもの)・Webhook の失敗と送り直しの上限(dead)・
 *   DB と文書の容量・削除待ち・有効なサポートの許可。利用者の個人の値は含めない
 * - 共有リンク: 先頭の数文字・権限・使用回数だけ。不正な利用が疑われるリンクを理由つきで止める(所有者に知らせる)
 * - サポート閲覧: 利用者本人が「設定 → サポート」で作った許可(目的・期限つき)だけを見られる。読み取り専用で、住所・メモ・
 *   予約番号・文書の中身は出ない。見るたびに監査に残り、本人に知らせが届く。自分が作った許可は見られない
 * backend: app/api/v1/admin_support.py。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '@/components/common/Card';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import {
  getAdminOperations, getAdminShareLinks, getAdminSupportGrants, revokeAdminShareLink, viewAdminSupportGrant,
} from '@/services/api';
import type { AdminOperations, AdminShareLink, AdminSupportGrant, SupportView } from '@/services/api';
import { apiErrorMessage } from '@/utils/apiError';

const btn = 'px-3 py-2 rounded-lg text-sm disabled:opacity-50';

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ja-JP');
}

function bytes(n: number | null): string {
  if (n === null) return '確認できません';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

const Stat: React.FC<{ label: string; value: string | number; warn?: boolean }> = ({ label, value, warn }) => (
  <div className={`rounded-lg border p-3 ${warn ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
    <p className="text-xs text-ink-700">{label}</p>
    <p className="text-xl font-semibold text-ink-900">{value}</p>
  </div>
);

const AdminSupport: React.FC = () => {
  const [ops, setOps] = useState<AdminOperations | null>(null);
  const [links, setLinks] = useState<AdminShareLink[]>([]);
  const [grants, setGrants] = useState<AdminSupportGrant[]>([]);
  const [view, setView] = useState<SupportView | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, l, g] = await Promise.all([getAdminOperations(), getAdminShareLinks(), getAdminSupportGrants()]);
      setOps(o);
      setLinks(l);
      setGrants(g);
    } catch (e) {
      setError(apiErrorMessage(e, '運用の情報を読み込めませんでした'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(apiErrorMessage(e, '操作できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink-900">運用とサポート</h1>
          <p className="text-ink-700 mt-1">この画面を見たこと・サポートで閲覧したことは監査に残ります。</p>
        </div>
        <Link to="/admin" className="text-blue-700 underline">管理者ダッシュボードへ</Link>
      </div>
      {error && <p role="alert" className="text-red-800">{error}</p>}
      {notice && <p role="status" className="text-green-800">{notice}</p>}

      {ops && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-ink-900 mb-4">運用の要約</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="有効な共有リンク" value={ops.share_links.active} />
            <Stat label="うち編集できるリンク" value={ops.share_links.active_edit} warn={ops.share_links.active_edit > 0} />
            <Stat label="うち期限の無いリンク" value={ops.share_links.without_expiry} />
            <Stat label="有効なサポートの許可" value={ops.support_grants.active} />
            <Stat label="Webhook 送信待ち" value={ops.webhooks.pending} />
            <Stat label="Webhook 失敗(自動で再送)" value={ops.webhooks.failed} warn={ops.webhooks.failed > 0} />
            <Stat label="Webhook 再送の上限" value={ops.webhooks.dead} warn={ops.webhooks.dead > 0} />
            <Stat label="Webhook 届いた" value={ops.webhooks.delivered} />
            <Stat label="DB の容量" value={bytes(ops.storage.database_bytes)} />
            <Stat label="文書" value={`${ops.storage.documents}件・${bytes(ops.storage.document_bytes)}`} />
            <Stat label="削除待ちの旅行(うち期限切れ)" value={`${ops.purge.plans_pending}(${ops.purge.plans_due})`}
              warn={ops.purge.plans_due > 0} />
            <Stat label="ファイルの削除待ちの文書" value={ops.purge.documents_pending} />
          </div>
          <p className="text-xs text-ink-700 mt-2">取得: {fmt(ops.timestamp)}</p>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-ink-900 mb-2">有効な共有リンク</h2>
        <p className="text-sm text-ink-700 mb-3">使用回数の多い順。旅行の名前・所有者・リンクの値は表示しません。</p>
        {links.length === 0 ? <p className="text-sm text-ink-700">有効な共有リンクはありません。</p> : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                <p className="text-ink-900"><code>{l.token_prefix}…</code>・{l.permission === 'edit' ? '編集できる' : '閲覧だけ'}
                  ・{l.use_count}回{l.max_uses ? ` / 上限 ${l.max_uses}回` : ''}・{l.has_passcode ? '合言葉あり' : '合言葉なし'}
                  ・期限 {fmt(l.expires_at)}</p>
                <div className="flex flex-wrap items-end gap-2 mt-2">
                  <div className="grow">
                    <label htmlFor={`reason-${l.id}`} className="block text-xs text-ink-900">止める理由(所有者に伝わります)</label>
                    <input id={`reason-${l.id}`} value={reason[l.id] ?? ''} maxLength={200}
                      onChange={(e) => setReason({ ...reason, [l.id]: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                  </div>
                  <button type="button" disabled={busy || !(reason[l.id] ?? '').trim()}
                    className={`${btn} border border-red-300 text-red-800 hover:bg-red-50`}
                    aria-label={`共有リンク ${l.token_prefix} を止める`}
                    onClick={() => void run(async () => {
                      await revokeAdminShareLink(l.id, (reason[l.id] ?? '').trim());
                      setNotice('共有リンクを止めました。所有者に知らせました');
                      await load();
                    })}>
                    止める
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-ink-900 mb-2">サポートへの閲覧の許可</h2>
        <p className="text-sm text-ink-700 mb-3">
          利用者本人が作った、期限内の許可だけです。閲覧は読み取り専用で、閲覧するたびに本人へ知らせが届きます。
        </p>
        {grants.length === 0 ? <p className="text-sm text-ink-700">有効な許可はありません。</p> : (
          <ul className="space-y-2">
            {grants.map((g) => (
              <li key={g.id} className="border border-gray-200 rounded-lg p-3 text-sm flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-ink-900">{g.user_label}・{g.scope === 'plan' ? `旅行「${g.plan_title ?? ''}」` : 'アカウント'}</p>
                  <p className="text-ink-700">目的: {g.purpose}{g.ticket_ref ? `(問い合わせ ${g.ticket_ref})` : ''}</p>
                  <p className="text-ink-700">期限 {fmt(g.expires_at)}・閲覧 {g.access_count}回</p>
                </div>
                {g.own ? <span className="text-ink-700">自分の許可は見られません</span> : (
                  <button type="button" disabled={busy} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}
                    aria-label={`${g.user_label} の許可(${g.scope === 'plan' ? `旅行「${g.plan_title ?? ''}」` : 'アカウント'})で閲覧する`}
                    onClick={() => void run(async () => setView(await viewAdminSupportGrant(g.id)))}>
                    閲覧する(記録されます)
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {view && (
        <Card className="p-6">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-xl font-semibold text-ink-900">閲覧中(読み取り専用): {view.grant.user_label}</h2>
            <button type="button" className={`${btn} border border-gray-300`} onClick={() => setView(null)}>閉じる</button>
          </div>
          <p className="text-sm text-ink-700 mb-3">住所・メモの本文・位置・予約番号・文書の中身は表示しません(有無だけ)。</p>
          {view.plan && (
            <div className="space-y-3 text-sm" aria-label="旅行の内容(読み取り専用)">
              <p className="text-ink-900">{view.plan.title}・{view.plan.destination ?? '目的地なし'}・{view.plan.status ?? ''}
                ・版 {view.plan.revision}・参加者 {view.plan.collaborators}人{view.plan.deleted ? '・削除済み' : ''}</p>
              {view.plan.days.map((d) => (
                <div key={d.id}>
                  <p className="font-medium text-ink-900">{d.local_date} {d.title ?? ''}({d.timezone_id})</p>
                  <ul className="ml-4 list-disc">
                    {d.events.map((e) => (
                      <li key={e.id}>{e.local_start_time ?? (e.is_all_day ? '終日' : '時刻なし')} {e.title}({e.event_type})
                        {e.has_address ? '・住所あり' : ''}{e.has_notes ? '・メモあり' : ''}{e.has_location ? '・位置あり' : ''}
                        {e.locked ? '・確定' : ''}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="font-medium text-ink-900">予約</p>
              <ul className="ml-4 list-disc">
                {view.plan.reservations.map((r) => (
                  <li key={r.id}>{r.type}・{r.provider_name ?? '施設名なし'}・{r.status}・{fmt(r.start_at)}・予約番号 {r.confirmation_number ?? 'なし'}</li>
                ))}
              </ul>
              <p className="text-ink-900">文書: {Object.entries(view.plan.documents_by_classification)
                .map(([k, v]) => `${k} ${v}件`).join('・') || 'なし'}</p>
            </div>
          )}
          {view.account && (
            <div className="space-y-2 text-sm" aria-label="アカウントの概要(読み取り専用)">
              <p className="text-ink-900">{view.account.username ?? '(名前なし)'}・{view.account.user_type}
                ・{view.account.is_active ? '有効' : '停止中'}・登録 {fmt(view.account.created_at)}</p>
              <ul className="ml-4 list-disc">
                {view.account.plans.map((p) => (
                  <li key={p.id}>{p.title}・{p.status ?? ''}・{p.days}日・予定 {p.events}件{p.deleted ? '・削除済み' : ''}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default AdminSupport;
