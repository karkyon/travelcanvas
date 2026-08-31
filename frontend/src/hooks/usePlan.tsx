import { useState, useCallback } from 'react';
import { usePlanStore } from '../store/planStore';
import { api } from '../services/api';
import type { 
  TravelPlan, 
  CreatePlanData, 
  ScheduleItem, 
  CreateScheduleItemData,
  DaySchedule 
} from '../types';

export const usePlan = () => {
  const { 
    currentPlan, 
    plans, 
    setCurrentPlan, 
    addPlan, 
    updatePlan, 
    removePlan,
    addScheduleItem,
    updateScheduleItem,
    removeScheduleItem,
    reorderScheduleItems
  } = usePlanStore();
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // プラン一覧取得
  const fetchPlans = useCallback(async (params?: {
    page?: number;
    page_size?: number;
    status?: string;
    search?: string;
  }) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.get('/travel/plans', { params });
      return response.data.data;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'プラン取得に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // プラン作成
  const createPlan = useCallback(async (planData: CreatePlanData) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post('/travel/plans', planData);
      const newPlan = response.data.data;
      addPlan(newPlan);
      setCurrentPlan(newPlan);
      return newPlan;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'プラン作成に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [addPlan, setCurrentPlan]);

  // プラン詳細取得
  const fetchPlanDetails = useCallback(async (planId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.get(`/travel/plans/${planId}`);
      const plan = response.data.data;
      setCurrentPlan(plan);
      return plan;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'プラン詳細取得に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [setCurrentPlan]);

  // プラン更新
  const updatePlanDetails = useCallback(async (planId: string, updateData: Partial<TravelPlan>) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.put(`/travel/plans/${planId}`, updateData);
      const updatedPlan = response.data.data;
      updatePlan(planId, updatedPlan);
      setCurrentPlan(updatedPlan);
      return updatedPlan;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'プラン更新に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [updatePlan, setCurrentPlan]);

  // プラン削除
  const deletePlan = useCallback(async (planId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      await api.delete(`/travel/plans/${planId}`);
      removePlan(planId);
      if (currentPlan?.id === planId) {
        setCurrentPlan(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'プラン削除に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [removePlan, currentPlan, setCurrentPlan]);

  // スケジュールアイテム追加
  const addNewScheduleItem = useCallback(async (
    planId: string,
    dayId: string,
    itemData: CreateScheduleItemData
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post(`/travel/plans/${planId}/days/${dayId}/items`, itemData);
      const newItem = response.data.data;
      addScheduleItem(planId, dayId, newItem);
      return newItem;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'スケジュール追加に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [addScheduleItem]);

  // スケジュールアイテム更新
  const updateScheduleItemDetails = useCallback(async (
    itemId: string,
    updateData: Partial<ScheduleItem>
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.put(`/travel/schedule-items/${itemId}`, updateData);
      const updatedItem = response.data.data;
      updateScheduleItem(itemId, updatedItem);
      return updatedItem;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'スケジュール更新に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [updateScheduleItem]);

  // スケジュールアイテム削除
  const deleteScheduleItem = useCallback(async (itemId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      await api.delete(`/travel/schedule-items/${itemId}`);
      removeScheduleItem(itemId);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'スケジュール削除に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [removeScheduleItem]);

  // スケジュール並び替え
  const reorderSchedule = useCallback(async (
    planId: string,
    dayId: string,
    itemOrders: string[]
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      await api.post(`/travel/plans/${planId}/reorder`, {
        day_id: dayId,
        item_orders: itemOrders
      });
      
      reorderScheduleItems(planId, dayId, itemOrders);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '並び替えに失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [reorderScheduleItems]);

  // 現在の旅行状況取得
  const getCurrentStatus = useCallback(async (planId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.get(`/travel/plans/${planId}/current-status`);
      return response.data.data;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '現在状況取得に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // プラン複製
  const duplicatePlan = useCallback(async (planId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      // 元のプランを取得
      const originalPlan = await fetchPlanDetails(planId);
      
      // 新しいプランデータを作成
      const newPlanData: CreatePlanData = {
        title: `${originalPlan.title} (コピー)`,
        description: originalPlan.description,
        destination: originalPlan.destination,
        start_date: originalPlan.start_date,
        end_date: originalPlan.end_date,
        budget: originalPlan.budget,
        group_size: originalPlan.group_size,
        transport_modes: originalPlan.transport_modes,
        constraints: originalPlan.constraints,
        visibility: 'private',
        center_coordinates: originalPlan.center_coordinates,
        tags: originalPlan.tags
      };
      
      const duplicatedPlan = await createPlan(newPlanData);
      
      // スケジュールアイテムもコピー
      for (const day of originalPlan.days) {
        for (const item of day.events) {
          await addNewScheduleItem(duplicatedPlan.id, day.id, {
            spot_id: item.spot_id,
            title: item.title,
            description: item.description,
            category: item.category,
            start_time: item.start_time,
            end_time: item.end_time,
            duration: item.duration,
            location_name: item.location_name,
            latitude: item.latitude,
            longitude: item.longitude,
            address: item.address,
            cost: item.cost,
            currency: item.currency,
            priority: item.priority,
            travel_method: item.travel_method,
            travel_time: item.travel_time,
            travel_cost: item.travel_cost,
            notes: item.notes,
            booking_info: item.booking_info,
            contact_info: item.contact_info
          });
        }
      }
      
      return duplicatedPlan;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'プラン複製に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchPlanDetails, createPlan, addNewScheduleItem]);

  return {
    currentPlan,
    plans,
    loading,
    error,
    fetchPlans,
    createPlan,
    fetchPlanDetails,
    updatePlanDetails,
    deletePlan,
    addNewScheduleItem,
    updateScheduleItemDetails,
    deleteScheduleItem,
    reorderSchedule,
    getCurrentStatus,
    duplicatePlan,
    clearError: () => setError(null)
  };
};