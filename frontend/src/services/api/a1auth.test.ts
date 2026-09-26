/**
 * [Gate A1] 認証APIのAPIクライアント一本化(B-002)。
 *
 * 以前はauthStoreが独自fetch()で /auth/* を呼び、APIクライアント側の login/register は
 * backendに存在しない応答形状を前提にした死んだ実装だった。ここでは
 * - 実backendから採取した応答(__fixtures__)をdecoderで受理すること
 * - 送信するURL・メソッド・本文・ヘッダー・共通エラー処理の抑止指定
 * - 失敗応答(401/400/422・通信失敗)を画面表示用の文言へ変換すること
 * を固定する。
 */
import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import errFx from './__fixtures__/backendAuthErrorResponses.json';
import { ApiDecodeError } from './decode';
import { AuthApiError, api, authAPI } from './index';
import { toAuthApiError } from './endpoints/auth';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const client: Partial<MinimalHttpClient> = {
    get: async (url: string, config?: AxiosRequestConfig) => {
      calls.push({ url, method: 'GET', config });
      return { data };
    },
    post: async (url: string, body?: unknown, config?: AxiosRequestConfig) => {
      calls.push({ url, method: 'POST', data: body, config });
      return { data };
    },
  };
  api.setHttpClientForTesting(client);
  return calls;
}

/** 実backendの失敗応答を、axiosが投げるのと同じAxiosErrorとして返すクライアント。 */
function failWith(status: number | null, body?: unknown, code?: string): void {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  const response =
    status === null
      ? undefined
      : { status, statusText: '', data: body, headers: {}, config };
  const error = new AxiosError('Request failed', code ?? 'ERR_BAD_REQUEST', config, null, response);
  const reject = async () => {
    throw error;
  };
  api.setHttpClientForTesting({ get: reject, post: reject });
}

const SILENT = { skipGlobalErrorHandler: true };

describe('認証APIの送信内容と応答検証 (Gate A1)', () => {
  it('login: POST /auth/login へ資格情報を送り、共通エラー処理を抑止し、実応答を返す', async () => {
    const calls = respondWith(fx.auth_login);
    const credentials = { email: 'a@example.com', password: 'pw' };
    await expect(api.login(credentials)).resolves.toEqual(fx.auth_login);
    expect(calls).toEqual([{ url: '/auth/login', method: 'POST', data: credentials, config: SILENT }]);
  });

  it('register: POST /auth/register', async () => {
    const calls = respondWith(fx.auth_register);
    const data = { username: 'u', email: 'u@example.com', password: 'pw' };
    await expect(api.register(data)).resolves.toEqual(fx.auth_register);
    expect(calls).toEqual([{ url: '/auth/register', method: 'POST', data, config: SILENT }]);
  });

  it('startGuestSession: 本文なしで POST /auth/guest', async () => {
    const calls = respondWith(fx.auth_guest);
    await expect(api.startGuestSession()).resolves.toEqual(fx.auth_guest);
    expect(calls).toEqual([{ url: '/auth/guest', method: 'POST', data: undefined, config: SILENT }]);
  });

  it('upgradeGuest: ゲストトークンをAuthorizationに明示して POST /auth/guest/upgrade', async () => {
    const calls = respondWith(fx.auth_guest_upgrade);
    const data = { username: 'u', email: 'u@example.com', password: 'pw' };
    await expect(api.upgradeGuest(data, 'guest-token-1')).resolves.toEqual(fx.auth_guest_upgrade);
    expect(calls).toEqual([
      {
        url: '/auth/guest/upgrade',
        method: 'POST',
        data,
        config: { ...SILENT, headers: { Authorization: 'Bearer guest-token-1' } },
      },
    ]);
  });

  it('互換用authAPIも同じ実装を呼ぶ', async () => {
    respondWith(fx.auth_guest);
    await expect(authAPI.startGuestSession()).resolves.toEqual(fx.auth_guest);
    const calls = respondWith(fx.auth_guest_upgrade);
    await authAPI.upgradeGuest({ username: 'u', email: 'e@example.com', password: 'p' }, 'g');
    expect(calls[0]?.url).toBe('/auth/guest/upgrade');
  });

  it('getCurrentUser: silent指定時のみ共通エラー処理を抑止する(既定の呼び出しは従来どおり)', async () => {
    let calls = respondWith(fx.auth_me);
    await api.getCurrentUser({ silent: true });
    expect(calls).toEqual([{ url: '/auth/me', method: 'GET', config: SILENT }]);
    calls = respondWith(fx.auth_me);
    await api.getCurrentUser();
    expect(calls).toEqual([{ url: '/auth/me', method: 'GET', config: undefined }]);
  });

  it('旧実装が前提にしていた存在しない応答形状や想定外のuser_typeは拒否する', async () => {
    respondWith({ success: true, data: { user: fx.auth_login.user, token: { access_token: 't' } } });
    await expect(api.login({ email: 'a', password: 'b' })).rejects.toThrow(/\$\.access_token/);
    respondWith({ ...fx.auth_login, user: { ...fx.auth_login.user, user_type: 'root' } });
    await expect(api.login({ email: 'a', password: 'b' })).rejects.toBeInstanceOf(ApiDecodeError);
    respondWith({ ...fx.auth_guest, guest_id: null });
    await expect(api.startGuestSession()).rejects.toThrow(/\$\.guest_id/);
  });
});

describe('認証APIの失敗を画面表示用の文言へ変換する (Gate A1)', () => {
  it('401: backendのdetail文字列をそのまま使い、HTTPステータスを保持する', async () => {
    failWith(errFx.auth_login_401.status, errFx.auth_login_401.body);
    const error = await api.login({ email: 'a@example.com', password: 'wrong' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthApiError);
    expect((error as AuthApiError).message).toBe('メールアドレスまたはパスワードが正しくありません');
    expect((error as AuthApiError).status).toBe(401);
  });

  it('400(重複登録)もdetail文字列を使う', async () => {
    failWith(errFx.auth_register_400.status, errFx.auth_register_400.body);
    await expect(api.register({ username: 'u', email: 'e@example.com', password: 'p' })).rejects.toThrow(
      'このメールアドレスまたはユーザー名は既に使用されています'
    );
  });

  it('422(FastAPI標準の検証エラー配列)でも "[object Object]" ではなくmsgを表示する', async () => {
    failWith(errFx.auth_register_422.status, errFx.auth_register_422.body);
    const error = (await api
      .register({ username: 'x', email: 'not-an-email', password: 'p' })
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('value is not a valid email address');
    expect(error.message).not.toContain('[object Object]');
  });

  it('detailが無い応答はHTTPステータス付きの既定文言にする', async () => {
    failWith(500, { unexpected: true });
    await expect(api.startGuestSession()).rejects.toThrow('ゲストセッションの開始に失敗しました(HTTP 500)');
  });

  it('通信失敗・タイムアウトはステータスnullで専用の文言にする', async () => {
    failWith(null, undefined, 'ERR_NETWORK');
    const network = (await api.login({ email: 'a', password: 'b' }).catch((e: unknown) => e)) as AuthApiError;
    expect(network.message).toBe('ネットワークエラーが発生しました。接続を確認してください。');
    expect(network.status).toBeNull();
    failWith(null, undefined, 'ECONNABORTED');
    await expect(api.login({ email: 'a', password: 'b' })).rejects.toThrow('リクエストがタイムアウトしました。');
  });

  it('送信したパスワードを含むaxiosのリクエスト設定を例外に残さない', async () => {
    failWith(errFx.auth_login_401.status, errFx.auth_login_401.body);
    const error = await api.login({ email: 'a@example.com', password: 'hunter2-secret' }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(AxiosError);
    expect(JSON.stringify(error)).not.toContain('hunter2-secret');
    expect(Object.keys(error as object)).not.toContain('config');
  });

  it('AuthApiError/ApiDecodeErrorはそのまま、それ以外の例外は既定文言にする', () => {
    const auth = new AuthApiError('x', 403);
    expect(toAuthApiError(auth, 'f')).toBe(auth);
    const decode = new ApiDecodeError('e', '$', '文字列');
    expect(toAuthApiError(decode, 'f')).toBe(decode);
    const other = toAuthApiError(new TypeError('boom'), '既定');
    expect(other).toBeInstanceOf(AuthApiError);
    expect(other.message).toBe('既定');
  });
});
