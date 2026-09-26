/**
 * [Gate L2] 制約API(FR-016)のクライアント。送信内容(URL・メソッド・If-Match)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { ApiDecodeError } from './decode';
import { api, createConstraint, deleteConstraint, getConstraints, updateConstraint } from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const client: Partial<MinimalHttpClient> = {
    get: async (url: string, config?: AxiosRequestConfig) => { calls.push({ url, method: 'GET', config }); return { data }; },
    post: async (url: string, body?: unknown, config?: AxiosRequestConfig) => {
      calls.push({ url, method: 'POST', data: body, config });
      return { data };
    },
    patch: async (url: string, body?: unknown, config?: AxiosRequestConfig) => {
      calls.push({ url, method: 'PATCH', data: body, config });
      return { data };
    },
    delete: async (url: string, config?: AxiosRequestConfig) => { calls.push({ url, method: 'DELETE', config }); return { data }; },
  };
  api.setHttpClientForTesting(client);
  return calls;
}

describe('制約APIクライアント (Gate L2)', () => {
  it('一覧は GET /plans/{id}/constraints で、他人の秘匿制約(masked)も受理する', async () => {
    const calls = respondWith(fx.constraint_list_other);
    const list = await getConstraints('p1');
    expect(calls).toEqual([{ url: '/plans/p1/constraints', method: 'GET', config: undefined }]);
    expect(list).toEqual(fx.constraint_list_other);
    const masked = list.find((c) => c.visibility === 'masked');
    expect(masked).toMatchObject({ title: null, value: null, constraint_type: null, reason: null, is_mine: false });
  });

  it('作成は POST で本文をそのまま送る(Idempotency-Keyは使わない)', async () => {
    const calls = respondWith(fx.constraint_shared);
    const data = {
      title: '予算は1人5万円まで', constraint_type: 'budget_limit' as const, hardness: 'hard' as const,
      operator: 'max' as const, value: { value: 50000, unit: 'JPY' },
    };
    await expect(createConstraint('p1', data)).resolves.toEqual(fx.constraint_shared);
    expect(calls).toEqual([{ url: '/plans/p1/constraints', method: 'POST', data, config: undefined }]);
  });

  it('更新・削除は制約のrevisionをIf-Matchで送る', async () => {
    let calls = respondWith(fx.constraint_updated);
    await expect(updateConstraint('p1', 'c1', { is_active: false }, 1)).resolves.toEqual(fx.constraint_updated);
    expect(calls).toEqual([{
      url: '/plans/p1/constraints/c1', method: 'PATCH', data: { is_active: false }, config: { headers: { 'If-Match': '1' } },
    }]);
    calls = respondWith(fx.constraint_deleted);
    await expect(deleteConstraint('p1', 'c1', 2)).resolves.toEqual(fx.constraint_deleted);
    expect(calls).toEqual([{ url: '/plans/p1/constraints/c1', method: 'DELETE', config: { headers: { 'If-Match': '2' } } }]);
  });

  it('backendの許容集合外の値や欠落は形式不正として拒否する', async () => {
    respondWith([{ ...fx.constraint_shared, hardness: 'medium' }]);
    await expect(getConstraints('p1')).rejects.toThrow(/\$\[0\]\.hardness/);
    respondWith({ ...fx.constraint_shared, visibility: 'partial' });
    await expect(createConstraint('p1', {
      title: 't', constraint_type: 'preference', hardness: 'soft', operator: 'prefer', value: { value: 'x' },
    })).rejects.toBeInstanceOf(ApiDecodeError);
    const withoutScopeMissing: Record<string, unknown> = { ...fx.constraint_shared };
    delete withoutScopeMissing.scope_missing;
    respondWith([withoutScopeMissing]);
    await expect(getConstraints('p1')).rejects.toThrow(/scope_missing/);
  });
});
