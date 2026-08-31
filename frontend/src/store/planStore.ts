import { create } from 'zustand';
import { TravelPlan, ScheduleItem, DaySchedule, Spot } from '@/types';
import { apiService } from '@/services/api';
import { toast } from 'react-hot-toast';

interface PlanState {
  // State
  plans: TravelPlan[];
  currentPlan: TravelPlan | null;
  currentDayIndex: number;
  isLoading: boolean;
  searchResults: Spot[];
  
  // Actions
  loadPlans: () => Promise<void>;
  loadPlan: (planId: string) => Promise<void>;
  createPlan: (planData: Partial<TravelPlan>) => Promise<TravelPlan | null>;
  updatePlan: (planId: string, planData: Partial<TravelPlan>) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;
  
  // Day management
  setCurrentDay: (dayIndex: number) => void;
  addDay: () => void;
  removeDay: (dayIndex: number) => void;
  
  // Schedule item management
  addScheduleItem: (dayIndex: number, item: Partial<ScheduleItem>) => Promise<void>;
  updateScheduleItem: (itemId: string, item: Partial<ScheduleItem>) => Promise<void>;
  deleteScheduleItem: (itemId: string) => Promise<void>;
  reorderScheduleItems: (dayIndex: number, itemIds: string[]) => Promise<void>;
  moveItemBetweenDays: (itemId: string, fromDayIndex: number, toDayIndex: number, newIndex: number) => Promise<void>;
  
  // Search
  searchSpots: (query: string, location?: { latitude: number; longitude: number }) => Promise<void>;
  clearSearchResults: () => void;
  
  // Clear state
  clearCurrentPlan: () => void;
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
  loadPlan: async (planId: string) => {
    set({ isLoading: true });
    
    try {
      const response = await apiService.getPlan(planId);
      
      if (response.success && response.data) {
        set({ 
          currentPlan: response.data, 
          currentDayIndex: 0,
          isLoading: false 
        });
      } else {
        throw new Error('プランの取得に失敗しました');
      }
    } catch (error) {
      console.error('Load plan error:', error);
      set({ isLoading: false });
      toast.error('プランの読み込みに失敗しました');
    }
  },

  // プラン作成
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

  // プラン更新
  updatePlan: async (planId: string, planData: Partial<TravelPlan>) => {
    try {
      const response = await apiService.updatePlan(planId, planData);
      
      if (response.success && response.data) {
        const updatedPlan = response.data;
        
        set((state) => ({
          plans: state.plans.map(plan => 
            plan.id === planId ? updatedPlan : plan
          ),
          currentPlan: state.currentPlan?.id === planId ? updatedPlan : state.currentPlan
        }));
        
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
  addDay: () => {
    const state = get();
    if (!state.currentPlan) return;
    
    const newDay: DaySchedule = {
      id: `day_${Date.now()}`,
      plan_id: state.currentPlan.id,
      day_number: state.currentPlan.days.length + 1,
      date: new Date(Date.now() + state.currentPlan.days.length * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      title: `Day ${state.currentPlan.days.length + 1}`,
      events: [],
      total_cost: 0,
      total_duration: 0
    };
    
    const updatedPlan = {
      ...state.currentPlan,
      days: [...state.currentPlan.days, newDay]
    };
    
    set({ currentPlan: updatedPlan });
    
    // APIに保存
    get().updatePlan(state.currentPlan.id, { days: updatedPlan.days });
  },

  // 日削除
  removeDay: (dayIndex: number) => {
    const state = get();
    if (!state.currentPlan || state.currentPlan.days.length <= 1) return;
    
    const updatedDays = state.currentPlan.days.filter((_, index) => index !== dayIndex);
    const updatedPlan = {
      ...state.currentPlan,
      days: updatedDays
    };
    
    set({ 
      currentPlan: updatedPlan,
      currentDayIndex: Math.min(state.currentDayIndex, updatedDays.length - 1)
    });
    
    // APIに保存
    get().updatePlan(state.currentPlan.id, { days: updatedDays });
  },

  // スケジュールアイテム追加
  addScheduleItem: async (dayIndex: number, item: Partial<ScheduleItem>) => {
    const state = get();
    if (!state.currentPlan || !state.currentPlan.days[dayIndex]) return;
    
    const day = state.currentPlan.days[dayIndex];
    const newItem: ScheduleItem = {
      id: `item_${Date.now()}`,
      day_id: day.id,
      title: item.title || '新しいスポット',
      description: item.description || '',
      category: item.category || 'sightseeing',
      start_time: item.start_time || '09:00',
      end_time: item.end_time || '10:00',
      duration: item.duration || 60,
      location_name: item.location_name || '',
      latitude: item.latitude,
      longitude: item.longitude,
      address: item.address,
      cost: item.cost || 0,
      currency: item.currency || 'JPY',
      priority: item.priority || 'medium',
      travel_method: item.travel_method,
      travel_time: item.travel_time,
      travel_cost: item.travel_cost,
      notes: item.notes,
      booking_info: item.booking_info,
      contact_info: item.contact_info,
      status: 'pending',
      order_index: day.events.length
    };
    
    const updatedDay = {
      ...day,
      events: [...day.events, newItem]
    };
    
    const updatedPlan = {
      ...state.currentPlan,
      days: state.currentPlan.days.map((d, index) => 
        index === dayIndex ? updatedDay : d
      )
    };
    
    set({ currentPlan: updatedPlan });
    
    try {
      // APIにアイテム追加
      // const response = await apiService.addScheduleItem(day.id, newItem);
      toast.success('スポットを追加しました');
    } catch (error) {
      console.error('Add schedule item error:', error);
      toast.error('スポットの追加に失敗しました');
    }
  },

  // スケジュールアイテム更新
  updateScheduleItem: async (itemId: string, item: Partial<ScheduleItem>) => {
    const state = get();
    if (!state.currentPlan) return;
    
    const updatedPlan = {
      ...state.currentPlan,
      days: state.currentPlan.days.map(day => ({
        ...day,
        events: day.events.map(event => 
          event.id === itemId ? { ...event, ...item } : event
        )
      }))
    };
    
    set({ currentPlan: updatedPlan });
    
    try {
      // APIにアイテム更新
      // const response = await apiService.updateScheduleItem(itemId, item);
      toast.success('スポットを更新しました');
    } catch (error) {
      console.error('Update schedule item error:', error);
      toast.error('スポットの更新に失敗しました');
    }
  },

  // スケジュールアイテム削除
  deleteScheduleItem: async (itemId: string) => {
    const state = get();
    if (!state.currentPlan) return;
    
    const updatedPlan = {
      ...state.currentPlan,
      days: state.currentPlan.days.map(day => ({
        ...day,
        events: day.events.filter(event => event.id !== itemId)
      }))
    };
    
    set({ currentPlan: updatedPlan });
    
    try {
      // APIからアイテム削除
      // const response = await apiService.deleteScheduleItem(itemId);
      toast.success('スポットを削除しました');
    } catch (error) {
      console.error('Delete schedule item error:', error);
      toast.error('スポットの削除に失敗しました');
    }
  },

  // スケジュールアイテムの並び替え
  reorderScheduleItems: async (dayIndex: number, itemIds: string[]) => {
    const state = get();
    if (!state.currentPlan || !state.currentPlan.days[dayIndex]) return;
    
    const day = state.currentPlan.days[dayIndex];
    const reorderedEvents = itemIds.map(id => 
      day.events.find(event => event.id === id)!
    ).map((event, index) => ({
      ...event,
      order_index: index
    }));
    
    const updatedDay = {
      ...day,
      events: reorderedEvents
    };
    
    const updatedPlan = {
      ...state.currentPlan,
      days: state.currentPlan.days.map((d, index) => 
        index === dayIndex ? updatedDay : d
      )
    };
    
    set({ currentPlan: updatedPlan });
    
    try {
      // APIに並び替え保存
      // await apiService.reorderScheduleItems(day.id, itemIds);
    } catch (error) {
      console.error('Reorder items error:', error);
      toast.error('並び替えの保存に失敗しました');
    }
  },

  // 日付間でのアイテム移動
  moveItemBetweenDays: async (itemId: string, fromDayIndex: number, toDayIndex: number, newIndex: number) => {
    const state = get();
    if (!state.currentPlan) return;
    
    const fromDay = state.currentPlan.days[fromDayIndex];
    const toDay = state.currentPlan.days[toDayIndex];
    const itemToMove = fromDay.events.find(event => event.id === itemId);
    
    if (!itemToMove) return;
    
    const updatedFromDay = {
      ...fromDay,
      events: fromDay.events.filter(event => event.id !== itemId)
    };
    
    const updatedToDay = {
      ...toDay,
      events: [
        ...toDay.events.slice(0, newIndex),
        { ...itemToMove, day_id: toDay.id, order_index: newIndex },
        ...toDay.events.slice(newIndex)
      ].map((event, index) => ({ ...event, order_index: index }))
    };
    
    const updatedPlan = {
      ...state.currentPlan,
      days: state.currentPlan.days.map((day, index) => {
        if (index === fromDayIndex) return updatedFromDay;
        if (index === toDayIndex) return updatedToDay;
        return day;
      })
    };
    
    set({ currentPlan: updatedPlan });
    
    try {
      // APIに移動保存
      // await apiService.moveScheduleItem(itemId, toDay.id, newIndex);
      toast.success('スポットを移動しました');
    } catch (error) {
      console.error('Move item error:', error);
      toast.error('スポットの移動に失敗しました');
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