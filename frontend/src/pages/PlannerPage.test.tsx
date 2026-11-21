/**
 * [Gate M9-FE-B3] PlannerPage: effect依存を正しく宣言した後の発火回数を固定する回帰テスト。
 * - 詳細画面ではloadPlanをplanIdごとに1回だけ呼ぶ(一覧読込・clearは呼ばない)
 * - オフライン保存有無の判定はプランIDが変わった時だけ(プラン内容の更新では再判定しない)
 * - 移動概算(route-preview)は表示中の日が変わった時だけ再取得する
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// 描画が重い子コンポーネント(地図・日程編集等)は本テストの対象外のため空にする
// [Gate Remaining-2] 祝日は取りに行かない(外の通信を差し替える)
vi.mock('@/hooks/usePlanHolidays', () => ({ usePlanHolidays: () => ({}) }));
vi.mock('@/components/planner/variants/usePlanVariants', () => ({
  usePlanVariants: () => ({ canEdit: false, variants: [], openId: null, setOpenId: () => {}, open: null, checkSum: null,
    reload: () => {}, datesWithStandby: [] }),
}));
vi.mock('@/components/planner/variants/VariantPanel', () => ({ default: () => null }));
vi.mock('@/components/PlanHeader', () => ({ default: () => null }));
vi.mock('@/components/planning/PlanningUsageMeter', () => ({ default: () => null }));
vi.mock('@/components/DayView', () => ({ default: () => null }));
vi.mock('@/components/planner/DateNavigation', () => ({ default: () => null }));
vi.mock('@/components/planner/OptimizationPanel', () => ({ default: () => null }));
// [Gate② UX P0] 地図に渡す「選んだ予定」だけを見られるようにする(地図そのものは描かない)
vi.mock('@/components/planner/PlanMap', () => ({
  default: ({ selectedEventId }: { selectedEventId?: string | null }) => <i data-testid="map-selected" data-id={selectedEventId ?? ''} />,
}));

import PlannerPage from './PlannerPage';
import { ToastProvider } from '@/components/common/Toast';
import { usePlanStore } from '@/store/planStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/services/api';
import type { TravelPlan } from '@/types';
import * as offlinePack from '@/utils/offlinePack';
import * as offlineVault from '@/utils/offlineVault';
// [Gate BookingBadge] 予約の札の読み込み(旅程の予定ごと)は空にする
vi.mock('@/services/api/bookingStatus', () => ({
  getBookingStatus: vi.fn().mockResolvedValue({ party_size: null, events: {} }), linkReservationToEvent: vi.fn(),
}));


// [Gate G3] DEP-04 待つ間の画面の更新を act の中で行う
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

const makePlan = (days: string[], title = 'trip'): TravelPlan =>
  ({
    id: 'plan-1',
    title,
    days: days.map((id) => ({ id, events: [] })),
  }) as unknown as TravelPlan;

const setupMocks = () => {
  const loadPlan = vi.fn<(planId: string) => Promise<boolean>>().mockResolvedValue(true);
  const loadPlans = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const clearCurrentPlan = vi.fn<() => void>();
  const getOfflinePackExpiry = vi.spyOn(offlinePack, 'getOfflinePackExpiry').mockResolvedValue(null);
  vi.spyOn(offlineVault, 'getStoredOfflineKeyExpiry').mockResolvedValue(null);
  usePlanStore.setState({
    plans: [],
    currentPlan: null,
    currentDayIndex: 0,
    isLoading: false,
    loadPlan,
    loadPlans,
    clearCurrentPlan,
  });
  useAuthStore.setState({ isAuthenticated: true, isGuest: false });
  // [Gate C1] 共同編集の知らせ(この試験の対象外。通信しない)
  vi.spyOn(api, 'postPresence').mockResolvedValue({
    plan_id: 'plan-1', revision: 0, viewers: [], changes: [], poll_seconds: 15, ttl_seconds: 40,
  });
  vi.spyOn(api, 'leavePresence').mockResolvedValue(undefined);
  // 一覧画面の「削除済み」(この試験の対象外。通信しない)
  vi.spyOn(api, 'getDeletedPlans').mockResolvedValue([]);
  vi.spyOn(api, 'getSegments').mockResolvedValue([]);  // [Gate G11] 予定へ着く移動区間
  // [Gate G2] 即時の通知は使わない(ポーリングだけ)。同行者向けの項目の規則: 何も隠されていない
  vi.spyOn(api, 'streamPlanEvents').mockResolvedValue('unsupported');
  vi.spyOn(api, 'getMemberPolicy').mockResolvedValue({
    plan_id: 'plan-1', role: 'owner', my_hidden: [], catalog: { version: 1, categories: [], presets: {} },
  });
  const getRoutePreview = vi
    .spyOn(api, 'getRoutePreview')
    .mockResolvedValue({ legs: [] } as unknown as Awaited<ReturnType<typeof api.getRoutePreview>>);
  return { loadPlan, loadPlans, clearCurrentPlan, getOfflinePackExpiry, getRoutePreview };
};

describe('PlannerPage effects (Gate M9-FE-B3)', () => {
  it('詳細画面ではloadPlanを1回だけ呼び、プラン更新ではオフライン判定・移動概算を再取得しない', async () => {
    const { loadPlan, loadPlans, clearCurrentPlan, getOfflinePackExpiry, getRoutePreview } = setupMocks();
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
    await waitFor(() => expect(getOfflinePackExpiry).toHaveBeenCalledTimes(1));
    expect(getOfflinePackExpiry).toHaveBeenCalledWith('plan-1');
    await waitFor(() => expect(getRoutePreview).toHaveBeenCalledTimes(1));
    expect(getRoutePreview).toHaveBeenCalledWith('plan-1', 'day-a', 'walking');

    // 同じプランIDのまま内容が更新(タイトル変更・日の追加)されても再取得しない
    act(() => {
      usePlanStore.setState({ currentPlan: makePlan(['day-a', 'day-b', 'day-c'], 'renamed') });
    });
    await sleep(50);
    expect(getOfflinePackExpiry).toHaveBeenCalledTimes(1);
    expect(getRoutePreview).toHaveBeenCalledTimes(1);
    expect(loadPlan).toHaveBeenCalledTimes(1);

    // 表示中の日を切り替えた時だけ移動概算を再取得する
    act(() => {
      usePlanStore.setState({ currentDayIndex: 1 });
    });
    await waitFor(() => expect(getRoutePreview).toHaveBeenCalledTimes(2));
    expect(getRoutePreview).toHaveBeenLastCalledWith('plan-1', 'day-b', 'walking');
    await sleep(50);
    expect(getOfflinePackExpiry).toHaveBeenCalledTimes(1);
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

  it('[DashPlan] ゲストの始め方: 旅行相談は AI なしで使えると示す(AI・Google は会員)', async () => {
    setupMocks();
    useAuthStore.setState({ isAuthenticated: true, isGuest: true });
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/planner']}>
          <Routes>
            <Route path="/planner" element={<PlannerPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );
    expect(await screen.findByTestId('planner-consult-guest')).toHaveTextContent('ゲストでは、AI の方面の提案・おすすめの場所・Google の検索は使えません');
    expect(screen.getByRole('button', { name: '✦ AI なしで相談をはじめる' })).toBeEnabled();
  });
});

describe('[Gate② UX P0] 全体の検索からの「プランに追加」', () => {
  it('入る場所(日を選べる・時刻なし)を押す前に示し、日が 2 日ある旅行は日を選んでから、その日へ追加する', async () => {
    const { loadPlans } = setupMocks();
    // 旅行の一覧(この試験の対象外。通信しない)
    const g9 = await import('@/services/api/g9');
    vi.spyOn(g9, 'getDashboard').mockResolvedValue({ trips: [], focus: null } as unknown as Awaited<ReturnType<typeof g9.getDashboard>>);
    const plan = makePlan(['day-a', 'day-b'], '京都');
    // 追加すると 1 日目に予定が 1 つ増える(store の代わり)
    const addScheduleItem = vi.fn<(dayIndex: number, item: Record<string, unknown>) => Promise<void>>(async () => {
      const cur = usePlanStore.getState().currentPlan!;
      usePlanStore.setState({ currentPlan: { ...cur, days: [{ ...cur.days[0]!, events: [{ id: 'ev-new', title: '清水寺' }] }, ...cur.days.slice(1)] } as unknown as TravelPlan });
    });
    usePlanStore.setState({
      plans: [plan],
      loadPlan: vi.fn(async () => { usePlanStore.setState({ currentPlan: plan }); return true; }),
      addScheduleItem,
    } as Partial<ReturnType<typeof usePlanStore.getState>>);
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: '/planner', state: { newSpot: { name: '清水寺', category: 'sightseeing' } } }]}>
          <Routes>
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/planner/:planId" element={<FocusProbe />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );
    await waitFor(() => expect(loadPlans).toHaveBeenCalled());
    expect(await screen.findByTestId('add-spot-where')).toHaveTextContent('旅行を選ぶと、入れる日を選べます');
    const dialog = screen.getByTestId('add-spot-where').closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: /京都/ }));
    // 日が 2 日あるので、まだ追加せずに日を選ぶ段へ
    fireEvent.click(await screen.findByTestId('add-spot-day-0'));
    await waitFor(() => expect(addScheduleItem).toHaveBeenCalledTimes(1));
    expect(addScheduleItem.mock.calls[0]![0]).toBe(0);  // 1 日目
    expect(addScheduleItem.mock.calls[0]![1]).not.toHaveProperty('start_time');
    // 追加した予定を選んだ状態で旅程を開く
    expect(await screen.findByTestId('focus-probe')).toHaveTextContent('ev-new');
  });

  it('旅程を focusEventId つきで開くと、その予定を選んだ状態にする(地図・旅程で見つけやすく)', async () => {
    const { loadPlan } = setupMocks();
    const plan = { ...makePlan(['day-a']), days: [{ id: 'day-a', events: [{ id: 'ev-new', title: '清水寺' }] }] } as unknown as TravelPlan;
    loadPlan.mockImplementation(async () => { usePlanStore.setState({ currentPlan: plan }); return true; });
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: '/planner/plan-1', state: { focusEventId: 'ev-new' } }]}>
          <Routes><Route path="/planner/:planId" element={<PlannerPage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    );
    await waitFor(() => expect(screen.getAllByTestId('map-selected').some((m) => m.getAttribute('data-id') === 'ev-new')).toBe(true));
  });

  // 検索から追加する窓を開いた状態を作る(旅行 1 件。追加の関数は試験ごとに渡す)
  const openAddModal = async (overrides: Partial<ReturnType<typeof usePlanStore.getState>>, newSpot: Record<string, unknown>,
    dayIds: string[] = ['day-a']) => {
    const { loadPlans } = setupMocks();
    const g9 = await import('@/services/api/g9');
    vi.spyOn(g9, 'getDashboard').mockResolvedValue({ trips: [], focus: null } as unknown as Awaited<ReturnType<typeof g9.getDashboard>>);
    const plan = makePlan(dayIds, '京都');
    usePlanStore.setState({
      plans: [plan],
      loadPlan: vi.fn(async () => { usePlanStore.setState({ currentPlan: plan }); return true; }),
      ...overrides,
    } as Partial<ReturnType<typeof usePlanStore.getState>>);
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: '/planner', state: { newSpot } }]}>
          <Routes>
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/planner/:planId" element={<FocusProbe />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    );
    await waitFor(() => expect(loadPlans).toHaveBeenCalled());
    const dialog = (await screen.findByTestId('add-spot-where')).closest('[role="dialog"]') as HTMLElement;
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /京都/ })); });
  };
  const addToDay0 = (id: string) => addToDay(0, id);
  const addToDay = (dayIndex: number, id: string) => {
    const cur = usePlanStore.getState().currentPlan!;
    usePlanStore.setState({ currentPlan: { ...cur, days: cur.days.map((d, i) => (i === dayIndex ? { ...d, events: [...d.events, { id, title: '清水寺' }] } : d)) } as unknown as TravelPlan });
  };

  it('日が 2 日以上ある旅行では、選んだ日(2 日目)へ追加し、その予定を選んで開く', async () => {
    const addScheduleItem = vi.fn<(dayIndex: number, item: Record<string, unknown>) => Promise<void>>(async (i) => { addToDay(i, 'ev-d2'); });
    await openAddModal({ addScheduleItem }, { name: '清水寺', category: 'sightseeing' }, ['day-a', 'day-b']);
    expect(addScheduleItem).not.toHaveBeenCalled();  // 旅行を選んだだけでは入れない
    const days = await screen.findByTestId('add-spot-days');
    expect(within(days).getByTestId('add-spot-day-1')).toHaveTextContent('2 日目');
    await act(async () => { fireEvent.click(within(days).getByTestId('add-spot-day-1')); });
    expect(addScheduleItem.mock.calls[0]![0]).toBe(1);
    expect(await screen.findByTestId('focus-probe')).toHaveTextContent('ev-d2');
  });

  it('日を選ぶ段から「旅行を選び直す」で旅行の一覧へ戻れる(何も追加しない)', async () => {
    const addScheduleItem = vi.fn<(dayIndex: number, item: Record<string, unknown>) => Promise<void>>(async () => {});
    await openAddModal({ addScheduleItem }, { name: '清水寺', category: 'sightseeing' }, ['day-a', 'day-b']);
    fireEvent.click(await screen.findByTestId('add-spot-day-back'));
    expect(screen.queryByTestId('add-spot-days')).toBeNull();
    const dialog = screen.getByTestId('add-spot-where').closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByRole('button', { name: /京都/ })).toBeInTheDocument();
    expect(addScheduleItem).not.toHaveBeenCalled();
  });

  it('追加に失敗した時(予定が増えない)は「追加しました」と言わず、窓を残して旅程へ移らない', async () => {
    // store の addScheduleItem は失敗しても例外を投げず、元に戻して知らせる
    const addScheduleItem = vi.fn<(dayIndex: number, item: Record<string, unknown>) => Promise<void>>(async () => {});
    await openAddModal({ addScheduleItem }, { name: '清水寺', category: 'sightseeing' });
    await waitFor(() => expect(addScheduleItem).toHaveBeenCalledTimes(1));
    await sleep(0);
    expect(screen.queryByTestId('focus-probe')).toBeNull();
    expect(screen.getByTestId('add-spot-where')).toBeInTheDocument();
    expect(screen.queryByText('清水寺をプランに追加しました')).toBeNull();
  });

  it('検索の候補(candidate_id)から追加した時も、増えた予定(場所の ID でなく予定の ID)を選んで開く', async () => {
    const addScheduleItemFromCandidate = vi.fn<(dayIndex: number, candidateId: string, title?: string) => Promise<boolean>>(
      async () => { addToDay0('ev-from-cand'); return true; });
    await openAddModal({ addScheduleItemFromCandidate }, { name: '清水寺', candidate_id: 'cand-1' });
    expect(await screen.findByTestId('focus-probe')).toHaveTextContent('ev-from-cand');
    expect(addScheduleItemFromCandidate.mock.calls[0]).toEqual([0, 'cand-1', '清水寺']);
  });

  it('候補からの追加が失敗した時は旅程へ移らない(窓を残し、もう一度押せる)', async () => {
    const addScheduleItemFromCandidate = vi.fn<(dayIndex: number, candidateId: string, title?: string) => Promise<boolean>>(
      async () => false);
    await openAddModal({ addScheduleItemFromCandidate }, { name: '清水寺', candidate_id: 'cand-1' });
    await waitFor(() => expect(addScheduleItemFromCandidate).toHaveBeenCalledTimes(1));
    await sleep(0);
    expect(screen.queryByTestId('focus-probe')).toBeNull();
    const dialog = screen.getByTestId('add-spot-where').closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByRole('button', { name: /京都/ })).not.toBeDisabled();
  });

  const openWithFocus = (plan: TravelPlan, focusEventId: string, loadPlan: ReturnType<typeof setupMocks>['loadPlan']) => {
    loadPlan.mockImplementation(async () => { usePlanStore.setState({ currentPlan: plan }); return true; });
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: '/planner/plan-1', state: { focusEventId } }]}>
          <Routes><Route path="/planner/:planId" element={<><PlannerPage /><FocusProbe /></>} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    );
  };

  it('別の日を見ていても、追加した予定のある日(1 日目)を開いて選び、選んだ後は印を消す', async () => {
    const { loadPlan } = setupMocks();
    usePlanStore.setState({ currentDayIndex: 1 });  // 2 日目を見ていた
    const plan = { ...makePlan([]), days: [{ id: 'day-a', events: [{ id: 'ev-new', title: '清水寺' }] }, { id: 'day-b', events: [] }] } as unknown as TravelPlan;
    openWithFocus(plan, 'ev-new', loadPlan);
    await waitFor(() => expect(usePlanStore.getState().currentDayIndex).toBe(0));
    await waitFor(() => expect(screen.getAllByTestId('map-selected').some((m) => m.getAttribute('data-id') === 'ev-new')).toBe(true));
    // 再読み込み・戻る操作で選び直さないよう、履歴の印は消す
    await waitFor(() => expect(screen.getByTestId('focus-probe')).toHaveTextContent(''));
  });

  it('開いた旅行に無い予定の印(古い・別の旅行)は何も選ばず、印だけ消す', async () => {
    const { loadPlan } = setupMocks();
    const plan = { ...makePlan([]), days: [{ id: 'day-a', events: [{ id: 'ev-1', title: '清水寺' }] }] } as unknown as TravelPlan;
    openWithFocus(plan, 'ev-gone', loadPlan);
    await waitFor(() => expect(screen.getByTestId('focus-probe')).toHaveTextContent(''));
    expect(screen.getAllByTestId('map-selected').every((m) => m.getAttribute('data-id') === '')).toBe(true);
  });
});

function FocusProbe() {
  const loc = useLocation();
  return <p data-testid="focus-probe">{(loc.state as { focusEventId?: string } | null)?.focusEventId ?? ''}</p>;
}
