/**
 * OrganizationPage - 組織の画面(/organizations/:orgId。FR-041・FR-042、DOC-04 SC-31)。
 *
 * [Gate B1]
 * - 配布: 一覧(メンバーは自分の確認の状態、管理者は確認の件数)。管理者は自分の旅行を配布する
 *   (写すのは旅行名・目的地・期間・説明・日程の見出し・予定名・種類・時刻だけ)
 * - メンバー(管理者): 会員のメールアドレスで足す・役割(オーナーだけ変えられる)・外す。最後のオーナーは外せない
 * - 外部連携(管理者): API クライアント(OAuth 2.0 client_credentials。秘密は作った時だけ表示)、
 *   Webhook(https だけ。署名の鍵は作った時だけ表示)・接続の確かめ・送信の記録と送り直し
 * - [Gate G2] FR-042 秘密・署名の鍵の切り替え(新しい値は1回だけ表示。前の値は猶予の間だけ通る/署名に使う)・
 *   前の値の即時の失効・送り直しの上限に達した送信(dead)の手の送り直し・受け手が 410 を返して止まった Webhook の表示
 * - [Gate G5] ORG-01 ロゴ(メンバー全員に表示)・席の上限・独自のドメインの確認、BILL-02 組織の使用量(OrgBrandingPanel)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api from '@/services/api';
import type {
  Organization, OrgApiClient, OrgApiClientList, OrgApiScope, OrgDistribution, OrgMember, OrgRole, OrgWebhook,
  OrgWebhookDelivery, OrgWebhookEvent, OrgWebhookList,
} from '@/services/api';
import type { TravelPlan } from '@/types';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { fmtDateTime, isOrgAdmin, myAckLabel, ROLE_LABEL } from '@/utils/organizations';
import OrgBrandingPanel from './organization/OrgBrandingPanel';
import OrgLogo from './organization/OrgLogo';

/** [Gate G5] 組織の応答の ORG-01 の項目(古い応答に無くても動く) */
function branding(org: Organization): { hasLogo: boolean; logoVersion: string | null; seatLimit: number | null } {
  const o = org as unknown as { has_logo?: unknown; logo_version?: unknown; seat_limit?: unknown };
  return {
    hasLogo: o.has_logo === true,
    logoVersion: typeof o.logo_version === 'string' ? o.logo_version : null,
    seatLimit: typeof o.seat_limit === 'number' ? o.seat_limit : null,
  };
}

const sectionClass = 'bg-surface rounded-xl shadow-xs p-6 mb-6';
const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg';
const btn = 'px-3 py-2 rounded-lg text-sm disabled:opacity-50';
// [Gate G2] 送信の状態の表示(dead: 自動の再送の上限に達した。手で送り直せる)
const DELIVERY_LABEL: Record<OrgWebhookDelivery['status'], string> = {
  pending: '送信待ち', delivered: '届いた', failed: '失敗', dead: '送り直しの上限に達しました',
};

const OrganizationPage: React.FC = () => {
  const { orgId } = useParams<{ orgId: string }>();
  const [org, setOrg] = useState<Organization | null>(null);
  const [dists, setDists] = useState<OrgDistribution[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [plans, setPlans] = useState<TravelPlan[]>([]);
  const [clients, setClients] = useState<OrgApiClientList | null>(null);
  const [hooks, setHooks] = useState<OrgWebhookList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [publish, setPublish] = useState({ plan_id: '', title: '', change_note: '' });
  const [invite, setInvite] = useState<{ email: string; role: 'member' | 'admin' }>({ email: '', role: 'member' });
  const [newClient, setNewClient] = useState<{ name: string; scopes: OrgApiScope[] }>({ name: '', scopes: ['distributions:read'] });
  const [createdClient, setCreatedClient] = useState<OrgApiClient | null>(null);
  const [newHook, setNewHook] = useState<{ url: string; events: OrgWebhookEvent[] }>({ url: '', events: ['distribution.published', 'distribution.revised'] });
  const [createdHook, setCreatedHook] = useState<OrgWebhook | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, OrgWebhookDelivery[]>>({});
  // [Gate G2] 秘密・鍵の切り替えの猶予(時間)
  const [graceHours, setGraceHours] = useState(24);

  const admin = isOrgAdmin(org?.role);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const o = await api.getOrganization(orgId);
      setOrg(o);
      setDists(await api.getDistributions(orgId));
      if (isOrgAdmin(o.role)) {
        const [m, c, h, p] = await Promise.all([
          api.getOrgMembers(orgId), api.getOrgApiClients(orgId), api.getOrgWebhooks(orgId), api.getPlans(),
        ]);
        setMembers(m);
        setClients(c);
        setHooks(h);
        setPlans(p.data ?? []);
      }
    } catch (e) {
      setError(errorDetailMessage(e, '組織を取得できませんでした'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string | null, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  if (!org || !orgId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p role="alert" className="text-red-800">{error ?? '組織が見つかりません'}</p>
        <Link to="/organizations" className="text-blue-800 underline">組織の一覧へ</Link>
      </div>
    );
  }

  const toggle = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="h-2" style={{ backgroundColor: org.brand_color ?? '#9ca3af' }} aria-hidden="true" />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/organizations" className="text-blue-800 hover:underline">← 組織の一覧</Link>
        <div className="flex items-center gap-3 mt-2">
          {branding(org).hasLogo && <OrgLogo orgId={orgId} version={branding(org).logoVersion} />}
          <h1 className="text-3xl font-bold text-ink-900">{org.name}</h1>
        </div>
        <p className="text-ink-700 mb-6">{ROLE_LABEL[org.role]}・メンバー {org.member_count}人</p>
        {error && <p role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200">{error}</p>}
        {notice && <p role="status" className="mb-4 p-3 rounded-lg bg-green-50 text-green-900 border border-green-200">{notice}</p>}

        <section className={sectionClass} aria-labelledby="dist-heading">
          <h2 id="dist-heading" className="text-lg font-semibold text-ink-900 mb-3">配布されている旅程</h2>
          {dists.length === 0 ? (
            <p className="text-ink-700">まだ配布されている旅程はありません。</p>
          ) : (
            <ul className="space-y-3">
              {dists.map((d) => (
                <li key={d.id} className="border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900">{d.title}</p>
                    <p className="text-sm text-ink-700">
                      版{d.version}・{fmtDateTime(d.published_at)}
                      {d.change_note ? `・${d.change_note}` : ''}
                    </p>
                    <p className="text-sm text-ink-900">
                      {d.ack_status
                        ? `確認 ${d.ack_status.acknowledged_latest}/${d.ack_status.members}人(未確認 ${d.ack_status.pending}人)`
                        : myAckLabel(d)}
                    </p>
                  </div>
                  <Link to={`/organizations/${orgId}/distributions/${d.id}`} aria-label={`「${d.title}」を開く`}
                    className="px-3 py-2 rounded-lg border border-blue-300 text-blue-800 hover:bg-blue-50 shrink-0">
                    開く
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {admin && (
          <>
            <OrgBrandingPanel orgId={orgId} isOwner={org.role === 'owner'} hasLogo={branding(org).hasLogo}
              logoVersion={branding(org).logoVersion} seatLimit={branding(org).seatLimit} memberCount={org.member_count}
              onChanged={load} />
            <section className={sectionClass} aria-labelledby="publish-heading">
              <h2 id="publish-heading" className="text-lg font-semibold text-ink-900 mb-2">旅程を配布する</h2>
              <p className="text-sm text-ink-700 mb-3">
                配布するのは、旅行名・目的地・期間・説明・日程の見出し・予定名・種類・時刻だけです。予約・予約番号・住所・メモ・位置は配布しません。
                メンバーは確認でき、自分の旅行として複製できます(後の改訂で、複製した旅行は変わりません)。
              </p>
              <form className="space-y-3" onSubmit={(e) => {
                e.preventDefault();
                run(() => api.publishDistribution(orgId, {
                  plan_id: publish.plan_id, title: publish.title || undefined, change_note: publish.change_note || undefined,
                }), '配布しました', '配布できませんでした').then(() => setPublish({ plan_id: '', title: '', change_note: '' }));
              }}>
                <div>
                  <label htmlFor="publish-plan" className="block text-sm font-medium text-ink-900 mb-1">配布する旅行(自分の旅行)</label>
                  <select id="publish-plan" value={publish.plan_id} onChange={(e) => setPublish({ ...publish, plan_id: e.target.value })}
                    className={inputClass} required>
                    <option value="">選んでください</option>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="publish-title" className="block text-sm font-medium text-ink-900 mb-1">配布の題名(任意。空なら旅行名)</label>
                  <input id="publish-title" value={publish.title} maxLength={200} onChange={(e) => setPublish({ ...publish, title: e.target.value })}
                    className={inputClass} />
                </div>
                <div>
                  <label htmlFor="publish-note" className="block text-sm font-medium text-ink-900 mb-1">説明(任意)</label>
                  <input id="publish-note" value={publish.change_note} maxLength={500}
                    onChange={(e) => setPublish({ ...publish, change_note: e.target.value })} className={inputClass} />
                </div>
                <button type="submit" disabled={busy || !publish.plan_id} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
                  配布する
                </button>
              </form>
            </section>

            <section className={sectionClass} aria-labelledby="members-heading">
              <h2 id="members-heading" className="text-lg font-semibold text-ink-900 mb-3">メンバー</h2>
              <ul className="space-y-2 mb-4">
                {members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border border-gray-200 rounded-lg p-3">
                    <div>
                      <p className="font-medium text-ink-900">{m.username ?? '(退会済み)'}</p>
                      <p className="text-sm text-ink-700">{m.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {org.role === 'owner' ? (
                        <>
                          <label htmlFor={`role-${m.id}`} className="sr-only">{m.username} の役割</label>
                          <select id={`role-${m.id}`} value={m.role} disabled={busy}
                            onChange={(e) => run(() => api.changeOrgMemberRole(orgId, m.id, e.target.value as OrgRole),
                              '役割を変えました', '役割を変えられませんでした')}
                            className="px-2 py-1 border border-gray-300 rounded-sm">
                            {(['owner', 'admin', 'member'] as OrgRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        </>
                      ) : (
                        <span className="text-sm text-ink-900">{ROLE_LABEL[m.role]}</span>
                      )}
                      <button type="button" disabled={busy} aria-label={`${m.username ?? 'メンバー'} を組織から外す`}
                        onClick={() => {
                          if (!window.confirm('このメンバーを組織から外しますか?')) return;
                          run(() => api.removeOrgMember(orgId, m.id), '外しました', '外せませんでした');
                        }}
                        className={`${btn} border border-red-300 text-red-800 hover:bg-red-50`}>
                        外す
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
                e.preventDefault();
                run(() => api.addOrgMember(orgId, invite), 'メンバーを足しました', 'メンバーを足せませんでした')
                  .then(() => setInvite({ email: '', role: 'member' }));
              }}>
                <div className="flex-1 min-w-[200px]">
                  <label htmlFor="member-email" className="block text-sm font-medium text-ink-900 mb-1">会員のメールアドレス</label>
                  <input id="member-email" type="email" value={invite.email} required
                    onChange={(e) => setInvite({ ...invite, email: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="member-role" className="block text-sm font-medium text-ink-900 mb-1">役割</label>
                  <select id="member-role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as 'member' | 'admin' })}
                    className="px-3 py-2 border border-gray-300 rounded-lg">
                    <option value="member">メンバー</option>
                    <option value="admin">管理者</option>
                  </select>
                </div>
                <button type="submit" disabled={busy || !invite.email} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
                  メンバーを足す
                </button>
              </form>
            </section>

            <section className={sectionClass} aria-labelledby="api-heading">
              <h2 id="api-heading" className="text-lg font-semibold text-ink-900 mb-2">外部連携</h2>
              <p className="text-sm text-ink-700 mb-4">
                旅行会社などのシステムが、この組織の配布(写し)を読めるようにします。OAuth 2.0 の client_credentials で
                1時間のトークンを受け取り、許可したスコープの範囲だけを読めます。個人の旅行・予約・メンバーの個人情報は読めません。
              </p>

              <h3 className="font-semibold text-ink-900 mb-2">API クライアント</h3>
              {createdClient?.client_secret && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-300 rounded-lg" role="status">
                  <p className="text-sm text-amber-900 font-medium">
                    秘密は今だけ表示されます。安全な場所に控えてください。{createdClient.secret_version > 1 ? `(版 ${createdClient.secret_version})` : ''}
                  </p>
                  <p className="text-sm text-ink-900 mt-1">client_id: <code>{createdClient.client_id}</code></p>
                  <label htmlFor="client-secret" className="block text-sm text-ink-900 mt-1">client_secret</label>
                  <input id="client-secret" readOnly value={createdClient.client_secret} className={`${inputClass} font-mono text-sm`} />
                </div>
              )}
              <div className="mb-3">
                <label htmlFor="grace-hours" className="block text-sm font-medium text-ink-900 mb-1">
                  切り替えの猶予(時間)— この間は前の秘密・鍵も使えます(0〜168)
                </label>
                <input id="grace-hours" type="number" min={0} max={168} value={graceHours}
                  onChange={(e) => setGraceHours(Math.max(0, Math.min(168, Number(e.target.value) || 0)))}
                  className={`${inputClass} max-w-[8rem]`} />
              </div>
              <ul className="space-y-2 mb-3">
                {clients?.clients.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border border-gray-200 rounded-lg p-3 text-sm">
                    <div>
                      <p className="font-medium text-ink-900">{c.name}{c.revoked_at ? '(止めました)' : ''}</p>
                      <p className="text-ink-700"><code>{c.client_id}</code>・{c.scopes.join(' ')}
                        {c.last_used_at ? `・最後の利用 ${fmtDateTime(c.last_used_at)}` : '・未使用'}</p>
                      <p className="text-ink-700">秘密の版 {c.secret_version}
                        {c.secret_rotated_at ? `・切り替え ${fmtDateTime(c.secret_rotated_at)}` : ''}
                        {c.previous_secret_valid_until ? `・前の秘密は ${fmtDateTime(c.previous_secret_valid_until)} まで使えます` : ''}</p>
                    </div>
                    {!c.revoked_at && (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy} aria-label={`API クライアント「${c.name}」の秘密を切り替える`}
                          onClick={() => run(async () => setCreatedClient(await api.rotateOrgApiClientSecret(orgId, c.id, graceHours)),
                            null, '秘密を切り替えられませんでした')}
                          className={`${btn} border border-gray-300 text-ink-900 hover:bg-gray-50`}>
                          秘密を切り替える
                        </button>
                        {c.previous_secret_valid_until && (
                          <button type="button" disabled={busy} aria-label={`API クライアント「${c.name}」の前の秘密をすぐ失効する`}
                            onClick={() => run(() => api.retireOrgApiClientPrevious(orgId, c.id, true),
                              '前の秘密と、発行済みのトークンを失効しました', '失効できませんでした')}
                            className={`${btn} border border-amber-400 text-amber-900 hover:bg-amber-50`}>
                            前の秘密をすぐ失効
                          </button>
                        )}
                        <button type="button" disabled={busy} aria-label={`API クライアント「${c.name}」を止める`}
                          onClick={() => run(() => api.revokeOrgApiClient(orgId, c.id), 'API クライアントを止めました', '止められませんでした')}
                          className={`${btn} border border-red-300 text-red-800 hover:bg-red-50`}>
                          止める
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <form className="space-y-2 mb-6" onSubmit={(e) => {
                e.preventDefault();
                run(async () => setCreatedClient(await api.createOrgApiClient(orgId, newClient)), null, 'API クライアントを作れませんでした')
                  .then(() => setNewClient({ name: '', scopes: ['distributions:read'] }));
              }}>
                <div>
                  <label htmlFor="client-name" className="block text-sm font-medium text-ink-900 mb-1">連携の名前</label>
                  <input id="client-name" value={newClient.name} maxLength={100} required
                    onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} className={inputClass} />
                </div>
                <fieldset>
                  <legend className="text-sm font-medium text-ink-900">スコープ</legend>
                  {Object.entries(clients?.scopes ?? {}).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 text-sm text-ink-900">
                      <input type="checkbox" checked={newClient.scopes.includes(k as OrgApiScope)}
                        onChange={() => setNewClient({ ...newClient, scopes: toggle(newClient.scopes, k as OrgApiScope) })} />
                      <code>{k}</code> {label}
                    </label>
                  ))}
                </fieldset>
                <button type="submit" disabled={busy || !newClient.name.trim() || newClient.scopes.length === 0}
                  className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
                  API クライアントを作る
                </button>
              </form>

              <h3 className="font-semibold text-ink-900 mb-2">Webhook</h3>
              <p className="text-sm text-ink-700 mb-2">
                配布の変更を https の URL へ知らせます。本文は配布の ID・版・件数だけで、
                <code>X-TravelCanvas-Signature</code>(HMAC-SHA256)で送り主を確かめられます。
              </p>
              {createdHook?.secret && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-300 rounded-lg" role="status">
                  <p className="text-sm text-amber-900 font-medium">署名の鍵は今だけ表示されます。</p>
                  <label htmlFor="hook-secret" className="block text-sm text-ink-900 mt-1">署名の鍵</label>
                  <input id="hook-secret" readOnly value={createdHook.secret} className={`${inputClass} font-mono text-sm`} />
                </div>
              )}
              <ul className="space-y-2 mb-3">
                {hooks?.webhooks.map((h) => (
                  <li key={h.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-ink-900 break-all">{h.url}{h.revoked_at ? '(止めました)' : ''}</p>
                        <p className="text-ink-700">{h.events.map((ev) => hooks.events[ev] ?? ev).join('・')}</p>
                        <p className="text-ink-700">署名の鍵の版 {h.secret_version}
                          {h.previous_secret_valid_until ? `・${fmtDateTime(h.previous_secret_valid_until)} まで前の鍵でも署名します` : ''}</p>
                        {h.disabled_reason === 'receiver_gone' && (
                          <p className="text-red-800">受け手が「もう無い」(410)と返したため、自動で止めました。</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {!h.revoked_at && (
                          <button type="button" disabled={busy} className={`${btn} border border-gray-300 text-ink-900 hover:bg-gray-50`}
                            aria-label={`Webhook「${h.url}」へ試しに送る`}
                            onClick={() => run(async () => {
                              const d = await api.pingOrgWebhook(orgId, h.id);
                              setNotice(d.status === 'delivered' ? `届きました(${d.last_status_code})` : `届きませんでした(${d.last_status_code ?? d.last_error})`);
                              setDeliveries({ ...deliveries, [h.id]: await api.getOrgWebhookDeliveries(orgId, h.id) });
                            }, null, '送れませんでした')}>
                            試しに送る
                          </button>
                        )}
                        <button type="button" disabled={busy} className={`${btn} border border-gray-300 text-ink-900 hover:bg-gray-50`}
                          aria-label={`Webhook「${h.url}」の送信の記録`}
                          onClick={() => run(async () => setDeliveries({ ...deliveries, [h.id]: await api.getOrgWebhookDeliveries(orgId, h.id) }),
                            null, '記録を取得できませんでした')}>
                          送信の記録
                        </button>
                        {!h.revoked_at && (
                          <button type="button" disabled={busy} className={`${btn} border border-gray-300 text-ink-900 hover:bg-gray-50`}
                            aria-label={`Webhook「${h.url}」の署名の鍵を切り替える`}
                            onClick={() => run(async () => setCreatedHook(await api.rotateOrgWebhookSecret(orgId, h.id, graceHours)),
                              null, '署名の鍵を切り替えられませんでした')}>
                            鍵を切り替える
                          </button>
                        )}
                        {!h.revoked_at && h.previous_secret_valid_until && (
                          <button type="button" disabled={busy} className={`${btn} border border-amber-400 text-amber-900 hover:bg-amber-50`}
                            aria-label={`Webhook「${h.url}」の前の鍵での署名をやめる`}
                            onClick={() => run(() => api.retireOrgWebhookPrevious(orgId, h.id), '前の鍵での署名をやめました',
                              'やめられませんでした')}>
                            前の鍵をやめる
                          </button>
                        )}
                        {!h.revoked_at && (
                          <button type="button" disabled={busy} className={`${btn} border border-red-300 text-red-800 hover:bg-red-50`}
                            aria-label={`Webhook「${h.url}」を止める`}
                            onClick={() => run(() => api.revokeOrgWebhook(orgId, h.id), 'Webhook を止めました', '止められませんでした')}>
                            止める
                          </button>
                        )}
                      </div>
                    </div>
                    {deliveries[h.id] && (
                      <ul className="mt-2 space-y-1" aria-label={`Webhook「${h.url}」の送信の記録`}>
                        {deliveries[h.id]!.length === 0 && <li className="text-ink-700">まだ送っていません。</li>}
                        {deliveries[h.id]!.map((d) => (
                          <li key={d.id} className="flex items-center justify-between gap-2 text-ink-900">
                            <span>
                              {d.event_type}・{DELIVERY_LABEL[d.status]}
                              {d.last_status_code ? `(${d.last_status_code})` : d.last_error ? `(${d.last_error})` : ''}・{d.attempts}/{d.max_attempts}回・{fmtDateTime(d.created_at)}
                              {d.next_attempt_at ? `・次の自動の再送 ${fmtDateTime(d.next_attempt_at)}` : ''}
                            </span>
                            {(d.status === 'failed' || d.status === 'dead') && !h.revoked_at && (
                              <button type="button" disabled={busy} className="text-blue-800 underline"
                                onClick={() => run(async () => {
                                  await api.redeliverOrgWebhook(orgId, h.id, d.id);
                                  setDeliveries({ ...deliveries, [h.id]: await api.getOrgWebhookDeliveries(orgId, h.id) });
                                }, '送り直しました', '送り直せませんでした')}>
                                送り直す
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
              <form className="space-y-2" onSubmit={(e) => {
                e.preventDefault();
                run(async () => setCreatedHook(await api.createOrgWebhook(orgId, newHook)), null, 'Webhook を登録できませんでした')
                  .then(() => setNewHook({ ...newHook, url: '' }));
              }}>
                <div>
                  <label htmlFor="hook-url" className="block text-sm font-medium text-ink-900 mb-1">送り先の URL(https)</label>
                  <input id="hook-url" type="url" value={newHook.url} required placeholder="https://"
                    onChange={(e) => setNewHook({ ...newHook, url: e.target.value })} className={inputClass} />
                </div>
                <fieldset>
                  <legend className="text-sm font-medium text-ink-900">知らせるできごと</legend>
                  {Object.entries(hooks?.events ?? {}).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 text-sm text-ink-900">
                      <input type="checkbox" checked={newHook.events.includes(k as OrgWebhookEvent)}
                        onChange={() => setNewHook({ ...newHook, events: toggle(newHook.events, k as OrgWebhookEvent) })} />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <button type="submit" disabled={busy || !newHook.url || newHook.events.length === 0}
                  className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
                  Webhook を登録する
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default OrganizationPage;
