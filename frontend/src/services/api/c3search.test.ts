/**
 * [Gate C3] 情報内検索(FR-009)APIのクライアント。送信内容と、実backendから採取した応答のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import { api, searchEverything, searchPlan } from './index';
import { decodeResponse } from './decode';
import { searchResults } from './decoders';
import type { MinimalHttpClient } from './types';

function respondWith(data: unknown) {
  const calls: Array<{ url: string; config?: AxiosRequestConfig }> = [];
  api.setHttpClientForTesting({
    get: async (url: string, config?: AxiosRequestConfig) => { calls.push({ url, config }); return { data }; },
  } as Partial<MinimalHttpClient>);
  return calls;
}

describe('情報内検索 APIクライアント (Gate C3)', () => {
  it('検索語と絞り込みを送る(絞り込みが無い時は送らない)', async () => {
    let calls = respondWith(fx.search_plan_query);
    const r = await searchPlan('p1', '清水');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/search', config: { params: { q: '清水' }, skipGlobalErrorHandler: true } });
    expect(r.categories.map((c) => c.category)).toEqual(['event', 'candidate']);
    calls = respondWith(fx.search_plan_suffix);
    const s = await searchPlan('p1', '5678', 'reservation');
    expect(calls[0]!.config?.params).toEqual({ q: '5678', filter: 'reservation' });
    expect(s.categories[0]!.results[0]!.badge).toBe('予約番号の末尾に一致');
    expect(JSON.stringify(s)).not.toContain('7781');
    calls = respondWith(fx.search_everything);
    const e = await searchEverything('京都');
    expect(calls[0]).toMatchObject({ url: '/search/everything', config: { params: { q: '京都' } } });
    expect(e.plans?.[0]?.title).toBe('京都の旅');
  });

  it('移動先は画面の中の経路だけを受け付ける', () => {
    const hit = fx.search_plan_query.categories[0]!.results[0]!;
    const evil = { ...fx.search_plan_query, categories: [{ ...fx.search_plan_query.categories[0]!, results: [{ ...hit, link: 'javascript:alert(1)' }] }] };
    expect(() => decodeResponse(evil, searchResults, 'x')).toThrow(/link/);
    const external = { ...evil, categories: [{ ...evil.categories[0]!, results: [{ ...hit, link: 'https://evil.example/planner/x' }] }] };
    expect(() => decodeResponse(external, searchResults, 'x')).toThrow(/link/);
    expect(decodeResponse(fx.search_plan_today, searchResults, 'x').filter_label).toBe('今日');
  });
});
