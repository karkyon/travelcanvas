/**
 * [Gate B-014] 移動区間の更新・削除のIf-Matchは、backendでプランの版番号と照合される。
 * 以前は区間ごとのrevisionを送っていたため、画面からの編集・削除がほぼ常に409で失敗していた。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';

const m = vi.hoisted(() => ({
  getPlanDetail: vi.fn(),
  getPlace: vi.fn(),
  getSegments: vi.fn(),
  createSegment: vi.fn(),
  updateSegment: vi.fn(),
  deleteSegment: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  default: { getPlanDetail: m.getPlanDetail, getPlace: m.getPlace },
  getSegments: m.getSegments,
  createSegment: m.createSegment,
  updateSegment: m.updateSegment,
  deleteSegment: m.deleteSegment,
}));

import SegmentsPage from './SegmentsPage';

const PLAN_REVISION = 12;
const segment = { ...fx.segment, revision: 2 };

describe('SegmentsPage (Gate B-014)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    m.getSegments.mockResolvedValue([segment]);
    m.getPlace.mockResolvedValue(fx.place);
    m.getPlanDetail.mockResolvedValue({ success: true, data: { ...fx.plan_detail, revision: PLAN_REVISION } });
  });

  it('削除はプランの版番号をIf-Matchに使う', async () => {
    m.deleteSegment.mockResolvedValue({ revision: PLAN_REVISION + 1 });
    render(
      <MemoryRouter initialEntries={['/planner/p1/segments']}>
        <Routes>
          <Route path="/planner/:planId/segments" element={<SegmentsPage />} />
        </Routes>
      </MemoryRouter>
    );
    await userEvent.click(await screen.findByRole('button', { name: 'この移動区間を削除' }));
    await waitFor(() => expect(m.deleteSegment).toHaveBeenCalledWith('p1', segment.id, PLAN_REVISION));
  });
});
