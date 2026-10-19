/**
 * [Gate V2] 訪問の地図の層・判定・訂正(FR-049〜051)APIのクライアント。送信内容(URL・If-Match・本文)と、
 * 実backendから採取した応答のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, assessVisits, correctVisit, getVisits, postDeviceVisitResults } from './index';
import { decodeResponse } from './decode';
import { visitCorrectionResult, visitsOverview } from './decoders';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET') calls.push({ url, method, config: a as AxiosRequestConfig });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({ get: push('GET'), post: push('POST'), patch: push('PATCH') } as Partial<MinimalHttpClient>);
  return calls;
}

const E1 = '00000000-0000-4000-8000-0000000000e1';

describe('訪問 APIクライアント (Gate V2)', () => {
  it('一覧・判定・端末の数値・訂正を正しいURLと本文で送る', async () => {
    let calls = respondWith(fx.visits_empty);
    const empty = await getVisits('p1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/visits', config: { skipGlobalErrorHandler: true } });
    expect(empty.items.every((i) => i.layer_state === 'PLANNED' && i.assessment === null)).toBe(true);

    calls = respondWith(fx.visits_assessed);
    const assessed = await assessVisits('p1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/visits/assess', method: 'POST', data: {} });
    expect(assessed.result).toEqual({ created: 2, changed: 0, unchanged: 0, skipped: 1 });

    calls = respondWith(fx.visits_device);
    const metrics = { points_total: 9, points_valid: 8, points_inside: 7, dwell_seconds: 900, median_distance_m: 25,
      median_accuracy_m: 8, speed_kmh: 0.3 };
    await postDeviceVisitResults('p1', [{ event_id: E1, metrics }]);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/visits/device-results', data: { results: [{ event_id: E1, metrics }] } });

    calls = respondWith(fx.visit_corrected_confirm);
    const c = await correctVisit('p1', E1, 'confirm', 1);
    expect(calls[0]).toMatchObject({ url: `/plans/p1/visits/${E1}`, method: 'PATCH', data: { action: 'confirm' },
      config: { headers: { 'If-Match': '1' }, skipGlobalErrorHandler: true } });
    expect(c.layer_state).toBe('VERIFIED');
    // 判定の無い予定への訂正は If-Match を送らない
    calls = respondWith(fx.visit_corrected_reject_new);
    await correctVisit('p1', E1, 'reject');
    expect(calls[0]!.config).toEqual({ skipGlobalErrorHandler: true });
  });

  it('採取した応答の形と、根拠に座標が無いことを確かめる', () => {
    const a = decodeResponse(fx.visits_assessed, visitsOverview, 'x');
    const stayed = a.items.find((i) => i.layer_state === 'STAYED')!;
    expect(stayed.assessment).toMatchObject({ state: 'LIKELY_VISIT', level: 'review', needs_confirmation: true });
    for (const item of a.items) {
      const reasons = JSON.stringify(item.assessment?.reasons ?? {});
      expect(reasons).not.toMatch(/"(lat|lng|latitude|longitude)"/);
    }
    const re = decodeResponse(fx.visits_reassessed, visitsOverview, 'x');
    const confirmed = re.items.find((i) => i.event_id === E1)!.assessment!;
    expect(confirmed).toMatchObject({ state: 'VERIFIED_VISIT', source: 'user', auto_state: 'LIKELY_VISIT', differs_from_auto: true });
    expect(decodeResponse(fx.visit_reset_removed, visitCorrectionResult, 'x').assessment).toBeNull();
  });

  it('状態の列挙値・信頼度の範囲を厳密に検査する', () => {
    const item = fx.visits_assessed.items[0]!;
    const bad = { ...fx.visits_assessed, items: [{ ...item, layer_state: 'HOME' }] };
    expect(() => decodeResponse(bad, visitsOverview, 'x')).toThrow(/\$\.items\[0\]\.layer_state/);
    const badConf = { ...fx.visits_assessed, items: [{ ...item, assessment: { ...item.assessment!, confidence: 1.5 } }] };
    expect(() => decodeResponse(badConf, visitsOverview, 'x')).toThrow(/confidence/);
  });
});
