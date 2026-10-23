/**
 * [Gate C3] CommandPalette(情報内検索、FR-009)の画面テスト。
 * [Gate G4] MAP-03 コマンド(「>」): 確認の後だけ実行・閲覧だけの人は実行できない・元に戻す・画面を開く。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import { planIdFromPath } from '@/utils/commandPalette';

const m = vi.hoisted(() => ({
  searchPlan: vi.fn(), searchEverything: vi.fn(),
  getCommands: vi.fn(), previewCommand: vi.fn(), executeCommand: vi.fn(), undoCommand: vi.fn(),
}));
vi.mock('@/services/api', () => ({ searchPlan: m.searchPlan, searchEverything: m.searchEverything }));
vi.mock('@/services/api/g4', () => ({
  getCommands: m.getCommands, previewCommand: m.previewCommand, executeCommand: m.executeCommand, undoCommand: m.undoCommand,
}));

import CommandPalette from './CommandPalette';

const P = '00000000-0000-4000-8000-0000000000d1';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <CommandPalette />
    <Routes><Route path="*" element={<Where />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  for (const fn of Object.values(m)) fn.mockReset();
  m.searchPlan.mockResolvedValue(fx.search_plan_query);
  m.searchEverything.mockResolvedValue(fx.search_everything);
  m.getCommands.mockResolvedValue({ plan_revision: 3, commands: [
    { name: 'add_event', label: '予定を追加', kind: 'mutate', usage: '予定を追加 11/3 10:00 清水寺', undoable: true, allowed: true, aliases: ['予定を追加'] },
    { name: 'run_validation', label: '検証を実行', kind: 'run', usage: '検証を実行', undoable: false, allowed: true, aliases: ['検証を実行'] },
    { name: 'open_reservations', label: '予約を開く', kind: 'navigate', usage: '予約', undoable: false, allowed: true, aliases: ['予約'] },
  ] });
});

const ADD_PREVIEW = {
  command: 'add_event', label: '予定を追加', kind: 'mutate', args: {}, undoable: true, allowed: true, reason: null,
  needs_confirmation: true, summary: ['11/03 に予定「清水寺」を足します(10:00 から)'], problem: null, link: null, plan_revision: 3,
};
afterEach(() => {
  vi.useRealTimers();
});

describe('CommandPalette (Gate C3)', () => {
  it('経路からプランを読み取る', () => {
    expect(planIdFromPath(`/planner/${P}/candidates`)).toBe(P);
    expect(planIdFromPath(`/planner/${P}`)).toBe(P);
    expect(planIdFromPath('/planner')).toBeNull();
    expect(planIdFromPath('/dashboard')).toBeNull();
  });

  it('Ctrl+K で開き、止まってから1回だけこの旅行を探し、Enter で開く', async () => {
    renderAt(`/planner/${P}`);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: '検索' });
    const input = within(dialog).getByRole('combobox', { name: '検索語' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: '清' } });
    fireEvent.change(input, { target: { value: '清水' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(m.searchPlan).toHaveBeenCalledTimes(1));
    expect(m.searchPlan).toHaveBeenCalledWith(P, '清水', null);
    const group = await within(dialog).findByRole('group', { name: /予定\(1件\)/ });
    expect(within(group).getByRole('option', { name: /清水寺/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(within(dialog).getByRole('option', { name: /清水坂の茶店/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/planner/${P}/candidates`));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('絞り込み・すべての旅行・Esc で閉じる', async () => {
    renderAt(`/planner/${P}`);
    fireEvent.click(screen.getByRole('button', { name: '検索(Ctrl+K)' }));
    const dialog = await screen.findByRole('dialog', { name: '検索' });
    fireEvent.click(within(dialog).getByRole('button', { name: '今日' }));
    expect(within(dialog).getByRole('button', { name: '今日' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(m.searchPlan).toHaveBeenLastCalledWith(P, '', 'today'));
    fireEvent.click(within(dialog).getByLabelText('すべての旅行'));
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '京都' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(m.searchEverything).toHaveBeenLastCalledWith('京都', 'today'));
    expect(await within(dialog).findByRole('region', { name: '旅行' })).toHaveTextContent('京都の旅');
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('プランの外では、すべての旅行を探す。失敗は案内する', async () => {
    m.searchEverything.mockRejectedValueOnce(new Error('x'));
    renderAt('/dashboard');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: '検索' });
    expect(within(dialog).queryByLabelText('すべての旅行')).toBeNull();
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '京都' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('検索できませんでした');
  });

  it('[G4] 「>」はコマンド。Enter は確認まで、「実行する」で1回だけ実行し、元に戻せる', async () => {
    m.previewCommand.mockResolvedValue(ADD_PREVIEW);
    m.executeCommand.mockResolvedValue({ run_id: 'r1', status: 'executed', command: 'add_event', label: '予定を追加',
      undoable: true, message: '予定を足しました', link: `/planner/${P}`, plan_revision: 4 });
    m.undoCommand.mockResolvedValue({ run_id: 'r1', status: 'undone', plan_revision: 5, message: '元に戻しました' });
    renderAt(`/planner/${P}`);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: '検索' });
    const input = within(dialog).getByRole('combobox', { name: '検索語' });
    fireEvent.change(input, { target: { value: '>' } });
    const list = await within(dialog).findByRole('listbox', { name: 'コマンド' });
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    fireEvent.change(input, { target: { value: '>予定を追加 11/3 10:00 清水寺' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(m.searchPlan).not.toHaveBeenCalled(); // コマンドの時は検索しない
    fireEvent.keyDown(input, { key: 'Enter' });
    const confirm = await within(dialog).findByRole('region', { name: 'コマンドの確認' });
    expect(confirm).toHaveTextContent('清水寺');
    expect(m.previewCommand).toHaveBeenCalledWith(P, '>予定を追加 11/3 10:00 清水寺');
    expect(m.executeCommand).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: '実行する' }));
    await waitFor(() => expect(m.executeCommand).toHaveBeenCalledTimes(1));
    const [planId, text, rev, key] = m.executeCommand.mock.calls[0]!;
    expect([planId, text, rev]).toEqual([P, '>予定を追加 11/3 10:00 清水寺', 3]);
    expect(String(key)).toMatch(/.{8,}/);
    const res = await within(dialog).findByLabelText('コマンドの結果');
    expect(res).toHaveTextContent('予定を足しました');
    fireEvent.click(within(res).getByRole('button', { name: '元に戻す' }));
    await waitFor(() => expect(m.undoCommand).toHaveBeenCalledWith(P, 'r1', 4));
    expect(await within(dialog).findByLabelText('コマンドの結果')).toHaveTextContent('元に戻しました');
  });

  it('[G4] 閲覧だけの人は理由を見て実行できない。画面を開くコマンドは確認なしで移る', async () => {
    m.previewCommand.mockResolvedValueOnce({ ...ADD_PREVIEW, allowed: false, reason: 'この旅行では閲覧だけの権限のため、実行できません' });
    renderAt(`/planner/${P}`);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: '検索' });
    const input = within(dialog).getByRole('combobox', { name: '検索語' });
    fireEvent.change(input, { target: { value: '>予定を追加 11/3 x' } });
    await within(dialog).findByRole('listbox', { name: 'コマンド' });
    fireEvent.keyDown(input, { key: 'Enter' });
    const confirm = await within(dialog).findByRole('region', { name: 'コマンドの確認' });
    expect(within(confirm).getByRole('alert')).toHaveTextContent('閲覧だけ');
    expect(within(confirm).getByRole('button', { name: '実行する' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(dialog).queryByRole('region', { name: 'コマンドの確認' })).toBeNull();

    m.previewCommand.mockResolvedValueOnce({ ...ADD_PREVIEW, command: 'open_reservations', kind: 'navigate',
      needs_confirmation: false, undoable: false, link: `/planner/${P}/reservations` });
    fireEvent.change(input, { target: { value: '>予' } });
    const opt = await within(dialog).findByRole('option', { name: /予約を開く/ });
    fireEvent.click(opt);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/planner/${P}/reservations`));
    expect(m.executeCommand).not.toHaveBeenCalled();
  });

  it('[G4] 旅行の外ではコマンドを使えない', async () => {
    renderAt('/dashboard');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: '検索' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '>予定を追加' } });
    expect(await within(dialog).findByText('コマンドは、旅行を開いている時だけ使えます。')).toBeInTheDocument();
    expect(m.getCommands).not.toHaveBeenCalled();
  });
});
