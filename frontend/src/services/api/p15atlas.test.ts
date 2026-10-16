/**
 * [Gate P15] Personal Travel Atlas(FR-052)APIのクライアント。送信内容と、実backendから採取した応答のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, getAtlas, updateAtlasSettings } from './index';
import { decodeResponse } from './decode';
import { atlasResponse } from './decoders';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET') calls.push({ url, method, config: a as AxiosRequestConfig });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({ get: push('GET'), put: push('PUT') } as Partial<MinimalHttpClient>);
  return calls;
}

describe('Atlas APIクライアント (Gate P15)', () => {
  it('区画の大きさ・年を送り、除く旅行を保存する', async () => {
    let calls = respondWith(fx.atlas_region);
    const a = await getAtlas('region');
    expect(calls[0]).toMatchObject({ url: '/atlas', config: { params: { precision: 'region' }, skipGlobalErrorHandler: true } });
    expect(a.cells.map((c) => c.state)).toEqual(['STAYED', 'VISITED', 'VISITED', 'PASS_THROUGH']);
    calls = respondWith(fx.atlas_area_2026);
    await getAtlas('area', 2026);
    expect(calls[0]!.config?.params).toEqual({ precision: 'area', year: 2026 });
    calls = respondWith(fx.atlas_settings_saved);
    await updateAtlasSettings(['p2']);
    expect(calls[0]).toMatchObject({ url: '/atlas/settings', method: 'PUT', data: { excluded_plan_ids: ['p2'] } });
  });

  it('状態の列挙値を厳密に検査する', () => {
    const bad = { ...fx.atlas_region, cells: [{ ...fx.atlas_region.cells[0], state: 'HOME' }] };
    expect(() => decodeResponse(bad, atlasResponse, 'x')).toThrow(/\$\.cells\[0\]\.state/);
    expect(decodeResponse(fx.atlas_empty, atlasResponse, 'x').summary.revisit_rate).toBeNull();
  });
});
