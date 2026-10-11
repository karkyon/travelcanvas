/**
 * [Gate P3] 合意形成(FR-022)・コメント(FR-024)APIのクライアント。送信内容(URL・メソッド・If-Match・
 * 回答の一括送信・対象の絞り込み)と、実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  api, createComment, createPoll, deleteComment, deletePoll, getComments, getPolls, putVotes, resolveVote,
  updateComment, updatePoll,
} from './index';
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

describe('合意形成・コメントAPIクライアント (Gate P3)', () => {
  it('投票の一覧・作成・変更・削除', async () => {
    let calls = respondWith(fx.poll_list);
    await expect(getPolls('p1')).resolves.toEqual(fx.poll_list);
    calls = respondWith(fx.poll_created);
    await createPoll('p1', { title: 't', options: [{ label: 'a' }] });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/polls', method: 'POST', data: { title: 't', options: [{ label: 'a' }] } });
    calls = respondWith(fx.poll_decided);
    await updatePoll('p1', 'q1', { decided_option_id: 'o1' }, 1);
    expect(calls[0]).toEqual({ url: '/plans/p1/polls/q1', method: 'PATCH', data: { decided_option_id: 'o1' }, config: { headers: { 'If-Match': '1' } } });
    calls = respondWith(fx.poll_deleted);
    await deletePoll('p1', 'q1', 2);
    expect(calls[0]).toEqual({ url: '/plans/p1/polls/q1', method: 'DELETE', config: { headers: { 'If-Match': '2' } } });
  });

  it('回答はまとめてPUTし、懸念の解決はPOSTする', async () => {
    let calls = respondWith(fx.poll_voted);
    await putVotes('p1', 'q1', [{ option_id: 'o1', value: 'veto', reason: 'r', alternative: 'a' }, { option_id: 'o2', value: null }]);
    expect(calls[0]).toEqual({ url: '/plans/p1/polls/q1/votes', method: 'PUT', data: { votes: [
      { option_id: 'o1', value: 'veto', reason: 'r', alternative: 'a' }, { option_id: 'o2', value: null }] }, config: undefined });
    calls = respondWith(fx.poll_resolved);
    await resolveVote('p1', 'q1', 'v1', true, 'メモ');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/polls/q1/votes/v1/resolution', method: 'POST', data: { resolved: true, note: 'メモ' } });
  });

  it('実応答: 不可で不成立・懸念あり、匿名は件数を伏せる', () => {
    expect(fx.poll_voted.options.map((o) => o.state)).toEqual(['blocked', 'has_concerns']);
    expect(fx.poll_resolved.options[1]?.state).toBe('agreed');
    expect(fx.poll_decided.state).toBe('decided');
    expect(fx.poll_anonymous_hidden.counts_hidden).toBe(true);
    expect(fx.poll_anonymous_hidden.options.every((o) => o.counts === null && o.score === null)).toBe(true);
    expect(fx.poll_list_viewer.every((p) => p.can_manage === false)).toBe(true);
  });

  it('状態や件数の形式が崩れた応答は拒否する(合意したと誤表示しない)', async () => {
    respondWith({ ...fx.poll_voted, state: 'done' });
    await expect(getPolls('p1').catch(() => null)).resolves.toBeNull();
    respondWith([{ ...fx.poll_voted, options: [{ ...fx.poll_voted.options[0], responders: -1 }] }]);
    await expect(getPolls('p1')).rejects.toThrow(/\$\[0\]\.options\[0\]\.responders/);
  });

  it('コメント: 対象で絞り込み、作成・変更・削除', async () => {
    let calls = respondWith(fx.comment_list);
    await getComments('p1', { type: 'plan' });
    expect(calls[0]).toEqual({ url: '/plans/p1/comments', method: 'GET', config: { params: { target_type: 'plan' } } });
    calls = respondWith(fx.comment_list_poll);
    await getComments('p1', { type: 'poll', id: 'q1' });
    expect(calls[0]?.config).toEqual({ params: { target_type: 'poll', target_id: 'q1' } });
    calls = respondWith(fx.comment_created);
    const c = await createComment('p1', { body: 'b', mentions: ['u1'] });
    expect(c.sensitive_warning).toBe(true);
    calls = respondWith(fx.comment_updated);
    await updateComment('p1', 'c1', { status: 'resolved' }, 1);
    expect(calls[0]).toEqual({ url: '/plans/p1/comments/c1', method: 'PATCH', data: { status: 'resolved' }, config: { headers: { 'If-Match': '1' } } });
    calls = respondWith(fx.comment_deleted);
    await deleteComment('p1', 'c1', 2);
    expect(calls[0]).toEqual({ url: '/plans/p1/comments/c1', method: 'DELETE', config: { headers: { 'If-Match': '2' } } });
    const deleted = fx.comment_list.find((x) => x.is_deleted);
    expect(deleted).toMatchObject({ body: null, mentions: [] });
  });
});
