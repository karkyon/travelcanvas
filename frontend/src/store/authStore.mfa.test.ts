/**
 * [Gate S11] 多要素認証のログイン(2段目)。パスワードが正しくても、確認コードを通すまでログインしない。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import { api, AuthApiError } from '@/services/api';
import type { MinimalHttpClient } from '@/services/api';
import { useAuthStore } from './authStore';

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() }, default: { error: vi.fn(), success: vi.fn() } }));

function axiosError(status: number, body: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    status, statusText: '', data: body, headers: {}, config,
  });
}

function serve(routes: Record<string, unknown>) {
  const calls: Array<{ url: string; data?: unknown }> = [];
  const post = async (url: string, data?: unknown) => {
    calls.push({ url, data });
    const value = routes[url];
    if (value instanceof AxiosError) throw value;
    if (value === undefined) throw new Error(`unexpected ${url}`);
    return { data: value };
  };
  api.setHttpClientForTesting({ post } as Partial<MinimalHttpClient>);
  return calls;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  api.clearAccessToken();
  useAuthStore.setState({
    user: null, token: null, isAuthenticated: false, isLoading: false, isInitialized: true, error: null,
    isGuest: false, guestToken: null, guestId: null, pendingMfa: null,
  });
});

describe('authStore: 多要素認証 (Gate S11)', () => {
  it('確認コード待ちではログインせず、2段目でログインする', async () => {
    const calls = serve({ '/auth/login': fx.login_mfa_challenge, '/auth/mfa/verify': fx.mfa_verify });
    expect(await useAuthStore.getState().login('a@example.com', 'pw')).toBe('mfa');
    let state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(api.hasAccessToken()).toBe(false);
    expect(state.pendingMfa?.token).toBe('fixture.mfa.token');

    await useAuthStore.getState().verifyMfa('123456');
    state = useAuthStore.getState();
    expect(state).toMatchObject({ isAuthenticated: true, token: 'fixture.access.token', pendingMfa: null });
    expect(calls[1]).toEqual({ url: '/auth/mfa/verify', data: { mfa_token: 'fixture.mfa.token', code: '123456' } });
    // 入力待ちの合図は端末に保存しない
    expect(localStorage.getItem('auth-storage') ?? '').not.toContain('fixture.mfa.token');
  });

  it('誤った確認コードは入力待ちのまま、合図が無効なら最初から', async () => {
    serve({
      '/auth/login': fx.login_mfa_challenge,
      '/auth/mfa/verify': axiosError(400, { detail: { code: 'mfa_invalid_code', message: '確認コードが正しくないか、すでに使われています' } }),
    });
    await useAuthStore.getState().login('a@example.com', 'pw');
    await expect(useAuthStore.getState().verifyMfa('000000')).rejects.toBeInstanceOf(AuthApiError);
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, error: '確認コードが正しくないか、すでに使われています' });
    expect(useAuthStore.getState().pendingMfa).not.toBeNull();

    serve({ '/auth/mfa/verify': axiosError(401, { detail: { code: 'mfa_token_invalid', message: '確認の期限が切れました' } }) });
    await expect(useAuthStore.getState().verifyMfa('111111')).rejects.toBeInstanceOf(AuthApiError);
    expect(useAuthStore.getState().pendingMfa).toBeNull();
  });

  it('期限切れの入力待ちでは通信しない', async () => {
    const calls = serve({});
    useAuthStore.setState({ pendingMfa: { token: 't', expiresAt: Date.now() - 1 } });
    await expect(useAuthStore.getState().verifyMfa('123456')).rejects.toBeInstanceOf(AuthApiError);
    expect(calls).toEqual([]);
    expect(useAuthStore.getState().pendingMfa).toBeNull();
  });

  it('パスワードだけのログインは従来どおり完了する', async () => {
    serve({ '/auth/login': fx.auth_login });
    expect(await useAuthStore.getState().login('a@example.com', 'pw')).toBe('done');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
