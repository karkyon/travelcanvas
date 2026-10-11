/**
 * [Gate P9] アカウントの削除・同意の撤回(FR-039)APIのクライアント。送信内容と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, deleteAccount, getAccountDeletionPreview, getConsents, updateConsents } from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET') calls.push({ url, method, config: a as AxiosRequestConfig | undefined });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({ get: push('GET'), post: push('POST'), put: push('PUT') } as Partial<MinimalHttpClient>);
  return calls;
}

describe('アカウント削除・同意APIクライアント (Gate P9)', () => {
  it('同意の取得と、目的ごとの更新', async () => {
    let calls = respondWith(fx.privacy_consents_default);
    const s = await getConsents();
    expect(calls[0]).toMatchObject({ url: '/privacy/consents', method: 'GET', config: { skipGlobalErrorHandler: true } });
    expect(s.purposes.every((p) => p.granted === false)).toBe(true);
    calls = respondWith(fx.privacy_consents_updated);
    const u = await updateConsents({ ai_processing: true });
    expect(calls[0]).toMatchObject({ url: '/privacy/consents', method: 'PUT', data: { consents: { ai_processing: true } } });
    expect(u.purposes[0]).toMatchObject({ purpose: 'ai_processing', granted: true });
  });

  it('削除の説明と実行(パスワードはある時だけ送る)', async () => {
    let calls = respondWith(fx.account_deletion_preview);
    const p = await getAccountDeletionPreview();
    expect(calls[0]?.url).toBe('/privacy/account-deletion');
    expect(p.requires_password).toBe(true);
    expect(p.retention.items.length).toBeGreaterThan(0);
    calls = respondWith(fx.account_deletion_done);
    const r = await deleteAccount('退会する', 'pw');
    expect(calls[0]).toMatchObject({ url: '/privacy/account-deletion', method: 'POST', data: { confirmation: '退会する', password: 'pw' },
      config: { skipGlobalErrorHandler: true } });
    expect(r.deleted).toBe(true);
    calls = respondWith(fx.account_deletion_done);
    await deleteAccount('退会する');
    expect(calls[0]?.data).toEqual({ confirmation: '退会する' });
  });

  it('同意の真偽値や目的の形式が崩れた応答は拒否する', async () => {
    respondWith({ purposes: [{ ...fx.privacy_consents_default.purposes[0], granted: 'yes' }] });
    await expect(getConsents()).rejects.toThrow(/purposes\[0\]\.granted/);
    respondWith({ purposes: [{ ...fx.privacy_consents_default.purposes[0], purpose: 'tracking' }] });
    await expect(getConsents()).rejects.toThrow(/purposes\[0\]\.purpose/);
  });
});
