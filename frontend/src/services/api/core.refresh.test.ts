/**
 * [Gate CI-429] 401 の時の更新(POST /auth/refresh)は同時に1本だけ、失敗の後は送り続けない。
 *
 * 以前は同時に 401 になった要求の数だけ更新を送り、失効したセッションの画面の定期の取得で更新が 1分 60 回を越えて 429 になり、
 * 接続元の点数(Gate S6)が積もって全ての API が 15分止まった(CI の E2E の 429 連鎖。PR #13・#15・#17・#18 の記録)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type AxiosAdapter, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { ApiCore } from './core';

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

class TestCore extends ApiCore {
  get http(): AxiosInstance {
    return this.client;
  }
}

function fail(config: InternalAxiosRequestConfig, status: number, headers: Record<string, string> = {}): never {
  throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    status, statusText: '', data: { detail: 'x' }, headers, config,
  });
}

const originalLocation = window.location;
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/planner' } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.useRealTimers();
});

function setup(refresh: (config: InternalAxiosRequestConfig) => unknown) {
  const core = new TestCore();
  core.setAccessToken('old');
  core.setMemberSession(true);
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config.url ?? '');
    if (config.url === '/auth/refresh') {
      await new Promise((r) => setTimeout(r, 5));
      return { data: refresh(config), status: 200, statusText: 'OK', headers: {}, config };
    }
    if (config.headers?.Authorization === 'Bearer new') return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
    return fail(config, 401);
  };
  core.http.defaults.adapter = adapter;
  return { core, calls };
}

describe('更新は同時に1本だけ(Gate CI-429)', () => {
  it('同時の 401 が5本でも更新は1本で、全ての要求が新しいトークンで送り直される', async () => {
    const { core, calls } = setup(() => ({ access_token: 'new' }));
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) =>
      core.http.get(`/notifications/unread-count?i=${i}`, { skipGlobalErrorHandler: true })));
    expect(results.every((r) => (r.data as { ok: boolean }).ok)).toBe(true);
    expect(calls.filter((u) => u === '/auth/refresh')).toHaveLength(1);
  });

  it('更新が 401(セッションが無効)なら、新しいトークンを得るまで更新を送らない', async () => {
    const { core, calls } = setup((config) => fail(config, 401));
    await Promise.all([1, 2, 3].map(() => core.http.get('/dashboard', { skipGlobalErrorHandler: true }).catch(() => null)));
    for (let i = 0; i < 5; i++) await core.http.get('/dashboard', { skipGlobalErrorHandler: true }).catch(() => null);
    expect(calls.filter((u) => u === '/auth/refresh')).toHaveLength(1);
    core.setAccessToken('again');  // ログインし直すと再び送れる
    await core.http.get('/dashboard', { skipGlobalErrorHandler: true }).catch(() => null);
    expect(calls.filter((u) => u === '/auth/refresh')).toHaveLength(2);
  });

  it('更新が 429 なら Retry-After の間は送らない', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
    const { core, calls } = setup((config) => fail(config, 429, { 'retry-after': '30' }));
    await core.http.get('/dashboard', { skipGlobalErrorHandler: true }).catch(() => null);
    core.setMemberSession(true);
    await core.http.get('/dashboard', { skipGlobalErrorHandler: true }).catch(() => null);
    expect(calls.filter((u) => u === '/auth/refresh')).toHaveLength(1);
    vi.setSystemTime(new Date('2026-10-29T00:00:31Z'));
    await core.http.get('/dashboard', { skipGlobalErrorHandler: true }).catch(() => null);
    expect(calls.filter((u) => u === '/auth/refresh')).toHaveLength(2);
  });
});
