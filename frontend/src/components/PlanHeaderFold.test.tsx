/** [Gate HeadFold] 旅行のカードの詳細(目的地・期間・人数・予算と数字)は既定で閉じ、開閉を端末に覚える */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/usePlan', () => ({ usePlan: () => ({ duplicatePlan: vi.fn(), deletePlan: vi.fn() }) }));
vi.mock('../hooks/usePlan', () => ({ usePlan: () => ({ duplicatePlan: vi.fn(), deletePlan: vi.fn() }) }));
vi.mock('./common/toastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../services/api/g11', () => ({ getPlanCover: vi.fn().mockResolvedValue({ cover: null, can_edit: false }) }));

import PlanHeader from './PlanHeader';

const plan = {
  id: 'p1', title: '伊勢・鳥羽', destination: '伊勢・鳥羽', status: 'draft', budget: 120000,
  start_date: '2026-11-28', end_date: '2026-11-29',
  days: [{ id: 'd1', date: '2026-11-28', events: [{ id: 'e1', title: 'A', category: 'sightseeing' }] },
    { id: 'd2', date: '2026-11-29', events: [] }],
} as never;

describe('旅行のカードの詳細の開閉', () => {
  beforeEach(() => { try { window.localStorage.removeItem('tc.planHeadDetails'); } catch { /* 無い環境 */ } });

  it('既定は閉じて 1 行の要約だけ。開くと数字が出て、次も開いたまま', () => {
    const { unmount } = render(<MemoryRouter><PlanHeader plan={plan} /></MemoryRouter>);
    expect(screen.getByTestId('plan-head-summary')).toHaveTextContent('伊勢・鳥羽 · 2日間 · 予定 1件 · 予算 ¥120,000');
    expect(screen.queryByTestId('plan-head-details')).toBeNull();
    const toggle = screen.getByTestId('plan-head-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('plan-head-details')).toHaveTextContent('総スポット数');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    unmount();
    render(<MemoryRouter><PlanHeader plan={plan} /></MemoryRouter>);
    expect(screen.getByTestId('plan-head-details')).toBeInTheDocument();
  });
});
