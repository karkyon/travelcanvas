/**
 * [Gate S7] 計算の確認(428)を APIクライアントが自動で解いて、同じ要求を送り直すこと。
 * [Gate Q1] 送り直しに新しい問題が返った時は、合計3回まで解き直す。
 * 実際の axios の経路(adapter だけ差し替え)で確かめる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, type AxiosAdapter, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { toast } from 'react-hot-toast';
import { ApiCore } from './core';
import { solutionOk } from '@/utils/challengeSolver';

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

class TestCore extends ApiCore {
  get http(): AxiosInstance {
    return this.client;
  }
}

const TOKEN = 'eyJ0ZXN0IjoxfQ.c2lnbmF0dXJl';

function challenge(config: InternalAxiosRequestConfig, token = TOKEN, difficulty = '8'): never {
  throw new AxiosError('Precondition Required', 'ERR_BAD_REQUEST', config, null, {
    status: 428,
    statusText: '',
    data: { detail: '確認のための計算が必要です。もう一度お試しください。' },
    headers: { 'x-tc-challenge': token, 'x-tc-challenge-difficulty': difficulty },
    config,
  });
}

type Seen = { url: string; token: unknown; solution: unknown; body: unknown };

function install(core: TestCore, handler: (config: InternalAxiosRequestConfig, n: number) => unknown): Seen[] {
  const seen: Seen[] = [];
  const adapter: AxiosAdapter = async (config) => {
    seen.push({
      url: config.url ?? '',
      token: config.headers?.['X-TC-Challenge'],
      solution: config.headers?.['X-TC-Challenge-Solution'],
      body: config.data,
    });
    const data = handler(config, seen.length);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  core.http.defaults.adapter = adapter;
  return seen;
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
});

describe('計算の確認 (Gate S7)', () => {
  it('428 の問題を解き、同じ本文で1回だけ送り直す', async () => {
    const core = new TestCore();
    const seen = install(core, (config, n) => (n === 1 ? challenge(config) : { access_token: 'ok' }));

    const res = await core.http.post('/auth/login', { email: 'a@example.com', password: 'x' }, { skipGlobalErrorHandler: true });

    expect(res.data).toEqual({ access_token: 'ok' });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.token).toBeUndefined();
    expect(seen[1]?.token).toBe(TOKEN);
    expect(seen[1]?.solution).toBe('284');
    expect(solutionOk(TOKEN, String(seen[1]?.solution), 8)).toBe(true);
    expect(seen[1]?.body).toBe(seen[0]?.body);
  });

  it('送り直しに同じ問題が返ったら、それ以上は繰り返さずに失敗を返す', async () => {
    const core = new TestCore();
    const seen = install(core, (config) => challenge(config));

    await expect(core.http.post('/auth/guest', undefined, { skipGlobalErrorHandler: true })).rejects.toBeInstanceOf(AxiosError);
    expect(seen).toHaveLength(2);
  });

  it('[Gate Q1] 送り直しに新しい問題が返ったら(点数が上がった・期限切れ)、解き直して通る', async () => {
    const core = new TestCore();
    const second = 'eyJ0ZXN0IjoyfQ.c2lnbmF0dXJl';
    const seen = install(core, (config, n) => {
      if (n === 1) return challenge(config);
      if (n === 2) return challenge(config, second, '9');
      return { access_token: 'ok' };
    });
    const res = await core.http.post('/auth/register', { email: 'a@example.com' }, { skipGlobalErrorHandler: true });
    expect(res.data).toEqual({ access_token: 'ok' });
    expect(seen.map((s) => s.token)).toEqual([undefined, TOKEN, second]);
    expect(solutionOk(second, String(seen[2]?.solution), 9)).toBe(true);
    expect(seen[2]?.body).toBe(seen[0]?.body);
  });

  it('[Gate Q1] 新しい問題が続いても、解くのは合計3回までで失敗を返す', async () => {
    const core = new TestCore();
    const seen = install(core, (config, n) => challenge(config, `eyJ0ZXN0IjoxfQ.c2lnbmF0dXJl${n}`, '8'));
    await expect(core.http.post('/auth/login', {}, { skipGlobalErrorHandler: true })).rejects.toBeInstanceOf(AxiosError);
    expect(seen).toHaveLength(4);
  });

  it('問題が不正(難しすぎる・形式が違う)なら解かずに失敗を返す', async () => {
    const core = new TestCore();
    const seen = install(core, (config) => challenge(config, TOKEN, '99'));
    await expect(core.http.post('/auth/guest', undefined, { skipGlobalErrorHandler: true })).rejects.toBeInstanceOf(AxiosError);
    expect(seen).toHaveLength(1);

    const core2 = new TestCore();
    const seen2 = install(core2, (config) => challenge(config, '<bad token>', '8'));
    await expect(core2.http.post('/auth/guest', undefined, { skipGlobalErrorHandler: true })).rejects.toBeInstanceOf(AxiosError);
    expect(seen2).toHaveLength(1);
  });

  it('問題の無い 428 は通常の失敗として扱う', async () => {
    const core = new TestCore();
    const seen = install(core, (config) => {
      throw new AxiosError('x', 'ERR_BAD_REQUEST', config, null, { status: 428, statusText: '', data: {}, headers: {}, config });
    });
    await expect(core.http.post('/auth/guest', undefined, { skipGlobalErrorHandler: true })).rejects.toBeInstanceOf(AxiosError);
    expect(seen).toHaveLength(1);
  });

  it('ゲスト昇格では、明示したゲストのトークンを送り直しでも保つ', async () => {
    const core = new TestCore();
    const auth: unknown[] = [];
    const adapter: AxiosAdapter = async (config) => {
      auth.push(config.headers?.Authorization);
      if (auth.length === 1) challenge(config);
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
    };
    core.http.defaults.adapter = adapter;
    await core.http.post('/auth/guest/upgrade', {}, { headers: { Authorization: 'Bearer guest-token' }, skipGlobalErrorHandler: true });
    expect(auth).toEqual(['Bearer guest-token', 'Bearer guest-token']);
  });
});
