/**
 * [Gate P10] 外部状況(アラート)・安全な再計画(FR-030/031)APIのクライアント。送信内容(URL・If-Match)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  api, applyReplan, createAlert, createReplan, getAlerts, getReplan, rejectReplan, updateAlert,
} from './index';
import { decodeResponse } from './decode';
import { replan as replanDecoder } from './decoders';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET' || method === 'DELETE') calls.push({ url, method, config: a as AxiosRequestConfig | undefined });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({
    get: push('GET'), post: push('POST'), put: push('PUT'), patch: push('PATCH'), delete: push('DELETE'),
  } as Partial<MinimalHttpClient>);
  return calls;
}

describe('アラート・再計画APIクライアント (Gate P10)', () => {
  it('アラートの一覧・登録・変更', async () => {
    let calls = respondWith(fx.alert_list);
    const list = await getAlerts('p1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/alerts', method: 'GET' });
    expect(list.detected[0]).toMatchObject({ transport_status: 'delayed', suggested_kind: 'delay' });
    calls = respondWith(fx.alert_created);
    await createAlert('p1', { kind: 'delay', event_id: 'e1', delay_minutes: 120, confidence: 'confirmed' });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/alerts', method: 'POST', data: { kind: 'delay', delay_minutes: 120 } });
    calls = respondWith(fx.alert_dismissed);
    const done = await updateAlert('p1', 'a1', { status: 'dismissed' }, 2);
    expect(calls[0]).toMatchObject({
      url: '/plans/p1/alerts/a1', method: 'PATCH', data: { status: 'dismissed' }, config: { headers: { 'If-Match': '2' } },
    });
    expect(done.status).toBe('dismissed');
  });

  it('再計画案の作成・取得・適用(本案のrevision)・却下(案のrevision)', async () => {
    let calls = respondWith(fx.replan_created);
    const created = await createReplan('p1', 'a1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/alerts/a1/replans', method: 'POST' });
    expect(created.candidates.map((c) => c.id)).toEqual(['A', 'B']);
    calls = respondWith(fx.replan_stale);
    expect((await getReplan('p1', 'r1')).is_stale).toBe(true);
    expect(calls[0]?.url).toBe('/plans/p1/replans/r1');
    calls = respondWith(fx.replan_applied);
    const applied = await applyReplan('p1', 'r1', 'A', 8);
    expect(calls[0]).toMatchObject({
      url: '/plans/p1/replans/r1/apply', method: 'POST', data: { candidate: 'A' }, config: { headers: { 'If-Match': '8' } },
    });
    expect(applied.replan.state).toBe('applied');
    calls = respondWith(fx.replan_rejected);
    await rejectReplan('p1', 'r1', 1);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/replans/r1/reject', method: 'POST', config: { headers: { 'If-Match': '1' } } });
  });

  it('使えない案・古い案・適用できるかを誤らない(列挙値と真偽値を厳密に検査する)', () => {
    const weather = decodeResponse(fx.replan_weather_last_day, replanDecoder, 'x');
    expect(weather.candidates[1]).toMatchObject({ available: false, cost_impact: null });
    const bad = { ...fx.replan_created, can_apply: 'yes' };
    expect(() => decodeResponse(bad, replanDecoder, 'x')).toThrow(/\$\.can_apply/);
    const badStrategy = {
      ...fx.replan_created,
      candidates: [{ ...fx.replan_created.candidates[0], strategy: 'teleport' }],
    };
    expect(() => decodeResponse(badStrategy, replanDecoder, 'x')).toThrow(/\$\.candidates\[0\]\.strategy/);
  });
});
