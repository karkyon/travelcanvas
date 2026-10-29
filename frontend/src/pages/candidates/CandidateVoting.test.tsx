/**
 * [Gate G11 段階8] 候補箱で家族・グループが候補に投票する(FR-007 の gaps「候補への投票」。合意形成 FR-022 の投票を使う)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ getPolls: vi.fn(), createPoll: vi.fn(), putVotes: vi.fn() }));
vi.mock('@/services/api', () => api);

import CandidateVoting from './CandidateVoting';
import { candidatePoll, countsText } from './candidateVotingModel';
import type { Poll, PollOption } from '@/services/api/types/discussion';

const option = (over: Partial<PollOption>): PollOption => ({
  id: 'o1', label: '錦市場', event_id: null, event_label: null, event_missing: false, candidate_id: 'c1', state: 'pending',
  score: 0, counts: { love: 1, ok: 0, concern: 0, veto: 0, abstain: 0 }, responders: 1, unresolved_concerns: 0,
  unresolved_vetoes: 0, is_leading: false, is_decided: false, my_vote: null, votes: [], ...over,
});
const poll = (over: Partial<Poll> = {}): Poll => ({
  id: 'q1', plan_id: 'p1', algorithm_version: 'v1', title: '候補箱の投票', description: null, deadline_at: null, status: 'open',
  is_closed: false, veto_policy: 'block', is_anonymous: false, counts_hidden: false, state: 'voting', decided_option_id: null,
  created_by_name: '父', can_manage: true, unanswered: [{ user_id: 'u2', name: '娘' }],
  options: [option({}), option({ id: 'o2', label: '伏見稲荷', candidate_id: 'c2', counts: { love: 0, ok: 2, concern: 0, veto: 0, abstain: 0 } })],
  revision: 1, created_at: '2026-10-29T00:00:00Z', ...over,
});
const cands = [{ id: 'c1', title: '錦市場' }, { id: 'c2', title: '伏見稲荷' }];

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

const view = (canEdit = true, candidates = cands) => render(
  <MemoryRouter><CandidateVoting planId="p1" candidates={candidates} canEdit={canEdit} /></MemoryRouter>,
);

describe('候補箱の投票', () => {
  it('候補を選択肢にした、締め切っていない・決まっていない投票だけを使う。匿名の3人未満は件数を出さない', () => {
    expect(candidatePoll([poll({ options: [option({ candidate_id: null })] }), poll({ id: 'q2' })])?.id).toBe('q2');
    expect(candidatePoll([poll({ is_closed: true }), poll({ id: 'q3', decided_option_id: 'o1' })])).toBeNull();
    expect(countsText(option({}))).toBe('♥ 行きたい 1 · ○ 行ってもいい 0 · △ 気になる点がある 0 · ✕ 行きたくない 0');
    expect(countsText(option({ counts: null, responders: 2 }))).toContain('回答 2人(匿名の投票は3人の回答まで件数を出しません)');
  });

  it('投票が無い時、編集できる人は候補で始められる(閲覧の人には出さない)', async () => {
    api.getPolls.mockResolvedValueOnce([]).mockResolvedValue([poll()]);
    api.createPoll.mockResolvedValue(poll());
    view();
    fireEvent.click(await screen.findByTestId('candidate-voting-start'));
    await waitFor(() => expect(api.createPoll).toHaveBeenCalledWith('p1', {
      title: '候補箱の投票', options: [{ candidate_id: 'c1' }, { candidate_id: 'c2' }] }));
    expect(await screen.findByRole('status')).toHaveTextContent('候補で投票を始めました');
    expect(screen.getByTestId('candidate-voting-summary')).toHaveTextContent('未回答 1人');
  });

  it('閲覧の人は始められないが回答できる。行きたい → 取り消し、懸念は理由が要る。後から足した候補を示す', async () => {
    api.getPolls.mockResolvedValue([poll()]);
    api.putVotes.mockResolvedValue({});
    view(false, [...cands, { id: 'c3', title: '嵐山' }]);
    const row = await screen.findByTestId('candidate-vote-c1');
    expect(screen.queryByTestId('candidate-voting-start')).toBeNull();
    expect(within(row).getByTestId('candidate-vote-counts')).toHaveTextContent('♥ 行きたい 1');
    fireEvent.click(within(row).getByRole('radio', { name: /^行きたい$/ }));
    await waitFor(() => expect(api.putVotes).toHaveBeenCalledWith('p1', 'q1', [{ option_id: 'o1', value: 'love' }]));
    expect(await screen.findByRole('status')).toHaveTextContent('「錦市場」に「行きたい」を付けました');
    fireEvent.click(within(screen.getByTestId('candidate-vote-c2')).getByRole('radio', { name: /^気になる点がある$/ }));
    const ask = screen.getByTestId('candidate-vote-reason');
    expect(within(ask).getByRole('button', { name: '付ける' })).toBeDisabled();
    fireEvent.change(within(ask).getByRole('textbox'), { target: { value: '階段が多い' } });
    fireEvent.click(within(ask).getByRole('button', { name: '付ける' }));
    await waitFor(() => expect(api.putVotes).toHaveBeenLastCalledWith('p1', 'q1',
      [{ option_id: 'o2', value: 'concern', reason: '階段が多い' }]));
    expect(screen.getByTestId('candidate-voting-missing')).toHaveTextContent('投票の後に足した候補 1件(「嵐山」)');
  });

  it('自分の回答をもう一度押すと取り消す。失敗は画面に出す', async () => {
    api.getPolls.mockResolvedValue([poll({ options: [option({ my_vote: 'ok' })] })]);
    api.putVotes.mockRejectedValue({ response: { status: 409, data: { detail: 'この投票は締め切られています' } } });
    view();
    const row = await screen.findByTestId('candidate-vote-c1');
    expect(within(row).getByRole('radio', { name: /^行ってもいい$/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(row).getByRole('radio', { name: /^行ってもいい$/ }));
    await waitFor(() => expect(api.putVotes).toHaveBeenCalledWith('p1', 'q1', [{ option_id: 'o1', value: null }]));
    expect(await screen.findByRole('alert')).toHaveTextContent('締め切られています');
  });
});
