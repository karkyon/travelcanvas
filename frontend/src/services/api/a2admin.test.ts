/**
 * [Gate A2] 管理・監査(FR-040)の APIクライアント。送信先・問い合わせの値と、応答の形の検査を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, getAdminUser, getAdminUsers, getAuditLogs, manageAdminUsers } from './index';
import { decodeResponse } from './decode';
import { auditLogPage } from './decoders';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET') calls.push({ url, method, config: a as AxiosRequestConfig });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({ get: push('GET'), post: push('POST') } as Partial<MinimalHttpClient>);
  return calls;
}

describe('管理・監査 APIクライアント (Gate A2)', () => {
  it('一覧は空の条件を送らない。詳細・操作', async () => {
    let calls = respondWith(fx.admin_users);
    const page = await getAdminUsers({ page: 1, search: 'a@example.com', user_type: '', status: undefined });
    expect(page.users[0]).toMatchObject({ is_admin: false, is_self: false });
    expect(calls[0]).toMatchObject({ url: '/admin/users', config: { params: { page: 1, search: 'a@example.com' }, skipGlobalErrorHandler: true } });
    calls = respondWith(fx.admin_user_detail);
    expect((await getAdminUser('u1')).mfa_enabled).toBe(false);
    calls = respondWith(fx.admin_manage_suspend);
    expect((await manageAdminUsers('suspend', ['u2'])).updated_count).toBe(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/admin/users/manage', data: { action: 'suspend', user_ids: ['u2'] } });
  });

  it('監査ログは絞り込みを送り、接続元は伏せた値のまま受け取る', async () => {
    const calls = respondWith(fx.admin_audit_logs);
    const res = await getAuditLogs({ action: 'capture_a2', page: 2 });
    expect(res.audit_logs[0]!.ip_address).toBe('203.0.113.x');
    expect(calls[0]!.config).toMatchObject({ params: { action: 'capture_a2', page: 2 } });
    expect(() => decodeResponse({ ...fx.admin_audit_logs, actions: 'x' }, auditLogPage, 'x')).toThrow();
  });
});
