/**
 * [Gate P3] 相談・投票画面の入力検証・整形(discussionModel)の単体テスト。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { PlanComment, Poll } from '@/services/api';
import { answersToPayload, buildThreads, describeCounts, draftsFromPoll, looksSensitive } from './discussionModel';

const created = fx.poll_created as Poll;

describe('discussionModel (Gate P3)', () => {
  it('自分の回答から下書きを作り、懸念・不可の理由と代替案を検証する', () => {
    const voted = fx.poll_voted as Poll;
    const drafts = draftsFromPoll(voted);
    expect(drafts[voted.options[0]!.id]).toEqual({ value: 'veto', reason: '生魚が苦手', alternative: '天ぷら' });
    const [a, b] = created.options;
    expect(answersToPayload(created, { [a!.id]: { value: '', reason: '', alternative: '' } }).ok).toBe(false);
    expect(answersToPayload(created, { [a!.id]: { value: 'concern', reason: ' ', alternative: '' } })).toEqual({
      ok: false, error: '「寿司」の懸念ありには理由を入力してください' });
    const strict = { ...created, veto_policy: 'block_with_alternative' as const };
    expect(answersToPayload(strict, { [a!.id]: { value: 'veto', reason: 'x', alternative: '' } }).ok).toBe(false);
    expect(answersToPayload(created, {
      [a!.id]: { value: 'love', reason: '', alternative: '' }, [b!.id]: { value: 'concern', reason: ' 高い ', alternative: '' },
    })).toEqual({ ok: true, data: [{ option_id: a!.id, value: 'love' }, { option_id: b!.id, value: 'concern', reason: '高い' }] });
    // 回答済みの選択肢を未回答に戻すと取り消し(null)を送る
    expect(answersToPayload(voted, { [voted.options[0]!.id]: { value: '', reason: '', alternative: '' } })).toEqual({
      ok: true, data: [{ option_id: voted.options[0]!.id, value: null }] });
  });

  it('件数の表示: 匿名で伏せられている時はその旨を出す', () => {
    expect(describeCounts((fx.poll_voted as Poll).options[0]!)).toContain('ぜひ(Love) 1');
    expect(describeCounts((fx.poll_anonymous_hidden as Poll).options[0]!)).toContain('3人以上');
  });

  it('スレッドの組み立てと機密らしき文字列の検出', () => {
    const threads = buildThreads(fx.comment_list as PlanComment[]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.is_deleted).toBe(true);
    expect(threads[0]!.replies.map((r) => r.body)).toEqual(['了解です']);
    expect(looksSensitive('予約番号は12345')).toBe(true);
    expect(looksSensitive('AB12CD34')).toBe(true);
    expect(looksSensitive('明日は10時集合')).toBe(false);
  });
});
