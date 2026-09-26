/**
 * [Gate B-012] 削除済みプランAPIのクライアント。送信内容(URL・メソッド)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import fx from './__fixtures__/backendContractResponses.json';
import { ApiDecodeError } from './decode';
import { api, getDeletedPlans, purgePlan, restorePlan } from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const make = (method: string) => async (url: string) => {
    calls.push({ url, method });
    return { data };
  };
  const client: Partial<MinimalHttpClient> = { get: make('GET'), post: make('POST'), delete: make('DELETE') };
  api.setHttpClientForTesting(client);
  return calls;
}

describe('削除済みプランAPIクライアント (Gate B-012)', () => {
  it('削除は DELETE /travel-plans/{id} で、完全削除の予定日時を含む応答を検証する', async () => {
    let calls = respondWith(fx.plan_soft_deleted);
    await expect(api.deletePlan('p1')).resolves.toMatchObject({ success: true });
    expect(calls).toEqual([{ url: '/travel-plans/p1', method: 'DELETE' }]);
    calls = respondWith({ message: 'ok' });
    await expect(api.deletePlan('p1')).rejects.toThrow(/\$\.deleted_at/);
    expect(calls).toHaveLength(1);
  });

  it('一覧は GET /travel-plans/deleted で、復元期限(purge_after)を必須とする', async () => {
    const calls = respondWith(fx.deleted_plan_list);
    await expect(getDeletedPlans()).resolves.toEqual(fx.deleted_plan_list);
    expect(calls).toEqual([{ url: '/travel-plans/deleted', method: 'GET' }]);
    respondWith([{ ...fx.deleted_plan_list[0], purge_after: null }]);
    await expect(getDeletedPlans()).rejects.toThrow(/\$\[0\]\.purge_after/);
    respondWith({ detail: 'x' });
    await expect(getDeletedPlans()).rejects.toBeInstanceOf(ApiDecodeError);
  });

  it('復元は POST /travel-plans/{id}/restore、完全削除は DELETE /travel-plans/{id}/permanent', async () => {
    let calls = respondWith(fx.plan_restored);
    const restored = await restorePlan('p1');
    expect(calls).toEqual([{ url: '/travel-plans/p1/restore', method: 'POST' }]);
    expect(restored.data).toMatchObject({ id: fx.plan_restored.id, title: fx.plan_restored.title });
    calls = respondWith(fx.plan_purged);
    await expect(purgePlan('p1')).resolves.toEqual(fx.plan_purged);
    expect(calls).toEqual([{ url: '/travel-plans/p1/permanent', method: 'DELETE' }]);
  });
});
