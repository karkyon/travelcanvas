/**
 * [Gate P11] オフライン同期(FR-033)APIのクライアント。送信内容(URL・If-Match・共通エラー処理を通さない指定)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, getSyncConflicts, resolveSyncConflict, syncOperations } from './index';
import { decodeResponse } from './decode';
import { syncResponse } from './decoders';
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

describe('オフライン同期APIクライアント (Gate P11)', () => {
  it('操作の送信・競合の一覧・解決', async () => {
    let calls = respondWith(fx.sync_applied);
    const op = { operation_id: 'o1', entity_type: 'event' as const, action: 'delete' as const, entity_id: 'e1', base_revision: 3 };
    const res = await syncOperations('p1', [op], 'dev-1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/sync', method: 'POST', data: { device_id: 'dev-1', operations: [op] },
      config: { skipGlobalErrorHandler: true } });
    expect(res.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
    calls = respondWith(fx.sync_conflicts);
    expect((await getSyncConflicts('p1')).conflicts).toHaveLength(2);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/sync/conflicts', method: 'GET' });
    calls = respondWith(fx.sync_resolved_mine);
    await resolveSyncConflict('p1', 'o1', 'use_mine', 9);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/sync/conflicts/o1/resolve', data: { resolution: 'use_mine' },
      config: { headers: { 'If-Match': '9' } } });
    calls = respondWith(fx.sync_resolved_server);
    await resolveSyncConflict('p1', 'o2', 'keep_server');
    expect(calls[0]!.config).toEqual({ skipGlobalErrorHandler: true });
  });

  it('操作ごとの結果の列挙値を厳密に検査する', () => {
    expect(decodeResponse(fx.sync_replayed, syncResponse, 'x').summary.already_applied).toBe(3);
    const bad = { ...fx.sync_applied, results: [{ ...fx.sync_applied.results[0], status: 'done' }] };
    expect(() => decodeResponse(bad, syncResponse, 'x')).toThrow(/\$\.results\[0\]\.status/);
  });
});
