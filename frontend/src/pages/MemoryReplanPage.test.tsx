/**
 * [Gate P17] MemoryReplanPage(過去の旅からの提案、FR-057)の画面テスト。
 * [Gate G7] MEM-03 同じ同行者の属性の根拠・移動手段の傾向(区間の前の余裕)の提案(実 backend の応答 g7Responses.json)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import g7 from '@/services/api/__fixtures__/g7Responses.json';
import type { G7MemoryReplan } from '@/services/api/types/g7';

const m = vi.hoisted(() => ({ getMemoryReplan: vi.fn(), applyMemoryReplan: vi.fn() }));
vi.mock('@/services/api', () => ({ applyMemoryReplan: m.applyMemoryReplan }));
vi.mock('@/services/api/g7', () => ({ getMemoryReplanG7: m.getMemoryReplan }));

import MemoryReplanPage from './MemoryReplanPage';

// 以前の(v1 の)応答に、v2 で足した項目を付けたもの
const v1 = (r: typeof fx.memory_replan | typeof fx.memory_replan_empty) => ({
  ...r, insights: r.insights.map((i) => ({ ...i, basis: 'all' })), transport_sample_count: 0,
  party: { with_children: false, with_seniors: false, size: 1, group: 'solo' }, party_label: '1人',
}) as unknown as G7MemoryReplan;
const data = v1(fx.memory_replan);

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
    m.getMemoryReplan.mockResolvedValue(v1(fx.memory_replan_empty));
    renderPage();
    expect(await screen.findByText(/まだ材料がありません/)).toBeInTheDocument();
  });
});

describe('MemoryReplanPage (Gate G7 MEM-03)', () => {
  it('同じ同行者の旅行の根拠と、区間の前の余裕を足す提案を示し、適用する', async () => {
    const v2 = g7.memory_replan_v2 as unknown as G7MemoryReplan;
    m.getMemoryReplan.mockResolvedValue(v2);
    renderPage();
    const insights = await screen.findByRole('region', { name: '見つかった傾向' });
    expect(insights).toHaveTextContent('バスの後は、予定より平均20分遅れて着いています');
    expect(insights).toHaveTextContent('同じ同行者(子ども連れ・1人)の旅行の');
    expect(screen.getByTestId('party-label')).toHaveTextContent('子ども連れ');
    const proposal = screen.getByRole('region', { name: 'この旅行への提案' });
    expect(within(proposal).getByRole('table')).toHaveTextContent('美冨久 → 藤居本家前の余裕0分前の余裕20分');
    fireEvent.click(within(proposal).getByRole('button', { name: 'この提案を適用' }));
    const prop = v2.proposals.find((p) => p.target === 'segment')!;
    await waitFor(() => expect(m.applyMemoryReplan).toHaveBeenCalledWith('p1', prop.id, v2.input_fingerprint, v2.plan_revision));
    expect(await screen.findByText(/移動2件の前の余裕を足しました|移動\d+件の前の余裕を足しました/)).toBeInTheDocument();
  });
});
