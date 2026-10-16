/**
 * [Gate P17] Memory Replan(FR-057)APIのクライアント。送信内容(If-Match・input_fingerprint)と応答のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, applyMemoryReplan, getMemoryReplan } from './index';
import { decodeResponse } from './decode';
import { memoryReplanResult } from './decoders';
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

describe('Memory Replan APIクライアント (Gate P17)', () => {
  it('提案の取得と適用(If-Match・input_fingerprint)', async () => {
    let calls = respondWith(fx.memory_replan);
    const r = await getMemoryReplan('p1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/memory-replan', config: { skipGlobalErrorHandler: true } });
    expect(r.insights.map((i) => i.kind)).toEqual(['stay_longer', 'often_skipped', 'late_arrival']);
    calls = respondWith(fx.memory_replan_applied);
    await applyMemoryReplan('p1', 'prop1', 'fp1', 6);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/memory-replan/apply', data: { proposal_id: 'prop1', input_fingerprint: 'fp1' },
      config: { headers: { 'If-Match': '6' } } });
  });

  it('列挙値を厳密に検査する', () => {
    const bad = { ...fx.memory_replan, insights: [{ ...fx.memory_replan.insights[0], kind: 'ai_guess' }] };
    expect(() => decodeResponse(bad, memoryReplanResult, 'x')).toThrow(/\$\.insights\[0\]\.kind/);
    expect(decodeResponse(fx.memory_replan_empty, memoryReplanResult, 'x').sample_count).toBe(0);
  });
});
