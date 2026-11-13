/**
 * [Gate EventMoveDay] 予定の編集の窓の「日付」で、別の日へ移す(ほかの項目を保存した後に移す)。
 * 準備は PlannerPage.spotLinks.test.tsx と同じ。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ScheduleItem } from '@/types';

// [Gate Remaining-2] 祝日は取りに行かない(外の通信を差し替える)
vi.mock('@/hooks/usePlanHolidays', () => ({ usePlanHolidays: () => ({}) }));
vi.mock('@/components/planner/variants/usePlanVariants', () => ({
  usePlanVariants: () => ({ canEdit: false, variants: [], openId: null, setOpenId: () => {}, open: null, checkSum: null,
    reload: () => {}, datesWithStandby: [] }),
}));
vi.mock('@/components/planner/variants/VariantPanel', () => ({ default: () => null }));
vi.mock('@/components/PlanHeader', () => ({ default: () => null }));
vi.mock('@/components/planning/PlanningUsageMeter', () => ({ default: () => null }));
vi.mock('@/components/planner/DateNavigation', () => ({ default: () => null }));
vi.mock('@/components/planner/OptimizationPanel', () => ({ default: () => null }));
vi.mock('@/components/planner/PlanMap', () => ({ default: () => null }));
vi.mock('@/components/planner/EventPhotoPanel', () => ({ default: () => null }));
vi.mock('@/components/planner/EventRelatedSummary', () => ({ default: () => null }));
vi.mock('@/components/planner/SpotMiniMap', () => ({ default: () => null }));
vi.mock('@/services/api/planEdit', () => ({ getPlaceInfo: vi.fn(), reorderDay: vi.fn() }));
vi.mock('@/components/DayView', () => ({
  default: ({ day, onItemEdit }: { day: { events: ScheduleItem[] }; onItemEdit: (i: ScheduleItem) => void }) => (
    <div>{day.events.map((e) => <button key={e.id} type="button" onClick={() => onItemEdit(e)}>編集: {e.title}</button>)}</div>
  ),
}));

import PlannerPage from './PlannerPage';
import { ToastProvider } from '@/components/common/Toast';
import { usePlanStore } from '@/store/planStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/services/api';
import type { TravelPlan } from '@/types';
// [Gate BookingBadge] 予約の札の読み込み(旅程の予定ごと)は空にする
vi.mock('@/services/api/bookingStatus', () => ({
  getBookingStatus: vi.fn().mockResolvedValue({ party_size: null, events: {} }), linkReservationToEvent: vi.fn(),
}));


const plan = (): TravelPlan => ({
  id: 'plan-1', title: 'trip', revision: 3,
  days: [
    { id: 'd1', date: '2026-11-28', events: [{ id: 'e1', title: '宿', category: 'accommodation', start_time: '15:00' }] },
    { id: 'd2', date: '2026-11-29', events: [{ id: 'e2', title: '朝の散歩', category: 'sightseeing', start_time: '09:00' },
      { id: 'e3', title: '昼', category: 'dining', start_time: '18:00' }] },
  ],
}) as unknown as TravelPlan;

function setup() {
  const updateScheduleItem = vi.fn().mockResolvedValue('saved');
  const moveItemBetweenDays = vi.fn().mockResolvedValue(true);
  usePlanStore.setState({
    plans: [], currentPlan: plan(), currentDayIndex: 0, isLoading: false, isOfflineData: false,
    loadPlan: vi.fn().mockResolvedValue(true), loadPlans: vi.fn(), clearCurrentPlan: vi.fn(),
    checkOfflineAvailability: vi.fn().mockResolvedValue(false), updateScheduleItem, moveItemBetweenDays,
  });
  useAuthStore.setState({ isAuthenticated: true, isGuest: false });
  vi.spyOn(api, 'getRoutePreview').mockResolvedValue({ legs: [] } as unknown as Awaited<ReturnType<typeof api.getRoutePreview>>);
  vi.spyOn(api, 'leavePresence').mockResolvedValue(undefined);
  vi.spyOn(api, 'getSegments').mockResolvedValue([]);
  vi.spyOn(api, 'streamPlanEvents').mockResolvedValue('unsupported');
  vi.spyOn(api, 'getMemberPolicy').mockResolvedValue({
    plan_id: 'plan-1', role: 'owner', my_hidden: [], catalog: { version: 1, categories: [], presets: {} },
  });
  vi.spyOn(api, 'postPresence').mockResolvedValue({ plan_id: 'plan-1', revision: 3, poll_seconds: 5, ttl_seconds: 40, viewers: [], changes: [] });
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/planner/plan-1']}>
        <Routes><Route path="/planner/:planId" element={<PlannerPage />} /></Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
  return { updateScheduleItem, moveItemBetweenDays };
}

describe('PlannerPage 予定の日付を変える (Gate EventMoveDay)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('日付を変えて保存すると、保存の後に時刻の順の位置でその日へ移す', async () => {
    const { updateScheduleItem, moveItemBetweenDays } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '編集: 宿' }));
    const select = screen.getByTestId('edit-day') as HTMLSelectElement;
    expect(select.value).toBe('0');
    fireEvent.change(select, { target: { value: '1' } });
    expect(screen.getByTestId('edit-day-note')).toHaveTextContent('保存すると 11/29');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(moveItemBetweenDays).toHaveBeenCalledWith('e1', 0, 1, 1));
    expect(updateScheduleItem).toHaveBeenCalledTimes(1);
    expect(updateScheduleItem.mock.invocationCallOrder[0]!).toBeLessThan(moveItemBetweenDays.mock.invocationCallOrder[0]!);
  });

  it('日付を変えなければ移さない', async () => {
    const { moveItemBetweenDays, updateScheduleItem } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '編集: 宿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateScheduleItem).toHaveBeenCalled());
    expect(moveItemBetweenDays).not.toHaveBeenCalled();
  });
});
