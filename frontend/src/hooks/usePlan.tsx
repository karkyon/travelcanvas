import { useCallback } from 'react';
import { usePlanStore } from '../store/planStore';
import type { CreateScheduleItemData, ScheduleItem, TravelPlan } from '../types';

/**
 * usePlan
 *
 * [2026-09-01 Gate #7c] 全面書き換え。
 * 旧実装は `api.get/post/put/delete`(axios風の汎用呼び出し)と
 * `/travel/plans/...` というURLを直接叩いており、
 * - 実際の `api`(CompleteTravelAPI)にそのような汎用メソッドは無い
 * - 実バックエンド(Gate #6)は `/api/v1/travel-plans/` を提供している
 * のどちらとも一致せず、コンパイルも実行も不可能だった。
 *
 * 一方 `store/planStore.ts` は既に `apiService.getPlans()` 等、実在する
 * メソッドを正しく呼び出す完成度の高い実装だったため、今回はそれを
 * 正とし、本フックは planStore の薄いラッパーとして書き直す。
 *
 * 呼び出し元(PlanHeader.tsx / DayView.tsx / useDragDrop.tsx)が実際に
 * 使っている関数のみを実装している(未使用だった関数は削除)。
 */
export const usePlan = () => {
  const {
    currentPlan,
    plans,
    isLoading,
    loadPlans,
    loadPlan,
    createPlan,
    updatePlan,
    deletePlan: deletePlanFromStore,
    addScheduleItem,
    updateScheduleItem,
    deleteScheduleItem,
    reorderScheduleItems,
  } = usePlanStore();

  // planStoreの addScheduleItem / reorderScheduleItems は dayIndex(数値)で
  // 日を特定する設計になっている。呼び出し元は dayId(文字列)を持っている
  // ため、ここで currentPlan.days から該当インデックスを解決する。
  const resolveDayIndex = useCallback(
    (dayId: string): number => {
      if (!currentPlan) return -1;
      return currentPlan.days.findIndex((d) => d.id === dayId);
    },
    [currentPlan]
  );

  const updatePlanDetails = useCallback(
    async (planId: string, updateData: Partial<TravelPlan>) => {
      await updatePlan(planId, updateData);
    },
    [updatePlan]
  );

  const deletePlan = useCallback(
    async (planId: string) => {
      await deletePlanFromStore(planId);
    },
    [deletePlanFromStore]
  );

  // プラン複製: 実バックエンドに複製専用エンドポイントは無いため、
  // 取得 -> 新規作成 で複製する。
  const duplicatePlan = useCallback(
    async (planId: string) => {
      await loadPlan(planId);
      const original = usePlanStore.getState().currentPlan;
      if (!original) {
        throw new Error('複製元のプランが見つかりません');
      }

      const newPlan = await createPlan({
        title: `${original.title} (コピー)`,
        description: original.description,
        destination: original.destination,
        start_date: original.start_date,
        end_date: original.end_date,
        budget: original.budget,
        group_size: original.group_size,
        transport_modes: original.transport_modes,
        constraints: original.constraints,
        visibility: 'private',
        center_coordinates: original.center_coordinates,
        tags: original.tags,
      });

      if (!newPlan) {
        throw new Error('プランの複製に失敗しました');
      }

      return newPlan;
    },
    [loadPlan, createPlan]
  );

  const addNewScheduleItem = useCallback(
    async (_planId: string, dayId: string, itemData: CreateScheduleItemData) => {
      const dayIndex = resolveDayIndex(dayId);
      if (dayIndex === -1) {
        throw new Error('対象の日程が見つかりません');
      }
      await addScheduleItem(dayIndex, itemData as Partial<ScheduleItem>);
    },
    [addScheduleItem, resolveDayIndex]
  );

  const updateScheduleItemDetails = useCallback(
    async (itemId: string, updateData: Partial<ScheduleItem>) => {
      await updateScheduleItem(itemId, updateData);
    },
    [updateScheduleItem]
  );

  const reorderSchedule = useCallback(
    async (_planId: string, dayId: string, itemOrders: string[]) => {
      const dayIndex = resolveDayIndex(dayId);
      if (dayIndex === -1) {
        throw new Error('対象の日程が見つかりません');
      }
      await reorderScheduleItems(dayIndex, itemOrders);
    },
    [reorderScheduleItems, resolveDayIndex]
  );

  return {
    currentPlan,
    plans,
    loading: isLoading,
    loadPlans,
    loadPlan,
    updatePlanDetails,
    deletePlan,
    duplicatePlan,
    addNewScheduleItem,
    updateScheduleItemDetails,
    deleteScheduleItem,
    reorderSchedule,
  };
};
