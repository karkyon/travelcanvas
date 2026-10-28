/**
 * [Gate A1] 共通interceptorの挙動を、実際のaxios処理経路(adapterのみ差し替え)で検証する。
 *
 * - skipGlobalErrorHandler指定の401では、toast表示・トークン破棄・/loginへの強制遷移をしない
 *   (ログイン画面で誤ったパスワードを入れても画面が再読込されない)
 * - 指定なしの401では従来どおり共通処理が動く(=このテストが抑止を検出できることの対照)
 * - silentな /auth/me がaccess token期限切れで401になった場合、refreshを1回試み、
 *   refreshも失敗したら共通処理なしで呼び出し元へ失敗を返す
 * - 呼び出し元が明示したAuthorizationを、保持中のトークンで上書きしない
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type AxiosAdapter, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { toast } from 'react-hot-toast';
import { ApiCore } from './core';

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

class TestCore extends ApiCore {
  get http(): AxiosInstance {
    return this.client;
  }
}

type Seen = { url: string; authorization: unknown; skip: unknown };

function reject(config: InternalAxiosRequestConfig, status: number, data: unknown): never {
  throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    status, statusText: '', data, headers: {}, config,
  });
}

function install(core: TestCore, handler: (config: InternalAxiosRequestConfig) => unknown): Seen[] {
  const seen: Seen[] = [];
  const adapter: AxiosAdapter = async (config) => {
    seen.push({
      url: config.url ?? '',
      authorization: config.headers?.Authorization,
      skip: config.skipGlobalErrorHandler,
    });
    const data = handler(config);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  core.http.defaults.adapter = adapter;
  return seen;
}

const originalLocation = window.location;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/login' } });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('skipGlobalErrorHandler (Gate A1)', () => {
  it('指定ありの401ではtoast・トークン破棄・/loginへの強制遷移をしない', async () => {
    const core = new TestCore();
    core.setAccessToken('member-token');
    install(core, (config) => reject(config, 401, { detail: 'メールアドレスまたはパスワードが正しくありません' }));

    await expect(
      core.http.post('/auth/login', { email: 'a', password: 'b' }, { skipGlobalErrorHandler: true })
    ).rejects.toBeInstanceOf(AxiosError);

    expect(toast.error).not.toHaveBeenCalled();
    expect(window.location.href).toBe('http://localhost/login');
    // [Gate S5] 会員のトークンは端末に保存しない(メモリだけ)。401 でも破棄しない
    expect(core.hasAccessToken()).toBe(true);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('指定なしの401では従来どおり共通処理が動く(対照)', async () => {
    const core = new TestCore();
    install(core, (config) => reject(config, 401, { detail: 'x' }));

    await expect(core.http.get('/plans')).rejects.toBeInstanceOf(AxiosError);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/login');
  });

  it('silentな/auth/meの401ではrefreshを1回試み、失敗しても共通処理をしない', async () => {
    const core = new TestCore();
    core.setAccessToken('expired-token');
    const seen = install(core, (config) => reject(config, 401, { detail: 'expired' }));

    await expect(core.http.get('/auth/me', { skipGlobalErrorHandler: true })).rejects.toBeInstanceOf(AxiosError);

    expect(seen.map((s) => s.url)).toEqual(['/auth/me', '/auth/refresh']);
    expect(seen[1]?.skip).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(window.location.href).toBe('http://localhost/login');
  });

  it('silentな/auth/meはrefresh成功時に新しいトークンで1回だけ再試行する', async () => {
    const core = new TestCore();
    core.setAccessToken('expired-token');
    let meCalls = 0;
    const seen = install(core, (config) => {
      if (config.url === '/auth/refresh') return { access_token: 'fresh-token' };
      meCalls += 1;
      if (meCalls === 1) return reject(config, 401, { detail: 'expired' });
      return { id: 'u1' };
    });

    const response = await core.http.get('/auth/me', { skipGlobalErrorHandler: true });

    expect(response.data).toEqual({ id: 'u1' });
    expect(seen.map((s) => [s.url, s.authorization])).toEqual([
      ['/auth/me', 'Bearer expired-token'],
      ['/auth/refresh', 'Bearer expired-token'],
      ['/auth/me', 'Bearer fresh-token'],
    ]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('Authorizationヘッダー (Gate A1)', () => {
  it('呼び出し元が明示したAuthorizationを保持中のトークンで上書きしない', async () => {
    const core = new TestCore();
    core.setAccessToken('stored-token');
    const seen = install(core, () => ({}));

    await core.http.post('/auth/guest/upgrade', {}, { headers: { Authorization: 'Bearer guest-token' } });
    await core.http.get('/plans');

    expect(seen.map((s) => s.authorization)).toEqual(['Bearer guest-token', 'Bearer stored-token']);
  });

  it('トークン未保持かつ明示なしならAuthorizationを付けない', async () => {
    const core = new TestCore();
    const seen = install(core, () => ({}));

    await core.http.post('/auth/guest', undefined, { skipGlobalErrorHandler: true });

    expect(seen[0]?.authorization).toBeUndefined();
  });
});

describe('アカウントの削除の後の 401 (Gate G10-Q)', () => {
  it('suppressAuthRedirect の間・削除の完了の画面では /login へ強制的に移さない(戻すと従来どおり)', async () => {
    const core = new TestCore();
    install(core, (config) => reject(config, 401, { detail: 'x' }));
    core.suppressAuthRedirect();
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/settings/data', pathname: '/settings/data' } });
    await expect(core.http.get('/notifications/unread-count')).rejects.toBeInstanceOf(AxiosError);
    expect(window.location.href).toBe('http://localhost/settings/data');

    core.suppressAuthRedirect(false);
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/account-deleted', pathname: '/account-deleted' } });
    await expect(core.http.get('/notifications/unread-count')).rejects.toBeInstanceOf(AxiosError);
    expect(window.location.href).toBe('http://localhost/account-deleted');

    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/planner', pathname: '/planner' } });
    await expect(core.http.get('/plans')).rejects.toBeInstanceOf(AxiosError);
    expect(window.location.href).toBe('/login');
  });
});

describe('端末に溜める書き込みの通信の失敗 (Gate G10-UX)', () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it('offlineQueueable の応答の無い失敗では共通の「ネットワークエラー」を出さない(呼び出し側が端末に溜めて伝える)', async () => {
    const core = new TestCore();
    core.http.defaults.adapter = async (config) => { throw new AxiosError('Network Error', 'ERR_NETWORK', config); };
    await expect(core.http.delete('/plans/p/events/e', { offlineQueueable: true })).rejects.toMatchObject({ code: 'ERR_NETWORK' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('対照: 指定なしの通信の失敗・指定ありでもサーバーが答えた失敗は従来どおり共通の表示を出す', async () => {
    const core = new TestCore();
    core.http.defaults.adapter = async (config) => { throw new AxiosError('Network Error', 'ERR_NETWORK', config); };
    await expect(core.http.delete('/plans/p/events/e')).rejects.toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith('ネットワークエラーが発生しました。接続を確認してください。');
    vi.mocked(toast.error).mockClear();
    core.http.defaults.adapter = async (config) => reject(config, 500, {});
    await expect(core.http.delete('/plans/p/events/e', { offlineQueueable: true })).rejects.toBeTruthy();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
