/**
 * [Gate L4] 説明可能な最適化(FR-018)APIのクライアント。送信内容(URL・If-Match・入力の版)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, applyOptimizationCandidate, getOptimizationCandidates } from './index';
import { decodeResponse } from './decode';
import { optimizationCandidates } from './decoders';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({ post: push('POST') } as Partial<MinimalHttpClient>);
  return calls;
}

describe('説明可能な最適化APIクライアント (Gate L4)', () => {
  it('候補の計算と適用', async () => {
    let calls = respondWith(fx.optimization_candidates);
    const res = await getOptimizationCandidates('p1', 'd1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/days/d1/optimization-candidates', method: 'POST', data: { travel_mode: 'walking' } });
    expect(res.candidates.map((c) => c.kinds)).toEqual([['shortest'], ['constraints']]);
    calls = respondWith(fx.optimization_applied);
    await applyOptimizationCandidate('p1', 'd1', 'c1', 'fp', 7);
    expect(calls[0]).toMatchObject({
      url: '/plans/p1/days/d1/optimization-candidates/apply', method: 'POST',
      data: { candidate_id: 'c1', input_fingerprint: 'fp', travel_mode: 'walking' }, config: { headers: { 'If-Match': '7' } },
    });
  });

  it('候補の種類・適用可否・検証の件数を厳密に検査する', () => {
    const bad = { ...fx.optimization_candidates, can_apply: 'true' };
    expect(() => decodeResponse(bad, optimizationCandidates, 'x')).toThrow(/\$\.can_apply/);
    const c0 = fx.optimization_candidates.candidates[0]!;
    const badKind = { ...fx.optimization_candidates, candidates: [{ ...c0, kinds: ['fastest'] }] };
    expect(() => decodeResponse(badKind, optimizationCandidates, 'x')).toThrow(/\$\.candidates\[0\]\.kinds\[0\]/);
    const badCount = { ...fx.optimization_candidates, candidates: [{ ...c0, metrics: { ...c0.metrics, error: -1 } }] };
    expect(() => decodeResponse(badCount, optimizationCandidates, 'x')).toThrow(/\$\.candidates\[0\]\.metrics\.error/);
  });
});
