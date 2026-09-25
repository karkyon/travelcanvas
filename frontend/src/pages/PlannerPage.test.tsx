/**
 * [Gate M9-FE-B3] PlannerPage: effect依存を正しく宣言した後の発火回数を固定する回帰テスト。
 * - 詳細画面ではloadPlanをplanIdごとに1回だけ呼ぶ(一覧読込・clearは呼ばない)
 * - オフライン保存有無の判定はプランIDが変わった時だけ(プラン内容の更新では再判定しない)
 * - 移動概算(route-preview)は表示中の日が変わった時だけ再取得する
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// 描画が重い子コンポーネント(地図・日程編集等)は本テストの対象外のため空にする
vi.mock('@/components/PlanHeader', () => ({ default: () => null }));
vi.mock('@/components/DayView', () => ({ default: () => null }));
vi.mock('@/components/planner/DateNavigation', () => ({ default: () => null }));
vi.mock('@/components/planner/OptimizationPanel', () => ({ default: () => null }));
vi.mock('@/components/planner/PlanMap', () => ({ default: () => null }));

import PlannerPage from './PlannerPage';
import { ToastProvider } from '@/components/common/Toast';
import { usePlanStore } from '@/store/planStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/services/api';
import type { TravelPlan } from '@/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const makePlan = (days: string[], title = 'trip'): TravelPlan =>
  ({
    id: 'plan-1',
    title,
    days: days.map((id) => ({ id, events: [] })),
  }) as unknown as TravelPlan;

const setupMocks = () => {
  const loadPlan = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);
  const loadPlans = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
  const clearCurrentPlan = vi.fn<[], void>();
  const checkOfflineAvailability = vi.fn<[string], Promise<boolean>>().mockResolvedValue(false);
  usePlanStore.setState({
    plans: [],
    currentPlan: null,
    currentDayIndex: 0,
    isLoading: false,
    loadPlan,
    loadPlans,
    clearCurrentPlan,
    checkOfflineAvailability,
  });
  useAuthStore.setState({ isAuthenticated: true, isGuest: false });
  const getRoutePreview = vi
    .spyOn(api, 'getRoutePreview')
    .mockResolvedValue({ legs: [] } as unknown as Awaited<ReturnType<typeof api.getRoutePreview>>);
  return { loadPlan, loadPlans, clearCurrentPlan, checkOfflineAvailability, getRoutePreview };
};

describe('PlannerPage effects (Gate M9-FE-B3)', () => {
  it('詳細画面ではloadPlanを1回だけ呼び、プラン更新ではオフライン判定・移動概算を再取得しない', async () => {
    const { loadPlan, loadPlans, clearCurrentPlan, checkOfflineAvailability, getRoutePreview } = setupMocks();
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/planner/plan-1']}>
          <Routes>
            <Route path="/planner/:planId" element={<PlannerPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );
    await waitFor(() => expect(loadPlan).toHaveBeenCalledTimes(1));
    expect(loadPlan).toHaveBeenCalledWith('plan-1');
    expect(loadPlans).not.toHaveBeenCalled();
    expect(clearCurrentPlan).not.toHaveBeenCalled();

    // loadPlan完了相当: currentPlanが設定される
    act(() => {
      usePlanStore.setState({ currentPlan: makePlan(['day-a', 'day-b']) });
    });
    await waitFor(() => expect(checkOfflineAvailability).toHaveBeenCalledTimes(1));
    expect(checkOfflineAvailability).toHaveBeenCalledWith('plan-1');
    await waitFor(() => expect(getRoutePreview).toHaveBeenCalledTimes(1));
    expect(getRoutePreview).toHaveBeenCalledWith('plan-1', 'day-a', 'walking');

    // 同じプランIDのまま内容が更新(タイトル変更・日の追加)されても再取得しない
    act(() => {
      usePlanStore.setState({ currentPlan: makePlan(['day-a', 'day-b', 'day-c'], 'renamed') });
    });
    await sleep(50);
    expect(checkOfflineAvailability).toHaveBeenCalledTimes(1);
    expect(getRoutePreview).toHaveBeenCalledTimes(1);
    expect(loadPlan).toHaveBeenCalledTimes(1);

    // 表示中の日を切り替えた時だけ移動概算を再取得する
    act(() => {
      usePlanStore.setState({ currentDayIndex: 1 });
    });
    await waitFor(() => expect(getRoutePreview).toHaveBeenCalledTimes(2));
    expect(getRoutePreview).toHaveBeenLastCalledWith('plan-1', 'day-b', 'walking');
    await sleep(50);
    expect(checkOfflineAvailability).toHaveBeenCalledTimes(1);
  });

  it('一覧画面ではloadPlansとclearCurrentPlanを1回ずつ呼ぶ', async () => {
    const { loadPlan, loadPlans, clearCurrentPlan } = setupMocks();
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/planner']}>
          <Routes>
            <Route path="/planner" element={<PlannerPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );
    await waitFor(() => expect(loadPlans).toHaveBeenCalledTimes(1));
    await sleep(50);
    expect(loadPlans).toHaveBeenCalledTimes(1);
    expect(clearCurrentPlan).toHaveBeenCalledTimes(1);
    expect(loadPlan).not.toHaveBeenCalled();
  });
});
