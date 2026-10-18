/**
 * [Gate A1] authStoreの認証処理をAPIクライアント経由へ一本化したことの検証(B-002)。
 *
 * HTTP層だけを差し替え、store → services/api(decoder・エラー変換) の実経路を通す。
 * - 独自fetch()を一切使わない
 * - 成功時: 状態とAPIクライアントのトークン・ゲストモードを同期する(従来と同じ)
 * - 失敗時: backendのdetailを画面用エラーとして保持し、トークンは変えない
 * - console出力へアクセストークン・パスワード・メールアドレスを出さない
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import errFx from '@/services/api/__fixtures__/backendAuthErrorResponses.json';
import { api, AuthApiError } from '@/services/api';
import type { MinimalHttpClient } from '@/services/api';
import { useAuthStore } from './authStore';

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() }, default: { error: vi.fn(), success: vi.fn() } }));

const TOKEN = 'tok-SECRET-access-123';
const PASSWORD = 'pw-SECRET-456';
const EMAIL = 'secret.person@example.com';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function axiosError(status: number, body: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    status, statusText: '', data: body, headers: {}, config,
  });
}

/** URLごとの応答(値)または失敗(AxiosError)を返すHTTPクライアント。 */
function serve(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  const answer = async (url: string) => {
    if (!(url in routes)) throw new Error(`unexpected request: ${url}`);
    const value = routes[url];
    if (value instanceof AxiosError) throw value;
    return { data: value };
  };
  const client: Partial<MinimalHttpClient> = {
    get: async (url: string, config?: AxiosRequestConfig) => {
      calls.push({ url, method: 'GET', config });
      return answer(url);
    },
    post: async (url: string, data?: unknown, config?: AxiosRequestConfig) => {
      calls.push({ url, method: 'POST', data, config });
      return answer(url);
    },
  };
  api.setHttpClientForTesting(client);
  return calls;
}

const INITIAL = {
  user: null, token: null, isAuthenticated: false, isLoading: false, isInitialized: false,
  error: null, isGuest: false, guestToken: null, guestId: null,
};

let consoleText: () => string;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState(INITIAL);
  fetchSpy = vi.fn(() => Promise.reject(new Error('fetch must not be used')));
  vi.stubGlobal('fetch', fetchSpy);
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined)
  );
  consoleText = () => JSON.stringify(spies.flatMap((s) => s.mock.calls.map((args) => args.map(String))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectNoSecretsLogged(): void {
  const text = consoleText();
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toContain(EMAIL);
}

describe('authStore: login/register (Gate A1)', () => {
  it('login成功: APIクライアント経由で送信し、状態とトークンを同期する', async () => {
    const calls = serve({ '/auth/login': { ...fx.auth_login, access_token: TOKEN } });
    const setGuestMode = vi.spyOn(api, 'setGuestMode');

    await useAuthStore.getState().login(EMAIL, PASSWORD);

    expect(calls).toEqual([
      { url: '/auth/login', method: 'POST', data: { email: EMAIL, password: PASSWORD }, config: { skipGlobalErrorHandler: true } },
    ]);
    const state = useAuthStore.getState();
    expect(state).toMatchObject({ token: TOKEN, isAuthenticated: true, isLoading: false, error: null });
    expect(state.user).toEqual(fx.auth_login.user);
    // [Gate S5] 会員のアクセストークンは端末に保存しない(メモリだけ)
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(api.hasAccessToken()).toBe(true);
    expect(setGuestMode).toHaveBeenLastCalledWith(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoSecretsLogged();
  });

  it('login失敗(401): backendのdetailをerrorに保持し、AuthApiErrorを投げ、トークンを変えない', async () => {
    serve({ '/auth/login': axiosError(errFx.auth_login_401.status, errFx.auth_login_401.body) });

    const error = await useAuthStore.getState().login(EMAIL, PASSWORD).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthApiError);
    expect(useAuthStore.getState()).toMatchObject({
      token: null, isAuthenticated: false, isLoading: false,
      error: 'メールアドレスまたはパスワードが正しくありません',
    });
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoSecretsLogged();
  });

  it('register失敗(422): "[object Object]"ではなく検証メッセージを表示用エラーにする', async () => {
    serve({ '/auth/register': axiosError(errFx.auth_register_422.status, errFx.auth_register_422.body) });

    await expect(useAuthStore.getState().register('u', 'not-an-email', PASSWORD)).rejects.toBeInstanceOf(AuthApiError);

    const { error } = useAuthStore.getState();
    expect(error).toContain('value is not a valid email address');
    expect(error).not.toContain('[object Object]');
  });

  it('register成功: 状態とトークンを同期する', async () => {
    serve({ '/auth/register': { ...fx.auth_register, access_token: TOKEN } });

    await useAuthStore.getState().register('reg', EMAIL, PASSWORD);

    expect(useAuthStore.getState()).toMatchObject({ token: TOKEN, isAuthenticated: true, user: fx.auth_register.user });
    expect(localStorage.getItem('auth_token')).toBeNull();
    expectNoSecretsLogged();
  });

  it('応答形式が想定外なら状態を変えずに失敗する', async () => {
    serve({ '/auth/login': { access_token: TOKEN } });

    await expect(useAuthStore.getState().login(EMAIL, PASSWORD)).rejects.toThrow(/\$\.token_type/);

    expect(useAuthStore.getState()).toMatchObject({ token: null, isAuthenticated: false, isLoading: false });
    expect(useAuthStore.getState().error).toMatch(/POST \/auth\/login/);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });
});

describe('authStore: ゲスト開始・昇格 (Gate A1)', () => {
  it('startGuestSession: ゲスト状態・ゲストモードを設定する', async () => {
    serve({ '/auth/guest': { ...fx.auth_guest, access_token: TOKEN } });
    const setGuestMode = vi.spyOn(api, 'setGuestMode');

    await useAuthStore.getState().startGuestSession();

    expect(useAuthStore.getState()).toMatchObject({
      isGuest: true, guestToken: TOKEN, guestId: fx.auth_guest.guest_id, isAuthenticated: true, token: null,
    });
    expect(localStorage.getItem('auth_token')).toBe(TOKEN);
    expect(setGuestMode).toHaveBeenLastCalledWith(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoSecretsLogged();
  });

  it('upgradeGuest: ゲストトークンを明示して昇格し、正式アカウントの状態へ切り替える', async () => {
    useAuthStore.setState({ isGuest: true, guestToken: 'guest-token-1', guestId: 'g1', isAuthenticated: true });
    const calls = serve({ '/auth/guest/upgrade': { ...fx.auth_guest_upgrade, access_token: TOKEN } });
    const setGuestMode = vi.spyOn(api, 'setGuestMode');

    await useAuthStore.getState().upgradeGuest('up', EMAIL, PASSWORD);

    expect(calls[0]).toMatchObject({
      url: '/auth/guest/upgrade',
      data: { username: 'up', email: EMAIL, password: PASSWORD },
      config: { skipGlobalErrorHandler: true, headers: { Authorization: 'Bearer guest-token-1' } },
    });
    expect(useAuthStore.getState()).toMatchObject({
      isGuest: false, guestToken: null, guestId: null, token: TOKEN, isAuthenticated: true,
      user: fx.auth_guest_upgrade.user,
    });
    expect(setGuestMode).toHaveBeenLastCalledWith(false);
    expectNoSecretsLogged();
  });

  it('upgradeGuest: ゲストトークンが無ければ通信せずにエラーにする', async () => {
    const calls = serve({});

    await expect(useAuthStore.getState().upgradeGuest('up', EMAIL, PASSWORD)).rejects.toThrow(
      'ゲストセッションが見つかりません'
    );

    expect(calls).toEqual([]);
    expect(useAuthStore.getState().error).toMatch(/ゲストセッションが見つかりません/);
  });

  it('upgradeGuest失敗(400)でもゲスト状態を保つ', async () => {
    useAuthStore.setState({ isGuest: true, guestToken: 'guest-token-1', guestId: 'g1', isAuthenticated: true });
    serve({ '/auth/guest/upgrade': axiosError(errFx.auth_register_400.status, errFx.auth_register_400.body) });

    await expect(useAuthStore.getState().upgradeGuest('up', EMAIL, PASSWORD)).rejects.toBeInstanceOf(AuthApiError);

    expect(useAuthStore.getState()).toMatchObject({
      isGuest: true, guestToken: 'guest-token-1', token: null,
      error: 'このメールアドレスまたはユーザー名は既に使用されています',
    });
  });
});

describe('authStore: checkAuth (Gate A1)', () => {
  it('GET /auth/me をsilentで呼び、decoder検証済みのユーザーで状態を更新する', async () => {
    useAuthStore.setState({ token: TOKEN });
    const calls = serve({ '/auth/me': fx.auth_me });

    await useAuthStore.getState().checkAuth();

    expect(calls).toEqual([{ url: '/auth/me', method: 'GET', config: { skipGlobalErrorHandler: true } }]);
    expect(useAuthStore.getState()).toMatchObject({ user: fx.auth_me, isAuthenticated: true, isInitialized: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoSecretsLogged();
  });

  it('失敗時は認証状態とトークンをクリアする(従来どおり)', async () => {
    useAuthStore.setState({ token: TOKEN, isAuthenticated: true });
    serve({ '/auth/me': axiosError(401, { detail: 'Could not validate credentials' }) });

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState()).toMatchObject({ user: null, token: null, isAuthenticated: false, isInitialized: true });
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('ログインしていなければ(トークンも利用者も無い)通信しない', async () => {
    const calls = serve({});
    await useAuthStore.getState().checkAuth();
    expect(calls).toEqual([]);
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, isInitialized: true });
  });
});

describe('authStore: clearLocalSession (Gate P9)', () => {
  it('アカウント削除後: 通信せずにログイン状態・ゲスト状態・トークンを消す', () => {
    const calls = serve({});
    localStorage.setItem('auth_token', TOKEN);
    useAuthStore.setState({ token: TOKEN, isAuthenticated: true, isGuest: true, guestToken: TOKEN, guestId: 'g1' });
    useAuthStore.getState().clearLocalSession();
    expect(calls).toEqual([]);
    expect(useAuthStore.getState()).toMatchObject({
      user: null, token: null, isAuthenticated: false, isGuest: false, guestToken: null, guestId: null,
    });
    expect(localStorage.getItem('auth_token')).toBeNull();
  });
});


describe('authStore: 会員のトークンを端末に保存しない (Gate S5 / F15)', () => {
  const STORAGE_KEY = 'auth-storage';
  const persisted = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').state ?? {};

  it('ログイン後に保存される内容にアクセストークンが無い', async () => {
    serve({ '/auth/login': { ...fx.auth_login, access_token: TOKEN } });
    await useAuthStore.getState().login(EMAIL, PASSWORD);
    expect(persisted()).not.toHaveProperty('token');
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(TOKEN);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('ゲストのトークンは保存する(cookie の更新鍵が無いため)', async () => {
    serve({ '/auth/guest': { ...fx.auth_guest, access_token: TOKEN } });
    await useAuthStore.getState().startGuestSession();
    expect(persisted()).toMatchObject({ guestToken: TOKEN, isGuest: true });
    expect(localStorage.getItem('auth_token')).toBe(TOKEN);
  });

  it('再読込の後(利用者だけが残っている): cookie でトークンを取り直してから初期化を終える', async () => {
    useAuthStore.setState({ user: fx.auth_login.user, isAuthenticated: true, token: null });
    const calls = serve({ '/auth/refresh': { ...fx.auth_login, access_token: TOKEN } });
    await useAuthStore.getState().initialize();
    expect(calls).toEqual([
      { url: '/auth/refresh', method: 'POST', data: undefined, config: { skipGlobalErrorHandler: true } },
    ]);
    expect(useAuthStore.getState()).toMatchObject({ token: TOKEN, isAuthenticated: true, isInitialized: true });
    expect(api.hasAccessToken()).toBe(true);
    expect(localStorage.getItem('auth_token')).toBeNull();
    expectNoSecretsLogged();
  });

  it('cookie のログインが切れていれば(401)ログアウトした状態にする', async () => {
    useAuthStore.setState({ user: fx.auth_login.user, isAuthenticated: true, token: null });
    serve({ '/auth/refresh': axiosError(401, { detail: 'セッションが無効です。再度ログインしてください。' }) });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user: null, token: null, isAuthenticated: false, isInitialized: true });
  });

  it('通信できない時(オフライン)はログイン中のまま続ける(保存したデータを開けるように)', async () => {
    useAuthStore.setState({ user: fx.auth_login.user, isAuthenticated: true, token: null });
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    serve({ '/auth/refresh': new AxiosError('Network Error', 'ERR_NETWORK', config) });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({
      user: fx.auth_login.user, token: null, isAuthenticated: true, isInitialized: true,
    });
  });

  it('同時に何度初期化しても、更新は1回だけ送る', async () => {
    useAuthStore.setState({ user: fx.auth_login.user, isAuthenticated: true, token: null });
    const calls = serve({ '/auth/refresh': { ...fx.auth_login, access_token: TOKEN } });
    await Promise.all([useAuthStore.getState().initialize(), useAuthStore.getState().initialize()]);
    expect(calls.filter((c) => c.url === '/auth/refresh')).toHaveLength(1);
  });

  it('以前の版が保存した会員のトークンは読み込み時に捨てる', async () => {
    localStorage.setItem('auth_token', 'old-member-token');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { user: fx.auth_login.user, token: 'old-member-token', isAuthenticated: true, isGuest: false }, version: 0,
    }));
    serve({ '/auth/refresh': { ...fx.auth_login, access_token: TOKEN } });
    await useAuthStore.persist.rehydrate();
    expect(useAuthStore.getState().token).not.toBe('old-member-token');
    await useAuthStore.getState().initialize();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('old-member-token');
    expect(useAuthStore.getState().token).toBe(TOKEN);
  });
});
