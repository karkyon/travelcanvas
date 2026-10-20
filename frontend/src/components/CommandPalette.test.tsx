/**
 * [Gate C3] CommandPalette(情報内検索、FR-009)の画面テスト。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import { planIdFromPath } from '@/utils/commandPalette';

const m = vi.hoisted(() => ({ searchPlan: vi.fn(), searchEverything: vi.fn() }));
vi.mock('@/services/api', () => ({ ...m }));

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
});
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
});
