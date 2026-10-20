/**
 * [Gate C2] 候補箱(FR-007)・場所(FR-008)APIのクライアント。送信内容(URL・If-Match・本文)と、実backendから採取した応答の
 * decoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  api, createCandidate, createCandidateFromSearch, deleteCandidate, getCandidates, getPlaceInfo, getPlanPlaces,
  mergeCandidate, putOpeningHours, scheduleCandidate, updateCandidate, updatePlace,
} from './index';
import { decodeResponse } from './decode';
import { candidateList, placeInfo } from './decoders';
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
    get: push('GET'), post: push('POST'), patch: push('PATCH'), put: push('PUT'), delete: push('DELETE'),
  } as Partial<MinimalHttpClient>);
  return calls;
}

const C3 = '00000000-0000-4000-8000-0000000000c3';
const C5 = '00000000-0000-4000-8000-0000000000c5';
const rev = (n: number) => ({ headers: { 'If-Match': String(n) }, skipGlobalErrorHandler: true });

describe('候補箱・場所 APIクライアント (Gate C2)', () => {
  it('候補の一覧・追加・更新・統合・旅程に追加・削除を正しいURLと If-Match で送る', async () => {
    let calls = respondWith(fx.candidates_duplicates);
    const list = await getCandidates('p1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/candidates', config: { skipGlobalErrorHandler: true } });
    expect(list.duplicate_pairs).toBe(1);
    calls = respondWith(fx.candidate_created);
    await createCandidate('p1', { source_url: 'https://x.example/', priority: 1 });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/candidates', method: 'POST', data: { source_url: 'https://x.example/', priority: 1 } });
    calls = respondWith(fx.candidate_created);
    await createCandidateFromSearch('p1', 'sc1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/candidates/from-search', data: { search_candidate_id: 'sc1', priority: 2 } });
    calls = respondWith(fx.candidates_merged);
    await updateCandidate('p1', C3, { priority: 3 }, 2);
    expect(calls[0]).toMatchObject({ url: `/plans/p1/candidates/${C3}`, method: 'PATCH', config: rev(2) });
    calls = respondWith(fx.candidates_merged);
    await mergeCandidate('p1', 'b', C3, 1);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/candidates/b/merge', data: { into_id: C3 }, config: rev(1) });
    calls = respondWith(fx.candidate_scheduled);
    const s = await scheduleCandidate('p1', C3, { day_id: 'd1', local_start_time: '09:00' }, 1);
    expect(calls[0]).toMatchObject({ url: `/plans/p1/candidates/${C3}/schedule`, data: { day_id: 'd1', local_start_time: '09:00' }, config: rev(1) });
    expect(s.place_id).toBe(C5);
    calls = respondWith(null);
    await deleteCandidate('p1', C3);
    expect(calls[0]).toMatchObject({ url: `/plans/p1/candidates/${C3}`, method: 'DELETE' });
  });

  it('場所の取得・更新・営業時間・旅行の場所の一覧', async () => {
    let calls = respondWith(fx.place_info);
    const p = await getPlaceInfo(C5);
    expect(calls[0]).toMatchObject({ url: `/places/${C5}` });
    expect(p.sources.name?.provider).toBe('url');
    calls = respondWith(fx.place_updated);
    const u = await updatePlace(C5, { phone: '075-551-1234' }, 1);
    expect(calls[0]).toMatchObject({ url: `/places/${C5}`, method: 'PATCH', config: rev(1) });
    expect(u.sources.phone?.label).toBe('利用者の入力');
    calls = respondWith(fx.place_hours);
    const h = await putOpeningHours(C5, [{ day_of_week: 0, open_time: '06:00', close_time: '18:00' }], 2);
    expect(calls[0]).toMatchObject({ url: `/places/${C5}/opening-hours`, method: 'PUT', config: rev(2) });
    expect(h.opening_hours).toHaveLength(7);
    calls = respondWith(fx.plan_places);
    const pp = await getPlanPlaces('p1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/places' });
    expect(pp.places[0]).toMatchObject({ id: C5, event_count: 1, has_opening_hours: true });
  });

  it('列挙値・出典の形を厳密に検査する', () => {
    const item = fx.candidates_duplicates.items[0]!;
    const bad = { ...fx.candidates_duplicates, items: [{ ...item, status: 'trash' }] };
    expect(() => decodeResponse(bad, candidateList, 'x')).toThrow(/\$\.items\[0\]\.status/);
    const badSrc = { ...fx.place_info, sources: { name: { provider: 1 } } };
    expect(() => decodeResponse(badSrc, placeInfo, 'x')).toThrow(/sources\.name/);
  });
});
