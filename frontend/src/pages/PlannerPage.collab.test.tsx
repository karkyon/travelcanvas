/**
 * [Gate C1] FR-020 共同編集: プランナーの画面で、他の人・編集中・変更を示し、保存が競合したら入力を残して違いを示し、
 * 「自分の変更を最新の内容に重ねて保存」で自分が変えた項目だけを保存する(黙って上書きしない)。
 * また、編集画面の「場所」「メモ」が保存の通信に載る(以前は黙って捨てていた)。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ScheduleItem } from '@/types';

vi.mock('@/components/PlanHeader', () => ({ default: () => null }));
vi.mock('@/components/planning/PlanningUsageMeter', () => ({ default: () => null }));
vi.mock('@/components/planner/DateNavigation', () => ({ default: () => null }));
vi.mock('@/components/planner/OptimizationPanel', () => ({ default: () => null }));
vi.mock('@/components/planner/PlanMap', () => ({ default: () => null }));
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

const plan = (title: string, revision: number, notes?: string): TravelPlan => ({
  id: 'plan-1', title: 'trip', revision,
  days: [{ id: 'd1', date: '2026-11-02', events: [{ id: 'e1', title, category: 'sightseeing', start_time: '10:00', description: notes }] }],
}) as unknown as TravelPlan;

function setup() {
  const updateScheduleItem = vi.fn();
  const loadPlan = vi.fn().mockResolvedValue(true);
  usePlanStore.setState({
    plans: [], currentPlan: plan('清水寺', 3), currentDayIndex: 0, isLoading: false, isOfflineData: false,
    loadPlan, loadPlans: vi.fn(), clearCurrentPlan: vi.fn(),
    checkOfflineAvailability: vi.fn().mockResolvedValue(false), updateScheduleItem,
  });
  useAuthStore.setState({ isAuthenticated: true, isGuest: false });
  vi.spyOn(api, 'getRoutePreview').mockResolvedValue({ legs: [] } as unknown as Awaited<ReturnType<typeof api.getRoutePreview>>);
  vi.spyOn(api, 'leavePresence').mockResolvedValue(undefined);
  vi.spyOn(api, 'getSegments').mockResolvedValue([]);  // [Gate G11] 予定へ着く移動区間
  // [Gate G2] 即時の通知は使わない(ポーリングだけ)。同行者向けの項目の規則: 何も隠されていない
  vi.spyOn(api, 'streamPlanEvents').mockResolvedValue('unsupported');
  vi.spyOn(api, 'getMemberPolicy').mockResolvedValue({
    plan_id: 'plan-1', role: 'owner', my_hidden: [], catalog: { version: 1, categories: [], presets: {} },
  });
  vi.spyOn(api, 'postPresence').mockResolvedValue({
    plan_id: 'plan-1', revision: 4, poll_seconds: 5, ttl_seconds: 40,
    viewers: [
      { user_id: 'a', label: 'あなた', role: 'owner', is_self: true, devices: 1, seen_at: '', editing: null },
      { user_id: 'b', label: 'hana', role: 'editor', is_self: false, devices: 1, seen_at: '',
        editing: { kind: 'event', id: 'e1', label: '清水寺' } },
    ],
    changes: [{ revision: 4, actor_label: 'hana', is_self: false, source: 'manual', undone: false, count: 1,
      items: [{ entity_type: 'travel_event', action: 'update', label: '清水寺(朝)' }], at: null }],
  });
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/planner/plan-1']}>
        <Routes><Route path="/planner/:planId" element={<PlannerPage />} /></Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
  return { updateScheduleItem, loadPlan };
}

describe('PlannerPage 共同編集 (Gate C1 FR-020)', () => {
  afterEach(() => {
    // [Gate G3] DEP-04 差し替えを戻す前に閉じる(閉じる時の知らせが本物の通信にならない)
    cleanup();
    vi.restoreAllMocks();
  });

  it('他の人・編集中・変更を示し、競合したら違いを示して自分の変更だけを重ねて保存する', async () => {
    const { updateScheduleItem } = setup();
    const bar = await screen.findByRole('region', { name: '一緒に見ている人' });
    await waitFor(() => expect(bar).toHaveTextContent('hanaさん(編集者)・「清水寺」を編集中'));
    expect(within(bar).getByRole('status')).toHaveTextContent('hanaさんが「清水寺(朝)」を更新しました');

    fireEvent.click(screen.getByRole('button', { name: '編集: 清水寺' }));
    expect(await screen.findByText(/hanaさんもこの予定を編集中です/)).toBeInTheDocument();
    // 競合: 保存すると 409 → 最新(相手がタイトルを変えた)を読み直す
    updateScheduleItem.mockImplementationOnce(async () => {
      usePlanStore.setState({ currentPlan: plan('清水寺(朝)', 4) });
      return 'conflict';
    });
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '朝一番に行く' } });
    fireEvent.change(screen.getByLabelText('場所'), { target: { value: '京都市東山区' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const conflict = await screen.findByTestId('edit-conflict');
    expect(conflict).toHaveTextContent('保存する前に、ほかの人がこの予定を変更しました。あなたの入力は残っています。');
    expect(conflict).toHaveTextContent('タイトル: ほかの人の値「清水寺(朝)」');
    expect(screen.getByLabelText('メモ')).toHaveValue('朝一番に行く');
    expect(updateScheduleItem.mock.calls[0]![1]).toMatchObject({
      title: '清水寺', description: '朝一番に行く', address: '京都市東山区', start_time: '10:00',
    });

    updateScheduleItem.mockResolvedValueOnce('saved');
    fireEvent.click(within(conflict).getByRole('button', { name: '自分の変更を最新の内容に重ねて保存' }));
    await waitFor(() => expect(updateScheduleItem).toHaveBeenCalledTimes(2));
    expect(updateScheduleItem.mock.calls[1]![1]).toMatchObject({
      title: '清水寺(朝)', description: '朝一番に行く', address: '京都市東山区',
    });
    await waitFor(() => expect(screen.queryByTestId('edit-conflict')).toBeNull());
  });

  it('相手が予定を消していたら、そのことを示して閉じられる', async () => {
    const { updateScheduleItem } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '編集: 清水寺' }));
    updateScheduleItem.mockImplementationOnce(async () => {
      usePlanStore.setState({ currentPlan: { ...plan('x', 4), days: [{ id: 'd1', date: '2026-11-02', events: [] }] } as unknown as TravelPlan });
      return 'conflict';
    });
    fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '清水寺へ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('この予定は、保存する前にほかの人が削除しました。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(screen.queryByText(/ほかの人が削除しました/)).toBeNull());
  });

  it('[G11-Conflict] 競合の後に最新を読み直せなかった時は「変わった項目は無い」と言い切らず、読み直してから違いを示す', async () => {
    const { updateScheduleItem, loadPlan } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '編集: 清水寺' }));
    updateScheduleItem.mockResolvedValueOnce('conflict_unread');
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '朝一番に行く' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const conflict = await screen.findByTestId('edit-conflict');
    expect(within(conflict).getByTestId('edit-conflict-unread')).toHaveTextContent('最新の内容を読み直せなかったため');
    expect(conflict).not.toHaveTextContent('この画面の項目にはありません');
    expect(conflict).not.toHaveTextContent('削除しました');
    expect(within(conflict).queryByRole('button', { name: '自分の変更を最新の内容に重ねて保存' })).toBeNull();
    expect(screen.getByLabelText('メモ')).toHaveValue('朝一番に行く');

    // 読み直しがまた失敗したら、表示はそのまま(古い内容と比べない)
    loadPlan.mockResolvedValueOnce(false);
    fireEvent.click(within(conflict).getByRole('button', { name: '最新を読み直して違いを確かめる' }));
    await waitFor(() => expect(loadPlan).toHaveBeenCalledWith('plan-1'));
    expect(screen.getByTestId('edit-conflict-unread')).toBeInTheDocument();

    // 読み直せたら、相手が変えた項目を示し、重ねて保存できる
    loadPlan.mockImplementationOnce(async () => {
      usePlanStore.setState({ currentPlan: { ...plan('清水寺', 4), days: [{ id: 'd1', date: '2026-11-02',
        events: [{ id: 'e1', title: '清水寺', category: 'sightseeing', start_time: '09:30' }] }] } as unknown as TravelPlan });
      return true;
    });
    fireEvent.click(within(screen.getByTestId('edit-conflict')).getByRole('button', { name: '最新を読み直して違いを確かめる' }));
    await waitFor(() => expect(screen.getByTestId('edit-conflict')).toHaveTextContent('開始時刻: ほかの人の値「09:30」'));
    expect(screen.queryByTestId('edit-conflict-unread')).toBeNull();
    updateScheduleItem.mockResolvedValueOnce('saved');
    fireEvent.click(within(screen.getByTestId('edit-conflict')).getByRole('button', { name: '自分の変更を最新の内容に重ねて保存' }));
    await waitFor(() => expect(updateScheduleItem).toHaveBeenCalledTimes(2));
    expect(updateScheduleItem.mock.calls[1]![1]).toMatchObject({ start_time: '09:30', description: '朝一番に行く' });
  });
});
