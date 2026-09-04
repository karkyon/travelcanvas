/**
 * planStore - 旅行プランのグローバル状態管理
 *
 * [Gate #31.5C] 監査是正(R-03): 以前は日/イベントの追加・削除・並べ替えを
 * すべて「plan.days全体をitinerary JSONへ丸ごとPUT」する方式(旧
 * /travel-plans エンドポイント)で行っており、Gate #29で実装済みの
 * day/event単位API(/plans、revision/If-Matchによる楽観的並行制御、
 * Idempotency-Key、Undo)には一切接続されていなかった。
 *
 * 本Gateで日/イベントに関わる全アクションを /plans API 経由に切り替える。
 * - プラン自体のメタデータ(title/destination/日付/予算等)は引き続き
 *   /travel-plans (createPlan/updatePlan/deletePlan)を使う(Gate #29の
 *   設計方針: plan自体の正本は/travel-plansのまま、day/eventのみ正規化)。
 * - 日/イベントのCRUD・並べ替え・移動はサーバーの実UUIDと revision を
 *   要求するため、まずGETで最新のplanを読み込んでいることが前提となる
 *   (currentPlan.revisionが無い状態で書き込み系アクションを呼ぶとエラーに
 *   なる)。
 * - 楽観的UI更新: 各アクションはまず画面を即座に更新し、サーバー応答が
 *   届いたら実IDとrevisionで置き換える。失敗時は直前の状態へロール
 *   バックする。
 * - 409(他の変更との競合)を検出した場合はロールバックの上でプランを
 *   再読み込みし、ユーザーに競合が起きたことを伝える(自動リトライは
 *   行わない)。
 */
import { create } from 'zustand';
import { TravelPlan, ScheduleItem, DaySchedule, EventCategory } from '@/types';
import { api as apiService } from '@/services/api';
import type { SpotResult, NormalizedDay, NormalizedEvent } from '@/services/api';
import { toast } from 'react-hot-toast';

interface PlanState {
  // State
  plans: TravelPlan[];
  currentPlan: TravelPlan | null;
  currentDayIndex: number;
  isLoading: boolean;
  searchResults: SpotResult[];

  // Actions
  loadPlans: () => Promise<void>;
  loadPlan: (planId: string) => Promise<void>;
  createPlan: (planData: Partial<TravelPlan>) => Promise<TravelPlan | null>;
  updatePlan: (planId: string, planData: Partial<TravelPlan>) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;

  // Day management
  setCurrentDay: (dayIndex: number) => void;
  addDay: () => Promise<void>;
  removeDay: (dayIndex: number) => Promise<void>;

  // Schedule item management
  addScheduleItem: (dayIndex: number, item: Partial<ScheduleItem>) => Promise<void>;
  updateScheduleItem: (itemId: string, item: Partial<ScheduleItem>) => Promise<void>;
  deleteScheduleItem: (itemId: string) => Promise<void>;
  reorderScheduleItems: (dayIndex: number, itemIds: string[]) => Promise<void>;
  moveItemBetweenDays: (itemId: string, fromDayIndex: number, toDayIndex: number, newIndex: number) => Promise<void>;

  // Undo (Gate #29 APIが持つ直近1件のUndo)
  undoLastChange: () => Promise<void>;

  // Search
  searchSpots: (query: string, location?: { latitude: number; longitude: number }) => Promise<void>;
  clearSearchResults: () => void;

  // Clear state
  clearCurrentPlan: () => void;

  // 内部ヘルパー(export型には含めないが、実装上storeのgetから呼べるようにする)
  _reconcileOnConflict: (error: unknown, planId: string) => Promise<void>;
}

// ===== 正規化API <-> フロントエンド型 の変換 =====

function mapEvent(e: NormalizedEvent): ScheduleItem {
  return {
    id: e.id,
    title: e.title,
    description: e.description ?? undefined,
    category: (e.event_type as EventCategory) || 'other',
    start_time: e.local_start_time ?? undefined,
    address: e.address ?? undefined,
    latitude: e.latitude ?? undefined,
    longitude: e.longitude ?? undefined,
  };
}

function mapDay(d: NormalizedDay): DaySchedule {
  return {
    id: d.id,
    date: d.local_date,
    events: (d.events ?? []).map(mapEvent),
  };
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// [Gate #31.5C] 一時的なクライアント側ID(サーバー応答が届くまでの
// 楽観的UI表示のみに使う。サーバーへ送信するペイロードには含めない)。
function generateTempId(prefix: string): string {
  return `${prefix}_temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  // Initial state
  plans: [],
  currentPlan: null,
  currentDayIndex: 0,
  isLoading: false,
  searchResults: [],

  // プラン一覧読み込み
  loadPlans: async () => {
    set({ isLoading: true });

    try {
      const response = await apiService.getPlans();

      if (response.success && response.data) {
        set({ plans: response.data, isLoading: false });
      } else {
        throw new Error('プラン一覧の取得に失敗しました');
      }
    } catch (error) {
      console.error('Load plans error:', error);
      set({ isLoading: false });
    }
  },

  // 特定プラン読み込み
  // [Gate #31.5C] メタデータ(title/destination/日付等)は/travel-plansから、
  // 日/イベントとrevisionは正規化API(/plans)から取得し、マージする。
  loadPlan: async (planId: string) => {
    set({ isLoading: true });

    try {
      const [metaResponse, detailResponse] = await Promise.all([
        apiService.getPlan(planId),
        apiService.getPlanDetail(planId),
      ]);

      if (!metaResponse.success || !metaResponse.data) {
        throw new Error('プランの取得に失敗しました');
      }

      const meta = metaResponse.data as TravelPlan;
      const detail = detailResponse.success ? detailResponse.data : undefined;

      const merged: TravelPlan = {
        ...meta,
        days: detail ? detail.days.map(mapDay) : meta.days,
        revision: detail?.revision,
      };

      set({
        currentPlan: merged,
        currentDayIndex: 0,
        isLoading: false,
      });
    } catch (error) {
      console.error('Load plan error:', error);
      set({ isLoading: false });
      toast.error('プランの読み込みに失敗しました');
    }
  },

  // プラン作成(メタデータのみ。/travel-plansが正本)
  createPlan: async (planData: Partial<TravelPlan>) => {
    set({ isLoading: true });

    try {
      const response = await apiService.createPlan(planData);

      if (response.success && response.data) {
        const newPlan = response.data;

        set((state) => ({
          plans: [...state.plans, newPlan],
          currentPlan: newPlan,
          currentDayIndex: 0,
          isLoading: false
        }));

        toast.success('プランを作成しました');
        return newPlan;
      } else {
        throw new Error('プランの作成に失敗しました');
      }
    } catch (error) {
      console.error('Create plan error:', error);
      set({ isLoading: false });
      return null;
    }
  },

  // プラン更新(メタデータのみ。daysは正規化APIで個別に操作するため
  // ここでは送らない)
  updatePlan: async (planId: string, planData: Partial<TravelPlan>) => {
    try {
      const { days: _days, revision: _revision, ...metaOnly } = planData;
      const response = await apiService.updatePlan(planId, metaOnly);

      if (response.success && response.data) {
        const updatedMeta = response.data;

        set((state) => {
          const isCurrent = state.currentPlan?.id === planId;
          return {
            plans: state.plans.map((plan) =>
              plan.id === planId
                ? { ...updatedMeta, days: plan.days, revision: plan.revision }
                : plan
            ),
            currentPlan: isCurrent && state.currentPlan
              ? { ...state.currentPlan, ...updatedMeta, days: state.currentPlan.days, revision: state.currentPlan.revision }
              : state.currentPlan,
          };
        });

        toast.success('プランを更新しました');
      }
    } catch (error) {
      console.error('Update plan error:', error);
      toast.error('プランの更新に失敗しました');
    }
  },

  // プラン削除
  deletePlan: async (planId: string) => {
    try {
      const response = await apiService.deletePlan(planId);

      if (response.success) {
        set((state) => ({
          plans: state.plans.filter(plan => plan.id !== planId),
          currentPlan: state.currentPlan?.id === planId ? null : state.currentPlan
        }));

        toast.success('プランを削除しました');
      }
    } catch (error) {
      console.error('Delete plan error:', error);
      toast.error('プランの削除に失敗しました');
    }
  },

  // 現在の日設定
  setCurrentDay: (dayIndex: number) => {
    const state = get();
    if (state.currentPlan && dayIndex >= 0 && dayIndex < state.currentPlan.days.length) {
      set({ currentDayIndex: dayIndex });
    }
  },

  // 日追加
  addDay: async () => {
    const state = get();
    if (!state.currentPlan) return;
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return;
    }

    const plan = state.currentPlan;
    const localDate = new Date(Date.now() + plan.days.length * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]!;
    const tempId = generateTempId('day');
    const optimisticDay: DaySchedule = { id: tempId, date: localDate, events: [] };

    set({ currentPlan: { ...plan, days: [...plan.days, optimisticDay] } });

    try {
      await apiService.createDay(plan.id, { local_date: localDate }, generateIdempotencyKey());
      // create系はrevisionを返さない設計のため、確定状態(実ID・最新revision)
      // を取りに行く。
      await get().loadPlan(plan.id);
    } catch (error) {
      set({ currentPlan: plan });
      console.error('Add day error:', error);
      toast.error('日程の追加に失敗しました');
    }
  },

  // 日削除
  removeDay: async (dayIndex: number) => {
    const state = get();
    if (!state.currentPlan || state.currentPlan.days.length <= 1) return;
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return;
    }

    const plan = state.currentPlan;
    const dayToRemove = plan.days[dayIndex];
    if (!dayToRemove) return;

    const updatedDays = plan.days.filter((_, index) => index !== dayIndex);
    set({
      currentPlan: { ...plan, days: updatedDays },
      currentDayIndex: Math.min(state.currentDayIndex, updatedDays.length - 1),
    });

    try {
      const result = await apiService.deleteDay(plan.id, dayToRemove.id, plan.revision!);
      set((s) => (s.currentPlan ? { currentPlan: { ...s.currentPlan, revision: result.revision } } : s));
    } catch (error) {
      set({ currentPlan: plan, currentDayIndex: state.currentDayIndex });
      await get()._reconcileOnConflict(error, plan.id);
    }
  },

  // スケジュールアイテム追加
  addScheduleItem: async (dayIndex: number, item: Partial<ScheduleItem>) => {
    const state = get();
    if (!state.currentPlan || !state.currentPlan.days[dayIndex]) return;
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return;
    }

    const plan = state.currentPlan;
    const day = plan.days[dayIndex]!;
    const tempId = generateTempId('event');
    const optimisticItem: ScheduleItem = {
      id: tempId,
      title: item.title || '新しいスポット',
      description: item.description || '',
      category: item.category || 'sightseeing',
      start_time: item.start_time,
      end_time: item.end_time,
      duration: item.duration,
      location_name: item.location_name || '',
      latitude: item.latitude,
      longitude: item.longitude,
      address: item.address,
      cost: item.cost || 0,
      currency: item.currency || 'JPY',
      priority: item.priority ?? 3,
      travel_method: item.travel_method,
      travel_time: item.travel_time,
      travel_cost: item.travel_cost,
      notes: item.notes,
      booking_info: item.booking_info,
      contact_info: item.contact_info,
    };

    const updatedDay = { ...day, events: [...day.events, optimisticItem] };
    set({
      currentPlan: {
        ...plan,
        days: plan.days.map((d, i) => (i === dayIndex ? updatedDay : d)),
      },
    });

    try {
      await apiService.createEvent(
        plan.id,
        {
          day_id: day.id,
          title: optimisticItem.title,
          description: optimisticItem.description,
          event_type: optimisticItem.category,
          local_start_time: optimisticItem.start_time,
          address: optimisticItem.address,
          latitude: optimisticItem.latitude,
          longitude: optimisticItem.longitude,
        },
        generateIdempotencyKey()
      );
      await get().loadPlan(plan.id);
    } catch (error) {
      set({ currentPlan: plan });
      console.error('Add schedule item error:', error);
      toast.error('スポットの追加に失敗しました');
    }
  },

  // スケジュールアイテム更新
  updateScheduleItem: async (itemId: string, item: Partial<ScheduleItem>) => {
    const state = get();
    if (!state.currentPlan) return;
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return;
    }

    const plan = state.currentPlan;
    const updatedPlan = {
      ...plan,
      days: plan.days.map((day) => ({
        ...day,
        events: day.events.map((event) => (event.id === itemId ? { ...event, ...item } : event)),
      })),
    };
    set({ currentPlan: updatedPlan });

    try {
      const updated = await apiService.updateEvent(
        plan.id,
        itemId,
        {
          title: item.title,
          description: item.description,
          event_type: item.category,
          local_start_time: item.start_time,
          address: item.address,
          latitude: item.latitude,
          longitude: item.longitude,
        },
        plan.revision!
      );

      set((s) => {
        if (!s.currentPlan) return s;
        return {
          currentPlan: {
            ...s.currentPlan,
            revision: (s.currentPlan.revision ?? plan.revision!) + 1,
            days: s.currentPlan.days.map((day) => ({
              ...day,
              events: day.events.map((event) => (event.id === itemId ? { ...event, ...mapEvent(updated) } : event)),
            })),
          },
        };
      });
    } catch (error) {
      set({ currentPlan: plan });
      await get()._reconcileOnConflict(error, plan.id);
    }
  },

  // スケジュールアイテム削除
  deleteScheduleItem: async (itemId: string) => {
    const state = get();
    if (!state.currentPlan) return;
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return;
    }

    const plan = state.currentPlan;
    const updatedPlan = {
      ...plan,
      days: plan.days.map((day) => ({
        ...day,
        events: day.events.filter((event) => event.id !== itemId),
      })),
    };
    set({ currentPlan: updatedPlan });

    try {
      const result = await apiService.deleteEvent(plan.id, itemId, plan.revision!);
      set((s) => (s.currentPlan ? { currentPlan: { ...s.currentPlan, revision: result.revision } } : s));
    } catch (error) {
      set({ currentPlan: plan });
      await get()._reconcileOnConflict(error, plan.id);
    }
  },

  // スケジュールアイテムの並び替え(同日内)
  // [Gate #31.5C] /plans APIは1イベントずつのmoveのみ提供するため、
  // 新しい並び順を、各イベントへsort_orderを指定したmove呼び出しの
  // 逐次実行で反映する。
  reorderScheduleItems: async (dayIndex: number, itemIds: string[]) => {
    const state = get();
    if (!state.currentPlan || !state.currentPlan.days[dayIndex]) return;
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return;
    }

    const plan = state.currentPlan;
    const day = plan.days[dayIndex]!;
    const reorderedEvents = itemIds
      .map((id) => day.events.find((event) => event.id === id))
      .filter((event): event is ScheduleItem => event !== undefined);

    const updatedDay = { ...day, events: reorderedEvents };
    set({
      currentPlan: { ...plan, days: plan.days.map((d, i) => (i === dayIndex ? updatedDay : d)) },
    });

    try {
      let revision = plan.revision!;
      for (let i = 0; i < reorderedEvents.length; i++) {
        const event = reorderedEvents[i]!;
        // eslint-disable-next-line no-await-in-loop
        await apiService.moveEvent(plan.id, event.id, { sort_order: i }, revision, generateIdempotencyKey());
        revision += 1;
      }
      set((s) => (s.currentPlan ? { currentPlan: { ...s.currentPlan, revision } } : s));
    } catch (error) {
      set({ currentPlan: plan });
      await get()._reconcileOnConflict(error, plan.id);
    }
  },

  // 日付間でのアイテム移動
  moveItemBetweenDays: async (itemId: string, fromDayIndex: number, toDayIndex: number, newIndex: number) => {
    const state = get();
    if (!state.currentPlan) return;
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return;
    }

    const plan = state.currentPlan;
    const fromDay = plan.days[fromDayIndex];
    const toDay = plan.days[toDayIndex];
    if (!fromDay || !toDay) return;

    const itemToMove = fromDay.events.find((event) => event.id === itemId);
    if (!itemToMove) return;

    const updatedFromDay = { ...fromDay, events: fromDay.events.filter((event) => event.id !== itemId) };
    const updatedToDay = {
      ...toDay,
      events: [...toDay.events.slice(0, newIndex), itemToMove, ...toDay.events.slice(newIndex)],
    };

    set({
      currentPlan: {
        ...plan,
        days: plan.days.map((day, index) => {
          if (index === fromDayIndex) return updatedFromDay;
          if (index === toDayIndex) return updatedToDay;
          return day;
        }),
      },
    });

    try {
      const updated = await apiService.moveEvent(
        plan.id,
        itemId,
        { day_id: toDay.id, sort_order: newIndex },
        plan.revision!,
        generateIdempotencyKey()
      );
      set((s) => {
        if (!s.currentPlan) return s;
        return {
          currentPlan: {
            ...s.currentPlan,
            revision: (s.currentPlan.revision ?? plan.revision!) + 1,
            days: s.currentPlan.days.map((day, index) =>
              index === toDayIndex
                ? { ...day, events: day.events.map((ev) => (ev.id === itemId ? mapEvent(updated) : ev)) }
                : day
            ),
          },
        };
      });
    } catch (error) {
      set({ currentPlan: plan });
      await get()._reconcileOnConflict(error, plan.id);
    }
  },

  // 直近1件のUndo
  undoLastChange: async () => {
    const state = get();
    if (!state.currentPlan || state.currentPlan.revision === undefined) return;

    try {
      await apiService.undoLastPlanChange(state.currentPlan.id, state.currentPlan.revision);
      toast.success('直前の変更を取り消しました');
      await get().loadPlan(state.currentPlan.id);
    } catch (error) {
      console.error('Undo error:', error);
      const status = (error as any)?.response?.status;
      if (status === 404) {
        toast.error('取り消せる変更がありません');
      } else if (status === 409) {
        toast.error('他の変更と競合したため取り消せませんでした。最新の内容を再読み込みします。');
        await get().loadPlan(state.currentPlan.id);
      } else {
        toast.error('取り消しに失敗しました');
      }
    }
  },

  // [Gate #31.5C] 409(revision不一致)を検出した場合はプランを再読み込みし、
  // それ以外のエラーは通常のエラートーストのみ表示する。呼び出し元は
  // 呼ぶ前に楽観的更新のロールバックを済ませておくこと。
  _reconcileOnConflict: async (error: unknown, planId: string) => {
    const status = (error as any)?.response?.status;
    if (status === 409) {
      toast.error('他のユーザーまたは別の操作と競合しました。最新の内容を再読み込みしました。');
      await get().loadPlan(planId);
    } else {
      console.error('Plan write error:', error);
      toast.error('操作に失敗しました');
    }
  },

  // スポット検索
  searchSpots: async (query: string, location?: { latitude: number; longitude: number }) => {
    set({ isLoading: true });

    try {
      const response = await apiService.searchSpots({
        query,
        location,
        max_results: 20
      });

      if (response.success && response.data) {
        set({
          searchResults: response.data.spots,
          isLoading: false
        });
      }
    } catch (error) {
      console.error('Search spots error:', error);
      set({ isLoading: false });
      toast.error('検索に失敗しました');
    }
  },

  // 検索結果クリア
  clearSearchResults: () => {
    set({ searchResults: [] });
  },

  // 現在のプランクリア
  clearCurrentPlan: () => {
    set({
      currentPlan: null,
      currentDayIndex: 0,
      searchResults: []
    });
  },
}));
