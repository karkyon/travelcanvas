/**
 * [Gate P1] 持ち物(FR-025)・準備タスク/レディネス(FR-026)APIのクライアント。送信内容(URL・メソッド・
 * If-Match・候補の条件)と、実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  api, createPackingItem, createPreparationTask, deletePackingItem, deletePreparationTask, getPackingItems,
  getPackingSuggestions, getPlanMembers, getPreparationTasks, getReadiness, updatePackingItem, updatePreparationTask,
} from './index';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const client: Partial<MinimalHttpClient> = {
    get: async (url: string, config?: AxiosRequestConfig) => { calls.push({ url, method: 'GET', config }); return { data }; },
    post: async (url: string, body?: unknown, config?: AxiosRequestConfig) => {
      calls.push({ url, method: 'POST', data: body, config });
      return { data };
    },
    patch: async (url: string, body?: unknown, config?: AxiosRequestConfig) => {
      calls.push({ url, method: 'PATCH', data: body, config });
      return { data };
    },
    delete: async (url: string, config?: AxiosRequestConfig) => { calls.push({ url, method: 'DELETE', config }); return { data }; },
  };
  api.setHttpClientForTesting(client);
  return calls;
}

describe('持ち物・準備タスク・レディネスAPIクライアント (Gate P1)', () => {
  it('メンバー一覧・持ち物一覧はプラン配下のGET', async () => {
    let calls = respondWith(fx.plan_members);
    await expect(getPlanMembers('p1')).resolves.toEqual(fx.plan_members);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/members', method: 'GET' });
    calls = respondWith(fx.packing_item_list);
    await expect(getPackingItems('p1')).resolves.toEqual(fx.packing_item_list);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/packing-items', method: 'GET' });
  });

  it('持ち物の作成・変更・削除。変更と削除は持ち物のrevisionをIf-Matchで送る', async () => {
    let calls = respondWith(fx.packing_item_shared);
    await createPackingItem('p1', { name: 'x', category: 'electronics' });
    expect(calls[0]).toEqual({ url: '/plans/p1/packing-items', method: 'POST', data: { name: 'x', category: 'electronics' }, config: undefined });
    calls = respondWith(fx.packing_item_updated);
    await updatePackingItem('p1', 'i1', { status: 'packed' }, 3);
    expect(calls[0]).toEqual({ url: '/plans/p1/packing-items/i1', method: 'PATCH', data: { status: 'packed' }, config: { headers: { 'If-Match': '3' } } });
    calls = respondWith(fx.packing_item_deleted);
    await expect(deletePackingItem('p1', 'i1', 4)).resolves.toEqual(fx.packing_item_deleted);
    expect(calls[0]).toEqual({ url: '/plans/p1/packing-items/i1', method: 'DELETE', config: { headers: { 'If-Match': '4' } } });
  });

  it('候補は指定された条件だけをクエリで送り、条件が無ければparamsを付けない', async () => {
    let calls = respondWith(fx.packing_suggestions);
    const s = await getPackingSuggestions('p1', { overseas: true, laundry: false });
    expect(calls[0]).toEqual({ url: '/plans/p1/packing-suggestions', method: 'GET', config: { params: { overseas: true } } });
    expect(s.unverified.map((u) => u.code)).toContain('weather_unavailable');
    calls = respondWith(fx.packing_suggestions);
    await getPackingSuggestions('p1');
    expect(calls[0]?.config).toEqual({ params: undefined });
  });

  it('タスクの一覧・作成・変更・削除', async () => {
    let calls = respondWith(fx.preparation_task_list);
    await expect(getPreparationTasks('p1')).resolves.toEqual(fx.preparation_task_list);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/preparation-tasks', method: 'GET' });
    calls = respondWith(fx.preparation_task_from_readiness);
    await createPreparationTask('p1', { title: 't', readiness_key: 'k' });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/preparation-tasks', method: 'POST', data: { title: 't', readiness_key: 'k' } });
    calls = respondWith(fx.preparation_task_done);
    await updatePreparationTask('p1', 't1', { status: 'done' }, 1);
    expect(calls[0]).toEqual({ url: '/plans/p1/preparation-tasks/t1', method: 'PATCH', data: { status: 'done' }, config: { headers: { 'If-Match': '1' } } });
    calls = respondWith(fx.preparation_task_deleted);
    await deletePreparationTask('p1', 't1', 2);
    expect(calls[0]).toEqual({ url: '/plans/p1/preparation-tasks/t1', method: 'DELETE', config: { headers: { 'If-Match': '2' } } });
  });

  it('レディネス: 件数や区分の形式が崩れた応答は拒否する(準備完了と誤表示しない)', async () => {
    respondWith(fx.readiness_attention);
    await expect(getReadiness('p1')).resolves.toEqual(fx.readiness_attention);
    respondWith({ ...fx.readiness_attention, is_ready: 'yes' });
    await expect(getReadiness('p1')).rejects.toThrow(/\$\.is_ready/);
    respondWith({ ...fx.readiness_attention, counts: { ...fx.readiness_attention.counts, total: -1 } });
    await expect(getReadiness('p1')).rejects.toThrow(/\$\.counts\.total/);
    const bad = { ...fx.readiness_attention, items: [{ ...fx.readiness_attention.items[0], category: 'other' }] };
    respondWith(bad);
    await expect(getReadiness('p1')).rejects.toThrow(/\$\.items\[0\]\.category/);
  });

  it('他のメンバーの個人の持ち物は応答に含まれない(採取した実応答)', () => {
    const mine = fx.packing_item_list.filter((i) => i.scope === 'personal');
    expect(mine.length).toBe(1);
    expect(fx.packing_item_list_other.some((i) => i.scope === 'personal')).toBe(false);
    expect(JSON.stringify(fx.packing_item_list_other)).not.toContain('常備薬');
    // 担当者(閲覧者)には完了だけ許される
    const assigned = fx.preparation_task_list_assignee.find((t) => t.assignee_user_id !== null && t.status === 'done');
    expect(assigned).toMatchObject({ can_edit: false, can_complete: true });
  });
});
