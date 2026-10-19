/**
 * [Gate C1] 共同編集(FR-020)・秘匿プロフィール(FR-023)の APIクライアント。送信先・本文・If-Match と、
 * 応答の decoder 検証(役割・版の数値)を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  api, getPlanPrivateProfile, getPrivateProfile, leavePresence, postPresence, putPlanPrivateProfile, putPrivateProfile,
} from './index';
import { decodeResponse } from './decode';
import { presenceState } from './decoders';
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

describe('共同編集・秘匿プロフィール (Gate C1)', () => {
  it('開いていることを知らせ、他の人・編集中・変更を受け取る', async () => {
    let calls = respondWith(fx.presence_with_editor_and_change);
    const state = await postPresence('p1', { client_id: 'tab-12345678', known_revision: 2, editing: { kind: 'event', id: 'e1' } });
    expect(state.viewers.find((v) => !v.is_self)?.editing?.label).toBe('清水寺(朝)');
    expect(state.changes[0]).toMatchObject({ is_self: false, items: [{ action: 'update', label: '清水寺(朝)' }] });
    expect(calls[0]).toMatchObject({
      method: 'POST', url: '/plans/p1/presence', config: { skipGlobalErrorHandler: true },
      data: { client_id: 'tab-12345678', known_revision: 2, editing: { kind: 'event', id: 'e1' } },
    });
    calls = respondWith(undefined);
    await leavePresence('p1', 'tab-12345678');
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: '/plans/p1/presence/tab-12345678' });
  });

  it('役割・版の形を検査する', () => {
    const bad = { ...fx.presence_alone, viewers: [{ ...fx.presence_alone.viewers[0], role: 'admin' }] };
    expect(() => decodeResponse(bad, presenceState, 'x')).toThrow();
    expect(() => decodeResponse({ ...fx.presence_alone, revision: '3' }, presenceState, 'x')).toThrow();
  });

  it('秘匿プロフィールは If-Match に版を送って保存し、旅行への適用を切り替える', async () => {
    let calls = respondWith(fx.private_profile_empty);
    expect((await getPrivateProfile()).revision).toBe(0);
    expect(calls[0]).toMatchObject({ url: '/privacy/private-profile' });
    calls = respondWith(fx.private_profile_saved);
    const items = [{ kind: 'earliest_start' as const, label: '朝', hardness: 'hard' as const, value: '11:00' }];
    const saved = await putPrivateProfile(items, 0);
    expect(saved.items).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: 'PUT', data: { items }, config: { headers: { 'If-Match': '0' } } });
    calls = respondWith(fx.plan_private_profile_off);
    expect((await getPlanPrivateProfile('p1')).applied).toBe(false);
    calls = respondWith(fx.plan_private_profile_applied);
    expect((await putPlanPrivateProfile('p1', true)).applied_constraints).toBe(2);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/plans/p1/private-profile', data: { applied: true } });
  });
});
