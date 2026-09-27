/**
 * [Gate B-014] 経路候補の採用・削除のIf-Matchは、backendでプランの版番号と照合される。
 * 以前は経路候補ごとのrevisionを送っていたため、画面からの採用・削除がほぼ常に409で失敗していた。
 * [Gate B-013] 採用済みの候補を削除しても採用した移動区間は残ることを案内する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';

const m = vi.hoisted(() => ({
  getPlanDetail: vi.fn(),
  getRouteOptions: vi.fn(),
  createRouteOption: vi.fn(),
  deleteRouteOption: vi.fn(),
  adoptRouteOption: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  default: { getPlanDetail: m.getPlanDetail },
  getRouteOptions: m.getRouteOptions,
  createRouteOption: m.createRouteOption,
  deleteRouteOption: m.deleteRouteOption,
  adoptRouteOption: m.adoptRouteOption,
}));

import RouteOptionsPage from './RouteOptionsPage';

const PLAN_REVISION = 9;
const option = { ...fx.route_option, status: 'candidate', revision: 1 };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/route-options']}>
      <Routes>
        <Route path="/planner/:planId/route-options" element={<RouteOptionsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RouteOptionsPage (Gate B-013/B-014)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    m.getRouteOptions.mockResolvedValue([option]);
    m.getPlanDetail.mockResolvedValue({ success: true, data: { ...fx.plan_detail, revision: PLAN_REVISION } });
  });

  it('削除はプランの版番号をIf-Matchに使い、採用した区間が残ることを知らせる', async () => {
    m.deleteRouteOption.mockResolvedValue(fx.route_option_deleted_adopted);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'この経路候補を削除' }));
    await waitFor(() => expect(m.deleteRouteOption).toHaveBeenCalledWith('p1', option.id, PLAN_REVISION));
    expect(await screen.findByRole('status')).toHaveTextContent('採用した移動区間1件は残っています');
  });

  it('採用もプランの版番号をIf-Matchに使う', async () => {
    m.adoptRouteOption.mockResolvedValue(fx.route_adopt);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'この経路候補を採用' }));
    await waitFor(() => expect(m.adoptRouteOption).toHaveBeenCalledWith('p1', option.id, PLAN_REVISION));
  });

  it('構造化された409のdetailはmessageを表示する(オブジェクトをそのまま描画しない)', async () => {
    m.deleteRouteOption.mockRejectedValue({ response: { status: 409, data: { detail: { code: 'x', message: '競合しました' } } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'この経路候補を削除' }));
    expect(await screen.findByText('競合しました')).toBeInTheDocument();
  });
});
