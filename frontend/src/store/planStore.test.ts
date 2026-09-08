/**
 * [Gate #31.5C] planStore.tsの単体テスト。
 *
 * `@/services/api` の `api` インスタンスをモックし、実ネットワーク通信を
 * 一切行わない(APIキー・実サーバー不要)。以下を検証する:
 * - 日/イベントのCRUD・並べ替え・移動が正規化API(/plans)を呼ぶこと
 * - 楽観的UI更新が即座に反映されること
 * - 書き込み失敗時に直前の状態へロールバックされること
 * - 409(revision競合)検出時にプランを再読み込みすること
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlanStore } from './planStore';
import { api as apiService, travelAPI } from '@/services/api';
import { createQuickDraft, getStoredDeviceToken } from '@/services/quickDraftApi';

vi.mock('@/services/api', () => ({
  api: {
    getPlan: vi.fn(),
    getPlanDetail: vi.fn(),
    getPlans: vi.fn(),
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
    deletePlan: vi.fn(),
    createDay: vi.fn(),
    updateDay: vi.fn(),
    deleteDay: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    moveEvent: vi.fn(),
    undoLastPlanChange: vi.fn(),
    searchSpots: vi.fn(),
    // [Gate R2-8] authStoreのonRehydrateStorage(setTimeoutで非同期に
    // 発火するstate.initialize())が同じ`@/services/api`モックを共有する
    // ため、authStore側で新たに使われるようになったメソッドもここに
    // 含めておかないと、このファイルのテスト実行後に非同期で
    // "setGuestMode is not a function" が発生する。
    setGuestMode: vi.fn(),
    setAccessToken: vi.fn(),
    clearAccessToken: vi.fn(),
  },
  // [Gate R2-4] createQuickPlanがpromoteQuickDraftをtravelAPI経由で呼ぶため追加。
  travelAPI: {
    promoteQuickDraft: vi.fn(),
  },
}));

vi.mock('@/services/quickDraftApi', () => ({
  createQuickDraft: vi.fn(),
  getStoredDeviceToken: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockedApi = apiService as unknown as Record<string, any>;
const mockedTravelApi = travelAPI as unknown as Record<string, any>;
const mockedCreateQuickDraft = createQuickDraft as unknown as ReturnType<typeof vi.fn>;
const mockedGetStoredDeviceToken = getStoredDeviceToken as unknown as ReturnType<typeof vi.fn>;

const PLAN_ID = 'plan-1';
const DAY_ID = 'day-1';

async function seedLoadedPlan(revision = 1) {
  mockedApi.getPlan.mockResolvedValue({ success: true, data: { id: PLAN_ID, title: 'テストプラン', days: [] } });
  mockedApi.getPlanDetail.mockResolvedValue({
    success: true,
    data: { id: PLAN_ID, title: 'テストプラン', revision, days: [{ id: DAY_ID, local_date: '2026-10-01', timezone_id: 'UTC', sort_order: 0, events: [] }] },
  });
  await usePlanStore.getState().loadPlan(PLAN_ID);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlanStore.setState({
    plans: [], currentPlan: null, currentDayIndex: 0, isLoading: false, searchResults: [],
  });
});

describe('loadPlan', () => {
  it('メタデータ(/travel-plans)と正規化データ(/plans)をマージし、revisionを保持する', async () => {
    await seedLoadedPlan(3);

    const plan = usePlanStore.getState().currentPlan;
    expect(plan?.revision).toBe(3);
    expect(plan?.days).toHaveLength(1);
    expect(plan?.days[0]?.id).toBe(DAY_ID);
    expect(mockedApi.getPlanDetail).toHaveBeenCalledWith(PLAN_ID);
  });
});

describe('createQuickPlan [Gate #38 / Gate R2-4]', () => {
  function mockDraftAndPromote(title: string, opts?: { events?: any[] }) {
    mockedGetStoredDeviceToken.mockReturnValue('stored-device-token');
    mockedCreateQuickDraft.mockResolvedValue({
      id: 'draft-1',
      revision: 1,
      status: 'ACTIVE',
      expires_at: '2099-01-01T00:00:00Z',
      title,
      start_date: '2026-01-01',
      end_date: '2026-01-01',
      events: opts?.events ?? [],
      device_token: 'issued-device-token',
    });
    mockedTravelApi.promoteQuickDraft.mockResolvedValue({
      id: PLAN_ID,
      revision: 1,
      title,
      quick_draft_id: 'draft-1',
      quick_draft_status: 'PROMOTED',
    });
    mockedApi.getPlan.mockResolvedValue({
      success: true,
      data: { id: PLAN_ID, title, days: [] },
    });
    mockedApi.getPlanDetail.mockResolvedValue({
      success: true,
      data: { id: PLAN_ID, title, revision: 1, days: [] },
    });
  }

  it('目的地と開始日の両方があればタイトルを自動生成する', async () => {
    mockDraftAndPromote('大阪旅行(2026-11-01)');

    await usePlanStore.getState().createQuickPlan({
      destination: '大阪',
      startDate: '2026-11-01',
    });

    expect(mockedCreateQuickDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: '大阪旅行(2026-11-01)' }),
      expect.any(String)
    );
  });

  it('目的地のみの場合は目的地名から生成する', async () => {
    mockDraftAndPromote('福岡旅行');

    await usePlanStore.getState().createQuickPlan({ destination: '福岡' });

    expect(mockedCreateQuickDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: '福岡旅行' }),
      expect.any(String)
    );
  });

  it('目的地・開始日ともに無い場合は「新しい旅行」にフォールバックする', async () => {
    mockDraftAndPromote('新しい旅行');

    await usePlanStore.getState().createQuickPlan({});

    expect(mockedCreateQuickDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: '新しい旅行' }),
      expect.any(String)
    );
  });

  it('タイトルを明示指定した場合は自動生成しない', async () => {
    mockDraftAndPromote('自分で決めた名前');

    await usePlanStore.getState().createQuickPlan({
      title: '自分で決めた名前',
      destination: '無視されるはずの目的地',
    });

    expect(mockedCreateQuickDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: '自分で決めた名前' }),
      expect.any(String)
    );
  });

  it('開始日と最初の予定を指定すると、QuickDraft作成→promoteまで自動で行う', async () => {
    mockDraftAndPromote('京都旅行(2026-12-01)', {
      events: [{ title: 'チェックイン', local_date: '2026-12-01' }],
    });
    mockedApi.getPlanDetail.mockResolvedValueOnce({
      success: true,
      data: {
        id: PLAN_ID, title: '京都旅行(2026-12-01)', revision: 1,
        days: [{ id: DAY_ID, local_date: '2026-12-01', timezone_id: 'UTC', sort_order: 0, events: [
          { id: 'event-1', day_id: DAY_ID, title: 'チェックイン', event_type: 'sightseeing', is_all_day: false, locked: false, sort_order: 0 },
        ] }],
      },
    });

    const result = await usePlanStore.getState().createQuickPlan({
      destination: '京都',
      startDate: '2026-12-01',
      firstEventTitle: 'チェックイン',
    });

    expect(mockedCreateQuickDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [expect.objectContaining({ title: 'チェックイン', local_date: '2026-12-01' })],
      }),
      expect.any(String)
    );
    expect(mockedTravelApi.promoteQuickDraft).toHaveBeenCalledWith(
      'draft-1', 'stored-device-token', expect.any(String)
    );
    expect(result?.days[0]?.events).toHaveLength(1);
  });

  it('日付も最初の予定も無指定なら空のevents配列でdraftを作成する(day/eventは作られない)', async () => {
    mockDraftAndPromote('新しい旅行');

    await usePlanStore.getState().createQuickPlan({});

    expect(mockedCreateQuickDraft).toHaveBeenCalledWith(
      expect.objectContaining({ events: [] }),
      expect.any(String)
    );
  });

  it('QuickDraft作成自体が失敗した場合はnullを返し、promoteを試みない', async () => {
    mockedCreateQuickDraft.mockRejectedValue(new Error('network error'));

    const result = await usePlanStore.getState().createQuickPlan({ destination: '失敗テスト' });

    expect(result).toBeNull();
    expect(mockedTravelApi.promoteQuickDraft).not.toHaveBeenCalled();
  });

  it('promoteが失敗した場合もnullを返す', async () => {
    mockedGetStoredDeviceToken.mockReturnValue('stored-device-token');
    mockedCreateQuickDraft.mockResolvedValue({
      id: 'draft-1', revision: 1, status: 'ACTIVE', expires_at: '2099-01-01T00:00:00Z',
      start_date: '2026-01-01', end_date: '2026-01-01', events: [],
    });
    mockedTravelApi.promoteQuickDraft.mockRejectedValue(new Error('promote failed'));

    const result = await usePlanStore.getState().createQuickPlan({ destination: '失敗テスト2' });

    expect(result).toBeNull();
  });
});

describe('addScheduleItem', () => {
  it('楽観的に追加した後、正規化APIのcreateEventを呼び、成功時に最新状態を再取得する', async () => {
    await seedLoadedPlan(1);
    mockedApi.createEvent.mockResolvedValue({
      id: 'event-1', day_id: DAY_ID, title: '観光', event_type: 'sightseeing', is_all_day: false, locked: false, sort_order: 0,
    });
    mockedApi.getPlanDetail.mockResolvedValueOnce({
      success: true,
      data: {
        id: PLAN_ID, title: 'テストプラン', revision: 2,
        days: [{ id: DAY_ID, local_date: '2026-10-01', timezone_id: 'UTC', sort_order: 0, events: [
          { id: 'event-1', day_id: DAY_ID, title: '観光', event_type: 'sightseeing', is_all_day: false, locked: false, sort_order: 0 },
        ] }],
      },
    });

    await usePlanStore.getState().addScheduleItem(0, { title: '観光' });

    expect(mockedApi.createEvent).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({ day_id: DAY_ID, title: '観光' }),
      expect.any(String)
    );
    const plan = usePlanStore.getState().currentPlan!;
    expect(plan.days[0]?.events).toHaveLength(1);
    expect(plan.days[0]?.events[0]?.id).toBe('event-1');
  });

  it('失敗時は追加前の状態へロールバックする', async () => {
    await seedLoadedPlan(1);
    mockedApi.createEvent.mockRejectedValue(new Error('network error'));

    await usePlanStore.getState().addScheduleItem(0, { title: '観光' });

    const plan = usePlanStore.getState().currentPlan!;
    expect(plan.days[0]?.events).toHaveLength(0);
  });
});

describe('updateScheduleItem 409競合', () => {
  it('409エラー時はロールバックし、プランを再読み込みする', async () => {
    await seedLoadedPlan(1);
    // 事前に1件イベントを直接セット(addScheduleItemの経路を通さずシンプルに準備)
    usePlanStore.setState((s) => ({
      currentPlan: {
        ...s.currentPlan!,
        days: [{ ...s.currentPlan!.days[0]!, events: [{ id: 'event-1', title: '元のタイトル', category: 'sightseeing' }] }],
      },
    }));

    const conflictError = { response: { status: 409 } };
    mockedApi.updateEvent.mockRejectedValue(conflictError);
    mockedApi.getPlan.mockResolvedValue({ success: true, data: { id: PLAN_ID, title: 'テストプラン', days: [] } });
    mockedApi.getPlanDetail.mockResolvedValue({
      success: true,
      data: { id: PLAN_ID, title: 'テストプラン', revision: 5, days: [{ id: DAY_ID, local_date: '2026-10-01', timezone_id: 'UTC', sort_order: 0, events: [] }] },
    });

    await usePlanStore.getState().updateScheduleItem('event-1', { title: '新しいタイトル' });

    // ロールバック後、reloadによりrevisionが最新化されている
    expect(usePlanStore.getState().currentPlan?.revision).toBe(5);
  });
});

describe('reorderScheduleItems', () => {
  it('各イベントに対しsort_orderを指定してmoveEventを逐次呼び出す', async () => {
    await seedLoadedPlan(1);
    usePlanStore.setState((s) => ({
      currentPlan: {
        ...s.currentPlan!,
        days: [{
          ...s.currentPlan!.days[0]!,
          events: [
            { id: 'a', title: 'A', category: 'sightseeing' },
            { id: 'b', title: 'B', category: 'sightseeing' },
          ],
        }],
      },
    }));
    mockedApi.moveEvent.mockImplementation((_planId: string, eventId: string) =>
      Promise.resolve({ id: eventId, day_id: DAY_ID, title: eventId, event_type: 'sightseeing', is_all_day: false, locked: false, sort_order: 0 })
    );

    await usePlanStore.getState().reorderScheduleItems(0, ['b', 'a']);

    expect(mockedApi.moveEvent).toHaveBeenNthCalledWith(1, PLAN_ID, 'b', { sort_order: 0 }, 1, expect.any(String));
    expect(mockedApi.moveEvent).toHaveBeenNthCalledWith(2, PLAN_ID, 'a', { sort_order: 1 }, 2, expect.any(String));
  });
});

describe('undoLastChange', () => {
  it('成功時にプランを再読み込みする', async () => {
    await seedLoadedPlan(2);
    mockedApi.undoLastPlanChange.mockResolvedValue({ revision: 3 });
    mockedApi.getPlan.mockResolvedValue({ success: true, data: { id: PLAN_ID, title: 'テストプラン', days: [] } });
    mockedApi.getPlanDetail.mockResolvedValue({
      success: true,
      data: { id: PLAN_ID, title: 'テストプラン', revision: 3, days: [] },
    });

    await usePlanStore.getState().undoLastChange();

    expect(mockedApi.undoLastPlanChange).toHaveBeenCalledWith(PLAN_ID, 2);
    expect(usePlanStore.getState().currentPlan?.revision).toBe(3);
  });

  it('取り消せる変更が無い場合(404)はプランを再読み込みしない', async () => {
    await seedLoadedPlan(2);
    mockedApi.undoLastPlanChange.mockRejectedValue({ response: { status: 404 } });

    await usePlanStore.getState().undoLastChange();

    // getPlanDetailはseedLoadedPlan時の1回のみ(undo後の再読み込みは発生しない)
    expect(mockedApi.getPlanDetail).toHaveBeenCalledTimes(1);
  });
});
