/**
 * [Gate P14] 旅の振り返り(FR-054・FR-053)APIのクライアント。送信内容(URL・If-Match・共通エラー処理を通さない指定)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, carryOverEvent, deleteEventActual, getJourney, putEventActual } from './index';
import { decodeResponse } from './decode';
import { journeyReview } from './decoders';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET' || method === 'DELETE') calls.push({ url, method, config: a as AxiosRequestConfig });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({
    get: push('GET'), post: push('POST'), put: push('PUT'), delete: push('DELETE'),
  } as Partial<MinimalHttpClient>);
  return calls;
}

describe('旅の振り返りAPIクライアント (Gate P14)', () => {
  it('振り返り・実績の記録(初回はIf-Match無し、変更は実績のrevision)・削除・戻す', async () => {
    let calls = respondWith(fx.journey_with_suggestions);
    const j = await getJourney('p1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/journey', config: { skipGlobalErrorHandler: true } });
    expect(j.days[0]!.events[0]!.suggestion?.basis).toBe('track');
    calls = respondWith(fx.event_actual_visited);
    await putEventActual('p1', 'e1', { status: 'visited' });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/journey/events/e1', method: 'PUT', config: { skipGlobalErrorHandler: true } });
    expect(calls[0]!.config?.headers).toBeUndefined();
    calls = respondWith(fx.event_actual_skipped);
    await putEventActual('p1', 'e1', { status: 'skipped' }, 2);
    expect(calls[0]!.config).toMatchObject({ headers: { 'If-Match': '2' } });
    calls = respondWith(undefined);
    await deleteEventActual('p1', 'e1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/journey/events/e1', method: 'DELETE' });
    calls = respondWith(fx.event_carry_over);
    await carryOverEvent('p1', 'e1', 'p2', 'd2');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/journey/events/e1/carry-over', data: { target_plan_id: 'p2', target_day_id: 'd2' } });
  });

  it('指標の分母0はnullで受け取り、列挙値を厳密に検査する', () => {
    expect(decodeResponse(fx.journey_empty, journeyReview, 'x').metrics.plan_achievement_rate).toBeNull();
    const ev = fx.journey_recorded.days[0]!.events[0]!;
    const bad = { ...fx.journey_recorded, days: [{ ...fx.journey_recorded.days[0], events: [{ ...ev, actual: { ...ev.actual, status: 'maybe' } }] }] };
    expect(() => decodeResponse(bad, journeyReview, 'x')).toThrow(/actual\.status/);
  });
});
