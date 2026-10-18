/**
 * [Gate S11] 多要素認証(SEC-06)の APIクライアント。送信先・本文・共通エラー処理を通さない指定と、
 * 応答の decoder 検証(ログインの応答は「確認コード待ち」と「完了」を見分ける)を固定する。
 */
import { describe, it, expect } from 'vitest';
import axios, { type AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, AuthApiError } from './index';
import { decodeResponse } from './decode';
import { loginResult, mfaSetup, mfaStatus } from './decoders';
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

function failWith(status: number, detail: unknown) {
  const error = new axios.AxiosError('x', 'ERR', undefined, undefined, {
    status, data: { detail }, statusText: '', headers: {}, config: { headers: {} } as never,
  });
  const reject = async () => {
    throw error;
  };
  api.setHttpClientForTesting({ get: reject, post: reject } as Partial<MinimalHttpClient>);
}

describe('多要素認証 APIクライアント (Gate S11)', () => {
  it('ログインの応答: 確認コード待ちとログイン完了を見分ける', async () => {
    respondWith(fx.login_mfa_challenge);
    const pending = await api.login({ email: 'a@example.com', password: 'p' });
    expect('mfa_required' in pending && pending.mfa_token).toBe('fixture.mfa.token');
    respondWith(fx.mfa_verify);
    const done = await api.login({ email: 'a@example.com', password: 'p' });
    expect('access_token' in done && done.user.user_type).toBe('registered');
    expect(() => decodeResponse({ ...fx.login_mfa_challenge, mfa_required: 'yes' }, loginResult, 'x')).toThrow();
  });

  it('2段目・状態・設定・有効化・無効化・作り直し・確認の送信先と本文', async () => {
    let calls = respondWith(fx.mfa_verify);
    await api.verifyMfaLogin('tok', '123456');
    expect(calls[0]).toMatchObject({
      url: '/auth/mfa/verify', data: { mfa_token: 'tok', code: '123456' }, config: { skipGlobalErrorHandler: true },
    });
    calls = respondWith(fx.mfa_status_enabled);
    expect((await api.getMfaStatus()).enabled).toBe(true);
    expect(calls[0]).toMatchObject({ url: '/auth/mfa', method: 'GET' });
    calls = respondWith(fx.mfa_setup);
    expect((await api.setupMfa('pw')).secret).toBe('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    expect(calls[0]).toMatchObject({ url: '/auth/mfa/setup', data: { current_password: 'pw' } });
    calls = respondWith(fx.mfa_recovery_codes);
    expect((await api.enableMfa('111111')).recovery_codes).toHaveLength(10);
    expect(calls[0]).toMatchObject({ url: '/auth/mfa/enable', data: { code: '111111' } });
    calls = respondWith({ enabled: false });
    await api.disableMfa('pw', '222222');
    expect(calls[0]).toMatchObject({ url: '/auth/mfa/disable', data: { current_password: 'pw', code: '222222' } });
    calls = respondWith(fx.mfa_recovery_codes);
    await api.regenerateRecoveryCodes('pw', '333333');
    expect(calls[0]).toMatchObject({ url: '/auth/mfa/recovery-codes' });
    calls = respondWith(fx.mfa_status_enabled);
    await api.stepUpMfa('444444');
    expect(calls[0]).toMatchObject({ url: '/auth/mfa/step-up', data: { code: '444444' } });
  });

  it('秘密と URI の形を検査する', () => {
    const bad = (patch: Record<string, unknown>) => () => decodeResponse({ ...fx.mfa_setup, ...patch }, mfaSetup, 'x');
    expect(bad({ secret: 'not base32!' })).toThrow(/\$\.secret/);
    expect(bad({ otpauth_uri: 'https://example.com/' })).toThrow(/\$\.otpauth_uri/);
    expect(() => decodeResponse({ ...fx.mfa_status_enabled, recovery_codes_remaining: -1 }, mfaStatus, 'x')).toThrow();
  });

  it('失敗は理由のコードと文言を持つ AuthApiError になる', async () => {
    failWith(400, { code: 'mfa_invalid_code', message: '確認コードが正しくないか、すでに使われています' });
    const error = await api.verifyMfaLogin('tok', '000000').catch((e) => e);
    expect(error).toBeInstanceOf(AuthApiError);
    expect(error).toMatchObject({ status: 400, code: 'mfa_invalid_code', message: '確認コードが正しくないか、すでに使われています' });
  });
});
