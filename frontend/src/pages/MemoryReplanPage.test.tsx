/**
 * [Gate P17] MemoryReplanPage(過去の旅からの提案、FR-057)の画面テスト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { MemoryReplanResult } from '@/services/api';

const m = vi.hoisted(() => ({ getMemoryReplan: vi.fn(), applyMemoryReplan: vi.fn() }));
vi.mock('@/services/api', () => ({ ...m }));

import MemoryReplanPage from './MemoryReplanPage';

const data = fx.memory_replan as MemoryReplanResult;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/memory-replan']}>
      <Routes><Route path="/planner/:planId/memory-replan" element={<MemoryReplanPage />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getMemoryReplan.mockResolvedValue(data);
  m.applyMemoryReplan.mockResolvedValue(fx.memory_replan_applied);
  window.confirm = vi.fn(() => true);
});

describe('MemoryReplanPage (Gate P17)', () => {
  it('傾向を根拠つきで示し、提案の変わる予定・動かさない予定を見せる', async () => {
    renderPage();
    const insights = await screen.findByRole('region', { name: '見つかった傾向' });
    expect(insights).toHaveTextContent('「美術館・博物館」の予定では、実際の滞在が予定より平均45分長くなっています');
    expect(insights).toHaveTextContent('根拠: 上野2025・金沢2025の2件');
    const proposal = screen.getByRole('region', { name: 'この旅行への提案' });
    const rows = within(within(proposal).getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('湯豆腐12:0012:45');
    expect(within(proposal).getByRole('list', { name: '動かさない予定' })).toHaveTextContent('夜景: ずらすと日をまたぐため動かしません');
  });

  it('確認してから適用し(本案のrevisionと入力の版を送る)、取り消し方を案内する', async () => {
    renderPage();
    const proposal = await screen.findByRole('region', { name: 'この旅行への提案' });
    window.confirm = vi.fn(() => false);
    fireEvent.click(within(proposal).getByRole('button', { name: 'この提案を適用' }));
    expect(m.applyMemoryReplan).not.toHaveBeenCalled();
    window.confirm = vi.fn(() => true);
    fireEvent.click(within(proposal).getByRole('button', { name: 'この提案を適用' }));
    await waitFor(() => expect(m.applyMemoryReplan).toHaveBeenCalledWith('p1', data.proposals[0]!.id, data.input_fingerprint, data.plan_revision));
    expect(await screen.findByText(/予定2件の時刻をずらしました/)).toBeInTheDocument();
  });

  it('材料が無い時と、閲覧者には適用ボタンを出さない', async () => {
    m.getMemoryReplan.mockResolvedValue({ ...data, can_apply: false });
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'この旅行への提案' });
    expect(screen.queryByRole('button', { name: 'この提案を適用' })).toBeNull();
    unmount();
    m.getMemoryReplan.mockResolvedValue(fx.memory_replan_empty);
    renderPage();
    expect(await screen.findByText(/まだ材料がありません/)).toBeInTheDocument();
  });
});
