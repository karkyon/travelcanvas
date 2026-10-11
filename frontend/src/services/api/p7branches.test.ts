/**
 * [Gate P7] What-if・旅程ブランチ(FR-019)APIのクライアント。送信内容(URL・If-Match)と、
 * 実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  adoptBranch, api, createBranch, deleteBranch, getBranch, getBranches, updateBranch, updateBranchContent,
} from './index';
import type { BranchDetail, MinimalHttpClient } from './types';

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

describe('What-if・旅程ブランチAPIクライアント (Gate P7)', () => {
  it('一覧・作成・詳細', async () => {
    let calls = respondWith(fx.branch_list);
    await expect(getBranches('p1')).resolves.toHaveLength(4);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/branches', method: 'GET' });
    calls = respondWith(fx.branch_created_delay);
    const created = await createBranch('p1', { title: '遅延', scenario_type: 'delay', assumptions: { day_id: 'd', minutes: 60 } });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/branches', method: 'POST', data: { scenario_type: 'delay' } });
    expect(created.summary.time_changed).toBeGreaterThan(0);
    calls = respondWith(fx.branch_conflicted);
    const detail = await getBranch('p1', 'b1');
    expect(calls[0]?.url).toBe('/plans/p1/branches/b1');
    expect(detail.conflicts[0]).toMatchObject({ op: 'remove', reason: 'changed_in_plan', fields: ['local_start_time'] });
  });

  it('編集・変更・採用・削除は分岐案のrevisionをIf-Matchで送る', async () => {
    const d = fx.branch_content_saved as BranchDetail;
    let calls = respondWith(d);
    await updateBranchContent('p1', 'b1', d.content, 3);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/branches/b1/content', method: 'PUT', config: { headers: { 'If-Match': '3' } } });
    expect((calls[0]?.data as { events: unknown[] }).events).toHaveLength(d.content.length);
    calls = respondWith(fx.branch_discarded);
    await updateBranch('p1', 'b1', { status: 'discarded' }, 4);
    expect(calls[0]).toMatchObject({ method: 'PATCH', data: { status: 'discarded' }, config: { headers: { 'If-Match': '4' } } });
    calls = respondWith(fx.branch_adopted);
    const adopted = await adoptBranch('p1', 'b1', 5);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/branches/b1/adopt', method: 'POST', config: { headers: { 'If-Match': '5' } } });
    expect(adopted.branch.state).toBe('adopted');
    calls = respondWith(fx.branch_deleted);
    await deleteBranch('p1', 'b1', 6);
    expect(calls[0]).toEqual({ url: '/plans/p1/branches/b1', method: 'DELETE', config: { headers: { 'If-Match': '6' } } });
  });

  it('状態や採用できない理由の形式が崩れた応答は拒否する(採用ボタンを誤って出さない)', async () => {
    respondWith({ ...fx.branch_conflicted, conflicts: [{ op: 'remove', reason: 'whatever' }] });
    await expect(getBranch('p1', 'b1')).rejects.toThrow(/conflicts\[0\]\.reason/);
    respondWith([{ ...fx.branch_list[0], state: 'merged' }]);
    await expect(getBranches('p1')).rejects.toThrow(/\$\[0\]\.state/);
    expect(fx.branch_list_viewer.every((b) => b.can_edit === false)).toBe(true);
  });
});
