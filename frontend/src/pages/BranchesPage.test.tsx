/**
 * [Gate P7] BranchesPage / BranchDetailPage(SC-17 What-if)の画面テスト。
 *
 * - 一覧・作成(想定ごとの入力と送信内容、閲覧者は作成不可)
 * - 詳細: 予定の編集→保存、外す・戻す・追加、差分の表示、採用できない理由がある間は採用不可、採用・見送り・削除
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { Branch, BranchDetail } from '@/services/api';

const m = vi.hoisted(() => ({
  getPlanDetail: vi.fn(),
  getBranches: vi.fn(),
  getPlanMembers: vi.fn(),
  createBranch: vi.fn(),
  getBranch: vi.fn(),
  updateBranchContent: vi.fn(),
  updateBranch: vi.fn(),
  adoptBranch: vi.fn(),
  deleteBranch: vi.fn(),
}));

const g7 = vi.hoisted(() => ({ compareBranches: vi.fn() }));
vi.mock('@/services/api/g7', () => g7);

vi.mock('@/services/api', () => ({
  default: { getPlanDetail: m.getPlanDetail },
  getBranches: m.getBranches, getPlanMembers: m.getPlanMembers, createBranch: m.createBranch, getBranch: m.getBranch,
  updateBranchContent: m.updateBranchContent, updateBranch: m.updateBranch, adoptBranch: m.adoptBranch,
  deleteBranch: m.deleteBranch,
}));

import BranchesPage from './BranchesPage';
import BranchDetailPage from './BranchDetailPage';

const saved = fx.branch_content_saved as BranchDetail;
const conflicted = fx.branch_conflicted as BranchDetail;
const days = saved.days;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/planner/:planId/branches" element={<BranchesPage />} />
        <Route path="/planner/:planId/branches/:branchId" element={<BranchDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getPlanDetail.mockResolvedValue({ success: true, message: '', data: { days: days.map((d) => ({ id: d.id, local_date: d.local_date, events: [] })) } });
  m.getBranches.mockResolvedValue(fx.branch_list as Branch[]);
  m.getPlanMembers.mockResolvedValue([{ user_id: 'me', name: '自分', role: 'owner', is_me: true }]);
  m.createBranch.mockResolvedValue(fx.branch_created_delay);
  m.getBranch.mockResolvedValue(saved);
  window.confirm = vi.fn(() => true);
});

describe('BranchesPage (Gate P7)', () => {
  it('一覧: 状態と件数、作成後に本案が更新された案を示す', async () => {
    renderAt('/planner/p1/branches');
    const list = await screen.findByRole('list', { name: '作った案' });
    expect(within(list).getByText('雨の日案').closest('li')).toHaveTextContent('作成後に本案が更新されています');
    expect(list).toHaveTextContent('採用済み');
    expect(list).toHaveTextContent('見送り');
  });

  it('遅延の案: 日と遅れを入力して作成し、詳細へ移る', async () => {
    renderAt('/planner/p1/branches');
    await screen.findByRole('list', { name: '作った案' });
    fireEvent.change(screen.getByLabelText('題名'), { target: { value: '電車遅延' } });
    fireEvent.click(screen.getByRole('radio', { name: /遅延/ }));
    fireEvent.click(screen.getByRole('button', { name: '案を作る' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('遅延を想定する日を選んでください');
    fireEvent.change(screen.getByLabelText('遅延する日'), { target: { value: days[0]!.id } });
    fireEvent.change(screen.getByLabelText('遅れ(分)'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: '案を作る' }));
    await waitFor(() => expect(m.createBranch).toHaveBeenCalledWith('p1', {
      title: '電車遅延', scenario_type: 'delay', assumptions: { day_id: days[0]!.id, minutes: 90 } }));
    await waitFor(() => expect(m.getBranch).toHaveBeenCalled());
  });

  it('[Gate G7] FR-019 案を3つまで選んで本案と比べる', async () => {
    const g7fx = (await import('@/services/api/__fixtures__/g7Responses.json')).default;
    const { decodeG7 } = await import('@/services/api/decodersG7');
    g7.compareBranches.mockResolvedValue(decodeG7('comparison', g7fx.branch_comparison));
    renderAt('/planner/p1/branches');
    await screen.findByRole('list', { name: '作った案' });
    const boxes = screen.getAllByRole('checkbox', { name: /を比べる$/ });
    expect(screen.getByRole('button', { name: '選んだ案(0/3)を本案と比べる' })).toBeDisabled();
    fireEvent.click(boxes[0]!);
    fireEvent.click(screen.getByRole('button', { name: '選んだ案(1/3)を本案と比べる' }));
    expect(await screen.findByRole('table', { name: '本案と案の比較' })).toBeInTheDocument();
    expect(g7.compareBranches).toHaveBeenCalledWith('p1', [(fx.branch_list as Branch[])[0]!.id]);
  });

  it('閲覧者には作成フォームを出さない', async () => {
    m.getPlanMembers.mockResolvedValue([{ user_id: 'me', name: '自分', role: 'viewer', is_me: true }]);
    renderAt('/planner/p1/branches');
    await screen.findByRole('list', { name: '作った案' });
    expect(screen.queryByRole('button', { name: '案を作る' })).toBeNull();
  });
});

describe('BranchDetailPage (Gate P7)', () => {
  it('差分を表示し、編集して保存する(時刻・外す・追加)。未保存の間は採用できない', async () => {
    m.updateBranchContent.mockResolvedValue(saved);
    renderAt(`/planner/p1/branches/${saved.id}`);
    expect(await screen.findByRole('list', { name: '変更の一覧' })).toHaveTextContent('外す: 清水寺');
    const adopt = screen.getByRole('button', { name: '本案に採用' });
    expect(adopt).toBeEnabled();
    const lunch = saved.content.find((i) => i.title === '昼食')!;
    fireEvent.change(screen.getByLabelText('開始時刻', { selector: `#time-${lunch.key}` }), { target: { value: '13:00' } });
    expect(screen.getByRole('note')).toHaveTextContent('未保存の変更');
    expect(adopt).toBeDisabled();
    fireEvent.click(within(screen.getByTestId(`branch-item-${lunch.key}`)).getByRole('button', { name: '外す' }));
    fireEvent.click(screen.getByRole('button', { name: `${days[1]!.local_date}に予定を追加` }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('予定名を入力してください');
    const titles = screen.getAllByLabelText('予定名');
    const added = titles[titles.length - 1]!;
    fireEvent.change(added, { target: { value: '温泉' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.updateBranchContent).toHaveBeenCalledTimes(1));
    const [, , events, revision] = m.updateBranchContent.mock.calls[0]!;
    expect(revision).toBe(saved.revision);
    expect(events.find((e: { title: string }) => e.title === '昼食')).toMatchObject({ local_start_time: '13:00', removed: true });
    expect(events.find((e: { title: string }) => e.title === '温泉')).toMatchObject({ source_event_id: null, day_id: days[1]!.id });
    expect(await screen.findByText('分岐案を保存しました')).toBeInTheDocument();
  });

  it('採用できない理由がある間は採用ボタンを押せない', async () => {
    m.getBranch.mockResolvedValue(conflicted);
    renderAt(`/planner/p1/branches/${conflicted.id}`);
    expect(await screen.findByTestId('branch-conflicts')).toHaveTextContent('「清水寺」: 分岐した後に本案でも変更されています(開始時刻)');
    expect(screen.getByRole('button', { name: '本案に採用' })).toBeDisabled();
    expect(screen.getByText(/この案を作った後に本案が更新されています/)).toBeInTheDocument();
  });

  it('採用: 確認のうえrevision付きで採用し、元に戻せることを案内する。409では理由を再取得する', async () => {
    m.adoptBranch.mockResolvedValue(fx.branch_adopted);
    renderAt(`/planner/p1/branches/${saved.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '本案に採用' }));
    await waitFor(() => expect(m.adoptBranch).toHaveBeenCalledWith('p1', saved.id, saved.revision));
    expect(await screen.findByText(/「元に戻す」で取り消せます/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '本案に採用' })).toBeNull();
  });

  it('採用が競合で拒否されたら理由を表示して最新の状態を読み直す', async () => {
    m.adoptBranch.mockRejectedValue({ response: { status: 409, data: { detail: {
      code: 'branch_conflict', message: '本案と食い違う変更があるため採用できません', conflicts: conflicted.conflicts } } } });
    renderAt(`/planner/p1/branches/${saved.id}`);
    m.getBranch.mockResolvedValue(conflicted);
    fireEvent.click(await screen.findByRole('button', { name: '本案に採用' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('本案と食い違う変更があるため採用できません');
    expect(await screen.findByTestId('branch-conflicts')).toBeInTheDocument();
  });

  it('見送り・削除', async () => {
    m.updateBranch.mockResolvedValue(fx.branch_discarded);
    m.deleteBranch.mockResolvedValue({ revision: 9 });
    renderAt(`/planner/p1/branches/${saved.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '見送り' }));
    await waitFor(() => expect(m.updateBranch).toHaveBeenCalledWith('p1', saved.id, { status: 'discarded' }, saved.revision));
    expect(await screen.findByRole('button', { name: '検討に戻す' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    await waitFor(() => expect(m.deleteBranch).toHaveBeenCalled());
  });
});
