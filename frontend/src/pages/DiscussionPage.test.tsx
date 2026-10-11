/**
 * [Gate P3] DiscussionPage(FR-022 合意形成 / FR-024 コメント)の画面テスト。
 *
 * - 投票: 状態・件数・懸念の表示、匿名で件数を伏せる、回答の送信内容、理由なしの懸念を止める、決定
 * - 投票の作成: 入力検証と送信内容
 * - コメント: スレッド・削除済み表示、機密らしき文字列の注意、メンション付き投稿
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { PlanComment, PlanMember, Poll } from '@/services/api';

const m = vi.hoisted(() => ({
  getPlanMembers: vi.fn(),
  getPolls: vi.fn(),
  getComments: vi.fn(),
  createPoll: vi.fn(),
  updatePoll: vi.fn(),
  deletePoll: vi.fn(),
  putVotes: vi.fn(),
  resolveVote: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { extractApiErrorDetailMessage: actual.extractApiErrorDetailMessage, ...m };
});

import DiscussionPage from './DiscussionPage';

const voted = fx.poll_voted as Poll;
const members: PlanMember[] = [
  { user_id: 'me', name: '自分', role: 'owner', is_me: true },
  { user_id: 'u2', name: '花子', role: 'editor', is_me: false },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/discussion']}>
      <Routes>
        <Route path="/planner/:planId/discussion" element={<DiscussionPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getPlanMembers.mockResolvedValue(members);
  m.getPolls.mockResolvedValue([voted, fx.poll_anonymous_hidden]);
  m.getComments.mockResolvedValue(fx.comment_list);
  m.putVotes.mockResolvedValue(voted);
  m.updatePoll.mockResolvedValue(fx.poll_decided);
  m.createPoll.mockResolvedValue(fx.poll_created);
  m.createComment.mockResolvedValue(fx.comment_created);
  window.confirm = vi.fn(() => true);
});

describe('DiscussionPage (Gate P3)', () => {
  it('投票: 合意状態を文字で示し、懸念・不可の理由と匿名で伏せた件数を表示する', async () => {
    renderPage();
    const card = await screen.findByRole('region', { name: voted.title });
    const [sushi, yakiniku] = voted.options;
    const o1 = within(card).getByTestId(`poll-option-${sushi!.id}`);
    expect(o1).toHaveTextContent('不可あり(不成立)');
    expect(o1).toHaveTextContent('生魚が苦手');
    expect(o1).toHaveTextContent('代替案: 天ぷら');
    expect(within(card).getByTestId(`poll-option-${yakiniku!.id}`)).toHaveTextContent('懸念あり');
    const anon = screen.getByRole('region', { name: fx.poll_anonymous_hidden.title });
    expect(anon).toHaveTextContent('3人以上');
  });

  it('回答: 懸念に理由が無いと送信しない。理由を入れるとまとめて送る', async () => {
    renderPage();
    const card = await screen.findByRole('region', { name: voted.title });
    const yakiniku = voted.options[1]!;
    fireEvent.change(within(card).getByLabelText(`${yakiniku.label}へのあなたの回答`), { target: { value: 'concern' } });
    fireEvent.click(within(card).getByRole('button', { name: '回答を送信' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('理由を入力してください');
    expect(m.putVotes).not.toHaveBeenCalled();
    fireEvent.change(within(card).getByLabelText(`${yakiniku.label}の理由`), { target: { value: '高い' } });
    fireEvent.click(within(card).getByRole('button', { name: '回答を送信' }));
    await waitFor(() => expect(m.putVotes).toHaveBeenCalledTimes(1));
    const [, pollId, votes] = m.putVotes.mock.calls[0]!;
    expect(pollId).toBe(voted.id);
    expect(votes).toContainEqual({ option_id: yakiniku.id, value: 'concern', reason: '高い' });
  });

  it('決定: 確認のうえrevision付きで決定する(不成立の選択肢には決定ボタンが無い)', async () => {
    m.getPolls.mockResolvedValue([{ ...voted, can_manage: true }]);
    renderPage();
    const card = await screen.findByRole('region', { name: voted.title });
    const [sushi, yakiniku] = voted.options;
    expect(within(within(card).getByTestId(`poll-option-${sushi!.id}`)).queryByRole('button', { name: 'これに決定' })).toBeNull();
    fireEvent.click(within(within(card).getByTestId(`poll-option-${yakiniku!.id}`)).getByRole('button', { name: 'これに決定' }));
    await waitFor(() => expect(m.updatePoll).toHaveBeenCalledWith('p1', voted.id, { decided_option_id: yakiniku!.id }, voted.revision));
  });

  it('投票の作成: 選択肢の重複を止め、正しい内容で作成する', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '投票を作成' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('題名'), { target: { value: ' 夕食 ' } });
    fireEvent.change(within(dialog).getByLabelText('選択肢1'), { target: { value: 'A' } });
    fireEvent.change(within(dialog).getByLabelText('選択肢2'), { target: { value: 'A' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '作成' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('同じ名前の選択肢');
    fireEvent.change(within(dialog).getByLabelText('選択肢2'), { target: { value: 'B' } });
    fireEvent.click(within(dialog).getByLabelText(/不可は参考意見/));
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '作成' }));
    await waitFor(() => expect(m.createPoll).toHaveBeenCalledWith('p1', {
      title: '夕食', options: [{ label: 'A' }, { label: 'B' }], veto_policy: 'advisory', is_anonymous: true,
    }));
  });

  it('コメント: 削除済みの親と返信、機密らしき文字列の注意、メンション付き投稿', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /コメント/ }));
    expect(await screen.findByText('このコメントは削除されました')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: '返信' })).getByText('了解です')).toBeInTheDocument();
    const box = screen.getByLabelText('コメントするの内容');
    fireEvent.change(box, { target: { value: '予約番号は 12345678 です' } });
    expect(screen.getByRole('note')).toHaveTextContent('機密情報');
    fireEvent.click(screen.getByRole('checkbox', { name: '花子' }));
    fireEvent.click(screen.getByRole('button', { name: 'コメントする' }));
    await waitFor(() => expect(m.createComment).toHaveBeenCalledWith('p1', { body: '予約番号は 12345678 です', mentions: ['u2'] }));
    expect((fx.comment_created as PlanComment).sensitive_warning).toBe(true);
  });
});
