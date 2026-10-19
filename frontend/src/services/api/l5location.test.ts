/**
 * [Gate L5] FR-055 Local-first Location・FR-056 適応型GPS の APIクライアント。送信先・本文・If-Match と、
 * 応答の decoder 検証(区画の印の形・0〜1 の割合)を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, getLocationSettings, putLocationSettings, putTrackSampling, startLocationTrack, uploadAreaCells } from './index';
import { decodeResponse } from './decode';
import { locationTrack, locationTrackDetail } from './decoders';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET') calls.push({ url, method, config: a as AxiosRequestConfig });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({ get: push('GET'), post: push('POST'), put: push('PUT') } as Partial<MinimalHttpClient>);
  return calls;
}

describe('位置の扱い・訪問地域・記録の観測値 (Gate L5)', () => {
  it('設定の取得と変更(If-Match に revision)', async () => {
    let calls = respondWith(fx.location_settings_unset);
    expect((await getLocationSettings('p1')).mode).toBeNull();
    expect(calls[0]).toMatchObject({ url: '/plans/p1/location-settings', config: { skipGlobalErrorHandler: true } });
    calls = respondWith(fx.location_settings_saved);
    const saved = await putLocationSettings('p1', 'areas_only', 0);
    expect(saved).toMatchObject({ mode: 'areas_only', revision: 1 });
    expect(calls[0]).toMatchObject({ method: 'PUT', data: { mode: 'areas_only' }, config: { headers: { 'If-Match': '0' } } });
  });

  it('保存先を省略すると旅行の設定で始める', async () => {
    const calls = respondWith(fx.location_track_areas_started);
    const t = await startLocationTrack('p1', null, 'standard');
    expect(t.mode).toBe('areas_only');
    expect(calls[0]!.data).toEqual({ precision: 'standard' });
  });

  it('区画と観測値を送る', async () => {
    let calls = respondWith(fx.area_cells_uploaded);
    const cells = [{ key: '0.1:34.9:135.7', first_at: 'a', last_at: 'b', dwell_seconds: 1, samples: 1 }];
    expect((await uploadAreaCells('p1', 't1', cells)).cell_count).toBe(2);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/location-tracks/t1/area-cells', data: { cells } });
    calls = respondWith(fx.location_track_sampling);
    const res = await putTrackSampling('p1', 't1', {
      expected_samples: 1, kept_samples: 1, missed_samples: 0, manual_points: 0, max_gap_seconds: 0, tier_seconds: {},
    });
    expect(res.sampling?.missed_ratio).toBeCloseTo(5 / 48, 3);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/plans/p1/location-tracks/t1/sampling' });
  });

  it('区画の印・割合の形を検査する', () => {
    const detail = fx.location_track_detail_areas;
    expect(decodeResponse(detail, locationTrackDetail, 'x').cells).toHaveLength(2);
    const badCell = { ...detail, cells: [{ ...detail.cells[0], key: '35.0,135.7' }] };
    expect(() => decodeResponse(badCell, locationTrackDetail, 'x')).toThrow(/key/);
    const s = fx.location_track_sampling;
    expect(() => decodeResponse({ ...s, sampling: { ...s.sampling, missed_ratio: 1.5 } }, locationTrack, 'x')).toThrow();
  });
});
