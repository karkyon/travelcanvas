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
import { PLAN_MUTATED_EVENT } from '@/utils/commandPalette';
import { TravelPlan, ScheduleItem, DaySchedule, EventCategory } from '@/types';
import { api as apiService, travelAPI } from '@/services/api';
import type { SpotResult, NormalizedDay, NormalizedEvent } from '@/services/api';
import { createQuickDraft, getStoredDeviceToken } from '@/services/quickDraftApi';
import { publishCurrentTrip } from './currentTripStore';
import { toast } from 'react-hot-toast';
import {
  saveOfflinePack,
  loadOfflinePack,
  deleteOfflinePack,
  isOfflinePackAvailable,
} from '@/utils/offlinePack';
import { currentOfflineSession } from '@/utils/offlineSession';
import {
  LOCKED_RELATION_MESSAGE, UNDO_CONFLICT_MESSAGE, conflictCode, describeItemDeletion,
} from '@/store/itemDeletionMessages';
import {
  applyResults, deviceId, enqueue, isNetworkError, loadConflictCount, loadQueue, saveConflictCount, toPayload,
} from '@/utils/syncQueue';

// [Gate C1] 予定の保存の結果(FR-020: 競合したら呼出側が入力を残して違いを示す)
export type ItemSaveResult = 'saved' | 'queued' | 'conflict' | 'failed';

// [Gate P11] 通信できない時に端末へ溜めたことの案内
export const OFFLINE_SAVED_MESSAGE = '通信できないため、この変更を端末に保存しました。通信が戻ると自動で送ります';

interface PlanState {
  // State
  plans: TravelPlan[];
  currentPlan: TravelPlan | null;
  currentDayIndex: number;
  isLoading: boolean;
  searchResults: SpotResult[];
  // [Gate #36] Offline Travel Pack。trueの場合、currentPlanはネットワーク
  // 取得に失敗し暗号化ローカルパックから復元したデータであることを示す
  // (最新でない可能性があるため、画面側で明示する)。
  isOfflineData: boolean;
  // [Gate P11] オフライン編集・同期(FR-033)。未同期の操作の件数、同期で競合した件数、同期中か
  pendingSyncCount: number;
  syncConflictCount: number;
  isSyncing: boolean;

  // Actions
  loadPlans: () => Promise<void>;
  loadPlan: (planId: string) => Promise<void>;
  createPlan: (planData: Partial<TravelPlan>) => Promise<TravelPlan | null>;
  updatePlan: (planId: string, planData: Partial<TravelPlan>) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;
  saveCurrentPlanOffline: () => Promise<boolean>;
  removeOfflinePlan: (planId: string) => Promise<void>;
  checkOfflineAvailability: (planId: string) => Promise<boolean>;
  // [Gate #38] Quick Plan: 「旅行名未入力→自動生成」「予定を1件登録した状態で
  // プランナーへ着地」までを1回の呼び出しで完結させる。DBスキーマは無変更、
  // 既存のcreatePlan/loadPlan/addDay/addScheduleItemを内部で順に呼ぶだけ。
  createQuickPlan: (input: {
    title?: string;
    destination?: string;
    startDate?: string;
    endDate?: string;
    firstEventTitle?: string;
    firstEventTime?: string;
    firstEventLocation?: string;
  }) => Promise<TravelPlan | null>;

  // Day management
  setCurrentDay: (dayIndex: number) => void;
  addDay: () => Promise<void>;
  removeDay: (dayIndex: number) => Promise<void>;

  // Schedule item management
  addScheduleItem: (dayIndex: number, item: Partial<ScheduleItem>) => Promise<void>;
  // [Gate #32] 検索候補(candidate)を採用してその日程へ追加する
  // (「候補に追加」とは別の「旅程に追加」導線)。afterEventIdを指定すると
  // その直後へ挿入する(未指定なら末尾)。
  addScheduleItemFromCandidate: (
    dayIndex: number,
    candidateId: string,
    fallbackTitle?: string
  ) => Promise<void>;
  /** [Gate C1] 保存の結果(conflict = 他の変更と競合し、最新を読み直した。入力は呼出側に残す) */
  updateScheduleItem: (itemId: string, item: Partial<ScheduleItem>) => Promise<ItemSaveResult>;
  /**
   * [Gate B-013] 成否と、外した紐付け等の案内文(無ければnull)を返す。失敗時は内部で
   * ロールバックとエラー表示を済ませる(例外は投げない)ため、呼び出し側は ok を見て
   * 成功表示を出すこと(以前は失敗しても呼び出し側が「削除しました」と表示していた)。
   */
  deleteScheduleItem: (itemId: string) => Promise<{ ok: boolean; note: string | null }>;
  reorderScheduleItems: (dayIndex: number, itemIds: string[]) => Promise<void>;
  moveItemBetweenDays: (itemId: string, fromDayIndex: number, toDayIndex: number, newIndex: number) => Promise<void>;

  // Undo (Gate #29 APIが持つ直近1件のUndo)
  undoLastChange: () => Promise<void>;

  // Search
  searchSpots: (query: string, location?: { latitude: number; longitude: number }) => Promise<void>;
  clearSearchResults: () => void;

  // Clear state
  clearCurrentPlan: () => void;

  // [Gate P11] 端末に溜めた操作の件数を読み直す / 溜めた操作を送る(通信が戻った時・利用者の操作で)
  refreshSyncState: (planId: string) => void;
  syncPending: (planId: string) => Promise<void>;
  setSyncConflictCount: (planId: string, count: number) => void;

  // 内部ヘルパー(export型には含めないが、実装上storeのgetから呼べるようにする)
  _reconcileOnConflict: (error: unknown, planId: string) => Promise<void>;
}

// ===== 正規化API <-> フロントエンド型 の変換 =====

function mapEvent(e: NormalizedEvent): ScheduleItem {
  // [Gate G7] FR-005 終了時刻と日をまたぐ日数(backend の EventResponse。以前の型に無いため読み取りだけ)
  const g7 = e as NormalizedEvent & { local_end_time?: string | null; end_day_offset?: number | null };
  return {
    id: e.id,
    title: e.title,
    description: e.description ?? undefined,
    category: (e.event_type as EventCategory) || 'other',
    start_time: e.local_start_time ?? undefined,
    end_time: g7.local_end_time ?? undefined,
    end_day_offset: g7.end_day_offset ?? undefined,
    address: e.address ?? undefined,
    latitude: e.latitude ?? undefined,
    longitude: e.longitude ?? undefined,
    // [Gate G11] 営業時間の照合・全日程のチャートの固定の数
    place_id: e.place_id ?? undefined,
    locked: e.locked,
    sort_order: e.sort_order,
  };
}

function mapDay(d: NormalizedDay): DaySchedule {
  return {
    id: d.id,
    date: d.local_date,
    timezone_id: d.timezone_id,
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
  isOfflineData: false,
  pendingSyncCount: 0,
  syncConflictCount: 0,
  isSyncing: false,

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
  // [Gate #36] ネットワーク取得に失敗した場合、暗号化オフラインパックが
  // あればそこから復元する(FR-032)。パックはあくまで最後にオンラインで
  // 取得できた時点のスナップショットであり、最新でない可能性がある。
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
        hidden_fields: detail?.hidden_fields ?? [],
      };

      set({
        currentPlan: merged,
        currentDayIndex: 0,
        isLoading: false,
        isOfflineData: false,
      });
    } catch (error) {
      console.error('Load plan error:', error);

      // [Gate K1] 鍵は backend が利用者ごとに配る(offlineVault)。ゲストも使える。
      // 通信できない時は端末に置いた鍵で開く。
      const session = currentOfflineSession();

      if (session) {
        try {
          const offlinePlan = await loadOfflinePack<TravelPlan>(planId, session);
          if (offlinePlan) {
            set({
              currentPlan: offlinePlan,
              currentDayIndex: 0,
              isLoading: false,
              isOfflineData: true,
            });
            toast('オフラインで保存されたデータを表示しています(最新でない可能性があります)', {
              icon: '📴',
            });
            return;
          }
        } catch (offlineError) {
          console.error('Offline pack load error:', offlineError);
        }
      }

      set({ isLoading: false, isOfflineData: false });
      toast.error('プランの読み込みに失敗しました');
    }
  },

  // [Gate #36] 現在表示中のプランをオフラインパックとして保存する。
  saveCurrentPlanOffline: async () => {
    const { currentPlan } = get();
    if (!currentPlan) {
      toast.error('保存するプランがありません');
      return false;
    }

    // [Gate K1] ゲストも保存できる(鍵は backend が利用者ごとに配る)
    const session = currentOfflineSession();
    if (!session) {
      toast.error('オフライン保存にはログイン(またはゲストとして開始)が必要です');
      return false;
    }

    try {
      await saveOfflinePack(currentPlan.id, currentPlan.title, currentPlan, session);
      toast.success('オフラインで使えるように保存しました');
      return true;
    } catch (error) {
      console.error('Save offline pack error:', error);
      toast.error('オフライン保存に失敗しました');
      return false;
    }
  },

  removeOfflinePlan: async (planId: string) => {
    try {
      await deleteOfflinePack(planId);
      toast.success('オフラインデータを削除しました');
    } catch (error) {
      console.error('Delete offline pack error:', error);
      toast.error('オフラインデータの削除に失敗しました');
    }
  },

  checkOfflineAvailability: async (planId: string) => {
    try {
      return await isOfflinePackAvailable(planId);
    } catch (error) {
      console.error('Check offline availability error:', error);
      return false;
    }
  },

  createQuickPlan: async (input) => {
    const destination = input.destination?.trim() || '';
    const startDate = input.startDate?.trim() || undefined;

    // [Gate #38 / CA-001] 旅行名は任意。未入力時は目的地+開始日から自動生成し、
    // どちらも無ければ「新しい旅行」にフォールバックする。
    let title = input.title?.trim();
    if (!title) {
      if (destination && startDate) {
        title = `${destination}旅行(${startDate})`;
      } else if (destination) {
        title = `${destination}旅行`;
      } else if (startDate) {
        title = `${startDate}の旅行`;
      } else {
        title = '新しい旅行';
      }
    }

    // [Gate R2-4] 以前はcreatePlan(/travel-plans)→loadPlan→addDay→
    // addScheduleItemと4回の別リクエストに分けており、途中で失敗すると
    // 中間状態のplan/dayが残る問題があった(Gate R2系列で監査指摘)。
    // 正式QuickDraft API(POST /quick-drafts→POST /quick-drafts/{id}/promote)
    // へ置き換え、plan+day+eventをbackend側の単一transactionで作成する。
    //
    // QuickDraftのstart_date/end_dateは必須のため、未入力時は今日の日付を
    // 補う(events未指定なら実際にday/eventが作られないのは従来と同じ)。
    const today = new Date().toISOString().slice(0, 10);
    const effectiveStartDate = startDate || today;
    const effectiveEndDate = input.endDate?.trim() || effectiveStartDate;

    const hasFirstEvent = !!input.firstEventTitle?.trim();
    const events = hasFirstEvent
      ? [
          {
            title: input.firstEventTitle!.trim(),
            local_date: effectiveStartDate,
            start_time: input.firstEventTime?.trim() || undefined,
            // [制約] QuickDraftEventInputにはlocation_name相当のフィールドが
            // 無い(Gate R2-2時点のスキーマ)。情報を失わないようdescription
            // へ退避する(将来のGateでフィールド追加を検討)。
            description: input.firstEventLocation?.trim() || undefined,
          },
        ]
      : [];

    let draft;
    try {
      draft = await createQuickDraft(
        {
          title,
          start_date: effectiveStartDate,
          end_date: effectiveEndDate,
          events,
        },
        generateIdempotencyKey(),
      );
    } catch (error) {
      console.error('QuickDraft作成エラー:', error);
      toast.error('プランの作成に失敗しました');
      return null;
    }

    const deviceToken = getStoredDeviceToken();
    if (!deviceToken) {
      // createQuickDraftが新規device発行した場合は必ずstorageへ保存される
      // ため、通常ここには来ない(bootstrap直後の一貫性チェック)。
      console.error('QuickDraft promoteエラー: device_tokenが見つかりません');
      toast.error('プランの作成に失敗しました');
      return null;
    }

    let promoted;
    try {
      promoted = await travelAPI.promoteQuickDraft(
        draft.id,
        deviceToken,
        generateIdempotencyKey(),
      );
    } catch (error) {
      console.error('QuickDraft promoteエラー:', error);
      toast.error('プランの作成に失敗しました');
      return null;
    }

    // promoteのresponseはid/revision等のみの最小形なので、日程・予定を
    // 含む正規化データは改めてloadPlanで取得する。
    await get().loadPlan(promoted.id);

    return get().currentPlan;
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
      void _days;
      void _revision;
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

        // [Gate B-012] 削除は論理削除(30日以内なら復元できる)
        toast.success('プランを削除しました(30日以内なら「最近削除したプラン」から復元できます)');
      }
    } catch (error) {
      console.error('Delete plan error:', error);
      toast.error('プランの削除に失敗しました');
      // 呼出側(PlanHeader等)が成功扱いで画面を閉じないよう、失敗を伝える
      throw error;
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
      // [Gate G6] OFF-02 通信できない時は日程の作成を端末に溜める(この日程への予定の追加も仮のIDのまま溜められる)
      if (isNetworkError(error) && enqueue(plan.id, {
        entity_type: 'day', action: 'create', temp_id: tempId, label: localDate, fields: { local_date: localDate },
      })) {
        get().refreshSyncState(plan.id);
        toast(OFFLINE_SAVED_MESSAGE, { icon: '📴' });
        return;
      }
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
      // [Gate B-013] 予約・文書との紐付けを外した・区間等を一緒に削除した場合は、その内容を知らせる
      const note = describeItemDeletion('day', result.detached);
      if (note) toast.success(note);
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
      if (isNetworkError(error)) {
        // [Gate P11] 画面の予定(仮のID)はそのまま残し、作成を端末に溜める
        const queued = enqueue(plan.id, {
          action: 'create', temp_id: tempId, label: optimisticItem.title,
          fields: {
            day_id: day.id, title: optimisticItem.title, description: optimisticItem.description,
            event_type: optimisticItem.category, local_start_time: optimisticItem.start_time || null,
            address: optimisticItem.address, latitude: optimisticItem.latitude, longitude: optimisticItem.longitude,
          },
        });
        if (queued) {
          get().refreshSyncState(plan.id);
          toast(OFFLINE_SAVED_MESSAGE, { icon: '📴' });
          return;
        }
      }
      set({ currentPlan: plan });
      console.error('Add schedule item error:', error);
      toast.error('スポットの追加に失敗しました');
    }
  },

  // [Gate #32] 検索候補を「旅程に追加」する。まず候補をPlaceへ採用
  // (adopt)し、そのplace_idでイベントを作成する。「候補に追加」
  // (検索結果に残しておくだけの操作、既にGate #31の検索時点でDBへ
  // 保存済み)とは明確に分離された、確定的な操作。
  addScheduleItemFromCandidate: async (dayIndex: number, candidateId: string, fallbackTitle?: string) => {
    const state = get();
    if (!state.currentPlan || !state.currentPlan.days[dayIndex]) return;
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return;
    }

    const plan = state.currentPlan;
    const day = plan.days[dayIndex]!;

    try {
      const place = await apiService.adoptCandidate(candidateId);
      await apiService.createEvent(
        plan.id,
        {
          day_id: day.id,
          title: place.name || fallbackTitle || '新しいスポット',
          event_type: place.category || 'sightseeing',
          address: place.location?.address,
          latitude: place.location?.latitude,
          longitude: place.location?.longitude,
          place_id: place.id,
        },
        generateIdempotencyKey()
      );
      await get().loadPlan(plan.id);
      toast.success(`${place.name}を旅程に追加しました`);
    } catch (error) {
      console.error('Add schedule item from candidate error:', error);
      toast.error('候補の旅程への追加に失敗しました');
    }
  },

  // スケジュールアイテム更新
  updateScheduleItem: async (itemId: string, item: Partial<ScheduleItem>) => {
    const state = get();
    if (!state.currentPlan) return 'failed';
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return 'failed';
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
      // [Gate G2] FR-045 見せない設定の項目は送らない(空で上書きしない。backend も空は変えない扱い)
      const hidden = new Set(plan.hidden_fields ?? []);
      const hideNotes = hidden.has('event_notes');
      const hidePlace = hidden.has('event_address');
      const updated = await apiService.updateEvent(
        plan.id,
        itemId,
        {
          title: item.title,
          description: hideNotes ? undefined : item.description,
          event_type: item.category,
          local_start_time: item.start_time,
          // [Gate G7] FR-005 終了時刻を変えた時だけ送る(空は終了を消す)
          ...(item.end_time === undefined ? {} : {
            local_end_time: item.end_time || null,
            ...(item.end_time ? { end_day_offset: item.end_day_offset ?? 0 } : {}),
          }),
          address: hidePlace ? undefined : item.address,
          latitude: hidePlace ? undefined : item.latitude,
          longitude: hidePlace ? undefined : item.longitude,
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
      return 'saved';
    } catch (error) {
      if (isNetworkError(error) && item.end_time !== undefined) {
        // [Gate G7] FR-005 終了時刻(日をまたぐ予定)の変更は端末に溜めない(同期で開始との前後を確かめられないため)
        toast.error('終了時刻の変更は通信できる時に保存してください。');
        set({ currentPlan: plan });
        return 'failed';
      }
      if (isNetworkError(error)) {
        // [Gate P11] 画面の変更はそのまま残し、変更を端末に溜める(編集を始めた版=今の画面の版)
        const current = plan.days.flatMap((d) => d.events).find((e) => e.id === itemId);
        const queued = enqueue(plan.id, {
          action: 'update', entity_id: itemId, base_revision: plan.revision, label: item.title ?? current?.title ?? '予定',
          fields: {
            title: item.title, description: item.description, event_type: item.category,
            local_start_time: item.start_time === undefined ? undefined : item.start_time || null,
            address: item.address, latitude: item.latitude, longitude: item.longitude,
          },
        });
        if (queued) {
          get().refreshSyncState(plan.id);
          toast(OFFLINE_SAVED_MESSAGE, { icon: '📴' });
          return 'queued';
        }
      }
      set({ currentPlan: plan });
      await get()._reconcileOnConflict(error, plan.id);
      const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
      return status === 409 && conflictCode(error) !== 'locked_relation' ? 'conflict' : 'failed';
    }
  },

  // スケジュールアイテム削除
  deleteScheduleItem: async (itemId: string) => {
    const state = get();
    if (!state.currentPlan) return { ok: false, note: null };
    if (state.currentPlan.revision === undefined) {
      toast.error('このプランはまだ正規化データを読み込んでいません。再読み込みしてください。');
      return { ok: false, note: null };
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
      // [Gate B-013] 予約・文書との紐付けを外した・区間等を一緒に削除した場合の案内(表示は呼び出し側)
      return { ok: true, note: describeItemDeletion('event', result.detached) };
    } catch (error) {
      if (isNetworkError(error)) {
        // [Gate P11] 画面からは消したまま、削除を端末に溜める
        const current = plan.days.flatMap((d) => d.events).find((e) => e.id === itemId);
        const queued = enqueue(plan.id, {
          action: 'delete', entity_id: itemId, base_revision: plan.revision, label: current?.title ?? '予定',
        });
        if (queued) {
          get().refreshSyncState(plan.id);
          return { ok: true, note: OFFLINE_SAVED_MESSAGE };
        }
      }
      set({ currentPlan: plan });
      await get()._reconcileOnConflict(error, plan.id);
      return { ok: false, note: null };
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
        // [Gate G11] 既にその位置の番号の予定は送らない(確定の予定が動かない時に、移動の API の 409 で並べ替え全体が
        // 失敗していた。番号が分からない古いデータは今までどおり送る)
        if (event.sort_order === i) continue;
        // revisionを1件ずつ連鎖させるため、意図的に逐次awaitする(並列化不可)。
        await apiService.moveEvent(plan.id, event.id, { sort_order: i }, revision, generateIdempotencyKey());
        revision += 1;
      }
      set((s) => (s.currentPlan ? {
        currentPlan: {
          ...s.currentPlan, revision,
          days: s.currentPlan.days.map((d) => (d.id === day.id
            ? { ...d, events: d.events.map((e) => {
              const at = itemIds.indexOf(e.id);
              return at === -1 ? e : { ...e, sort_order: at };
            }) }
            : d)),
        },
      } : s));
    } catch (error) {
      // [Gate G6] OFF-02 通信できない時は並びを端末に溜める(送る時にサーバーの予定の集まりと違えば競合として知らせる)
      if (isNetworkError(error) && enqueue(plan.id, {
        entity_type: 'order', action: 'reorder', base_revision: plan.revision, label: `${day.date} の並び`,
        fields: { day_id: day.id, order: reorderedEvents.map((e) => e.id) },
      })) {
        get().refreshSyncState(plan.id);
        toast(OFFLINE_SAVED_MESSAGE, { icon: '📴' });
        return;
      }
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
      const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
      if (status === 404) {
        toast.error('取り消せる変更がありません');
      } else if (status === 409) {
        // [Gate B-013] 削除後に関連する予約・文書などが変わっていた場合は、上書きせずに断られる
        toast.error(conflictCode(error) === 'undo_conflict'
          ? UNDO_CONFLICT_MESSAGE
          : '他の変更と競合したため取り消せませんでした。最新の内容を再読み込みします。');
        await get().loadPlan(state.currentPlan.id);
      } else {
        toast.error('取り消しに失敗しました');
      }
    }
  },

  // [Gate #31.5C] 409(revision不一致)を検出した場合はプランを再読み込みし、
  // それ以外のエラーは通常のエラートーストのみ表示する。呼び出し元は
  // 呼ぶ前に楽観的更新のロールバックを済ませておくこと。
  refreshSyncState: (planId: string) => {
    set({ pendingSyncCount: loadQueue(planId).length, syncConflictCount: loadConflictCount(planId) });
  },

  setSyncConflictCount: (planId: string, count: number) => {
    saveConflictCount(planId, count);
    set({ syncConflictCount: count });
  },

  syncPending: async (planId: string) => {
    const queue = loadQueue(planId);
    if (queue.length === 0 || get().isSyncing) {
      get().refreshSyncState(planId);
      return;
    }
    set({ isSyncing: true });
    try {
      const res = await apiService.syncOperations(planId, toPayload(queue), deviceId());
      applyResults(planId, res.results);
      const { applied, already_applied: replayed, conflicted, rejected } = res.summary;
      saveConflictCount(planId, loadConflictCount(planId) + conflicted);
      get().refreshSyncState(planId);
      const parts = [`反映${applied + replayed}件`];
      if (conflicted) parts.push(`競合${conflicted}件`);
      if (rejected) parts.push(`反映できない変更${rejected}件`);
      const text = `端末に保存していた変更を送りました(${parts.join('・')})`;
      if (conflicted || rejected) toast.error(text);
      else toast.success(text);
      if (get().currentPlan?.id === planId) await get().loadPlan(planId);
    } catch (error) {
      // 通信できなければ溜めたまま次の機会に送る(再送しても二重に適用されない)
      if (!isNetworkError(error)) {
        console.error('Sync error:', error);
        toast.error('端末に保存していた変更を送れませんでした。しばらくしてからもう一度お試しください');
      }
      get().refreshSyncState(planId);
    } finally {
      set({ isSyncing: false });
    }
  },

  _reconcileOnConflict: async (error: unknown, planId: string) => {
    // [Gate B-013] 確定ロックされた予約との紐付けがあり削除できなかった場合は、版の競合ではない
    // (何も変更されていない)ため再読み込みせず、ロックの解除方法を案内する。
    if (conflictCode(error) === 'locked_relation') {
      toast.error(LOCKED_RELATION_MESSAGE);
      return;
    }
    const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
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

// [Gate G4] MAP-03 検索のコマンド(CommandPalette)で旅程を変えた時、開いている旅程なら読み直す
if (typeof window !== 'undefined') {
  window.addEventListener(PLAN_MUTATED_EVENT, (e) => {
    const planId = (e as CustomEvent<{ planId?: string }>).detail?.planId;
    const st = usePlanStore.getState();
    if (planId && st.currentPlan?.id === planId) void st.loadPlan(planId);
  });
}

// [Gate G9] UX-3 全体の見出しへ今開いている旅行を知らせる(見出しが planStore を読み込まずに済むように)
publishCurrentTrip(usePlanStore.getState().currentPlan);
usePlanStore.subscribe((st) => publishCurrentTrip(st.currentPlan));
