import { useState, useCallback, useRef } from 'react';
import { usePlan } from './usePlan';
import { usePlanStore } from '../store/planStore';
import type { ScheduleItem, DragDropState, DropResult } from '../types';

export const useDragDrop = () => {
  const { reorderSchedule } = usePlan();
  
  const [dragState, setDragState] = useState<DragDropState>({
    isDragging: false,
    draggedItems: [],
    draggedOver: null,
    sourceContainer: null,
    targetContainer: null
  });

  const dragImageRef = useRef<HTMLElement | null>(null);

  // ドラッグ開始
  const handleDragStart = useCallback((
    event: React.DragEvent,
    item: ScheduleItem,
    sourceContainer: string
  ) => {
    // ドラッグ画像のカスタマイズ
    const dragImage = event.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.transform = 'rotate(2deg)';
    dragImage.style.opacity = '0.8';
    dragImage.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
    
    document.body.appendChild(dragImage);
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImageRef.current = dragImage;
    
    event.dataTransfer.setDragImage(dragImage, 50, 25);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify({
      itemId: item.id,
      sourceContainer
    }));

    setDragState({
      isDragging: true,
      draggedItems: [item],
      draggedOver: null,
      sourceContainer,
      targetContainer: null
    });

    // ドラッグ終了時のクリーンアップをスケジュール
    setTimeout(() => {
      if (dragImageRef.current) {
        document.body.removeChild(dragImageRef.current);
        dragImageRef.current = null;
      }
    }, 0);
  }, []);

  // ドラッグオーバー
  const handleDragOver = useCallback((
    event: React.DragEvent,
    targetContainer: string,
    targetIndex?: number
  ) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    setDragState(prev => ({
      ...prev,
      draggedOver: targetIndex !== undefined ? targetIndex : null,
      targetContainer
    }));

    // ビジュアルフィードバック
    const dropZone = event.currentTarget as HTMLElement;
    dropZone.classList.add('drag-over');
  }, []);

  // ドラッグリーブ
  const handleDragLeave = useCallback((event: React.DragEvent) => {
    const dropZone = event.currentTarget as HTMLElement;
    dropZone.classList.remove('drag-over');
  }, []);

  // ドロップ
  const handleDrop = useCallback(async (
    event: React.DragEvent,
    targetContainer: string,
    targetIndex: number,
    onSuccess?: (result: DropResult) => void
  ) => {
    event.preventDefault();
    
    const dropZone = event.currentTarget as HTMLElement;
    dropZone.classList.remove('drag-over');

    try {
      const transferData = JSON.parse(event.dataTransfer.getData('application/json'));
      const { itemId, sourceContainer } = transferData;

      // 同じコンテナ内での移動の場合
      if (sourceContainer === targetContainer) {
        const [planId, dayId] = sourceContainer.split('-');
        
        // 現在の順序を取得し、新しい順序を計算
        const currentOrder = getCurrentItemOrder(planId, dayId);
        const newOrder = reorderArray(currentOrder, itemId, targetIndex);
        
        await reorderSchedule(planId, dayId, newOrder);
        
        const result: DropResult = {
          success: true,
          action: 'reorder',
          sourceContainer,
          targetContainer,
          itemId,
          newIndex: targetIndex
        };
        
        onSuccess?.(result);
      } else {
        // 異なるコンテナ間での移動の場合
        const [, sourceDayId] = sourceContainer.split('-');
        const [, targetDayId] = targetContainer.split('-');
        
        // アイテムの移動（日付間移動）
        await moveItemBetweenDays(itemId, sourceDayId ?? '', targetDayId ?? '', targetIndex);
        
        const result: DropResult = {
          success: true,
          action: 'move',
          sourceContainer,
          targetContainer,
          itemId,
          newIndex: targetIndex
        };
        
        onSuccess?.(result);
      }
    } catch (error) {
      console.error('ドロップ処理エラー:', error);
      
      const result: DropResult = {
        success: false,
        action: 'error',
        error: error instanceof Error ? error.message : '不明なエラー'
      };
      
      onSuccess?.(result);
    } finally {
      setDragState({
        isDragging: false,
        draggedItems: [],
        draggedOver: null,
        sourceContainer: null,
        targetContainer: null
      });
    }
  }, [reorderSchedule]);

  // ドラッグ終了
  const handleDragEnd = useCallback(() => {
    setDragState({
      isDragging: false,
      draggedItems: [],
      draggedOver: null,
      sourceContainer: null,
      targetContainer: null
    });

    // クリーンアップ
    document.querySelectorAll('.drag-over').forEach(el => {
      el.classList.remove('drag-over');
    });
  }, []);

  // 配列の並び替えヘルパー
  const reorderArray = useCallback((
    array: string[],
    itemId: string,
    newIndex: number
  ): string[] => {
    const currentIndex = array.indexOf(itemId);
    if (currentIndex === -1) return array;

    const newArray = [...array];
    newArray.splice(currentIndex, 1);
    newArray.splice(newIndex, 0, itemId);
    
    return newArray;
  }, []);

  // 現在のアイテム順序取得
  // [Gate #31.5C] 監査是正(R-08): 以前は常に空配列を返すTODOスタブで、
  // 同日内の並べ替え(reorderArray)が実質的に機能していなかった。
  // planStore.currentPlanから実際の順序を取得する。
  const getCurrentItemOrder = useCallback((planId: string, dayId: string): string[] => {
    const currentPlan = usePlanStore.getState().currentPlan;
    if (!currentPlan || currentPlan.id !== planId) return [];
    const day = currentPlan.days.find((d) => d.id === dayId);
    return day ? day.events.map((event) => event.id) : [];
  }, []);

  // 日付間でのアイテム移動
  // [Gate #31.5C] 監査是正(R-08): 以前はday_idを渡さずupdateScheduleItemDetails
  // (プラン全体PUT)を呼ぶだけで、実際には何も移動していなかった
  // (コメントアウトされたTODOがそのまま放置されていた)。
  // planStore.moveItemBetweenDaysはdayIndex(数値)で日を特定する設計のため、
  // dayId(文字列)からインデックスを解決してから呼び出す。
  const moveItemBetweenDays = useCallback(async (
    itemId: string,
    sourceDayId: string,
    targetDayId: string,
    targetIndex: number
  ) => {
    const currentPlan = usePlanStore.getState().currentPlan;
    if (!currentPlan) return;

    const fromDayIndex = currentPlan.days.findIndex((d) => d.id === sourceDayId);
    const toDayIndex = currentPlan.days.findIndex((d) => d.id === targetDayId);
    if (fromDayIndex === -1 || toDayIndex === -1) return;

    await usePlanStore.getState().moveItemBetweenDays(itemId, fromDayIndex, toDayIndex, targetIndex);
  }, []);

  // マルチセレクションサポート
  const handleMultiSelect = useCallback((
    event: React.MouseEvent,
    item: ScheduleItem
  ) => {
    if (event.ctrlKey || event.metaKey) {
      setDragState(prev => ({
        ...prev,
        draggedItems: prev.draggedItems.some(i => i.id === item.id)
          ? prev.draggedItems.filter(i => i.id !== item.id)
          : [...prev.draggedItems, item]
      }));
    } else {
      setDragState(prev => ({
        ...prev,
        draggedItems: [item]
      }));
    }
  }, []);

  // スマートスナッピング（時間に基づく自動配置）
  // [Gate #31.5C] 監査是正(R-08): 以前は常に0を返すだけのTODOスタブ
  // だった。ドラッグ位置(コンテナ内の相対Y座標)を1日の表示時間範囲に
  // 線形マッピングし、15分単位にスナップした時刻文字列を返す実装に
  // 置き換える。
  // 注記: 本関数はロジックとして実装済みだが、ピクセル単位の時間軸
  // ビジュアル(タイムグリッド表示)をDayView.tsxへ統合する作業は
  // 別途のUI変更が必要なため次Gate以降のスコープとする(呼び出し元の
  // ドラッグ中プレビュー表示への配線は未実施)。
  const calculateSnapPosition = useCallback((
    _draggedItem: ScheduleItem,
    _targetContainer: string,
    mouseY: number,
    containerTop: number = 0,
    containerHeight: number = 800,
    dayStartHour: number = 6,
    dayEndHour: number = 24
  ): string => {
    const relativeY = Math.max(0, Math.min(1, (mouseY - containerTop) / containerHeight));
    const totalMinutes = (dayEndHour - dayStartHour) * 60;
    const targetMinutes = dayStartHour * 60 + relativeY * totalMinutes;
    const snapped = Math.round(targetMinutes / 15) * 15; // 15分単位にスナップ
    const hh = Math.floor(snapped / 60) % 24;
    const mm = snapped % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }, []);

  // ドラッグプレビューの更新
  const updateDragPreview = useCallback((
    event: React.DragEvent,
    draggedItems: ScheduleItem[]
  ) => {
    if (draggedItems.length > 1) {
      // マルチアイテムの場合のプレビュー表示
      const preview = document.createElement('div');
      preview.innerHTML = `${draggedItems.length}個のアイテム`;
      preview.style.position = 'absolute';
      preview.style.background = '#3b82f6';
      preview.style.color = 'white';
      preview.style.padding = '4px 8px';
      preview.style.borderRadius = '4px';
      preview.style.fontSize = '12px';
      
      event.dataTransfer.setDragImage(preview, 10, 10);
    }
  }, []);

  // アクセシビリティサポート: キーボードによる同日内の並べ替え
  // [Gate #31.5C] 監査是正(R-08): 以前はEnter/Spaceキーを検知するだけで
  // 実際の移動処理が無いTODOスタブだった。矢印キーで前後のアイテムと
  // 入れ替え、reorderScheduleを呼び出す実装に置き換える。
  const handleKeyboardMove = useCallback(async (
    event: React.KeyboardEvent,
    item: ScheduleItem,
    planId: string,
    dayId: string
  ) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();

    const currentOrder = getCurrentItemOrder(planId, dayId);
    const currentIndex = currentOrder.indexOf(item.id);
    if (currentIndex === -1) return;

    const targetIndex = event.key === 'ArrowUp' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= currentOrder.length) return;

    const newOrder = [...currentOrder];
    const tmp = newOrder[currentIndex]!;
    newOrder[currentIndex] = newOrder[targetIndex]!;
    newOrder[targetIndex] = tmp;

    await reorderSchedule(planId, dayId, newOrder);
  }, [getCurrentItemOrder, reorderSchedule]);

  return {
    dragState,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleMultiSelect,
    calculateSnapPosition,
    updateDragPreview,
    handleKeyboardMove,
    
    // ヘルパー関数
    isDragging: dragState.isDragging,
    draggedItems: dragState.draggedItems,
    isItemDragged: (itemId: string) => 
      dragState.draggedItems.some(item => item.id === itemId),
    isValidDropTarget: (container: string) =>
      dragState.sourceContainer !== container || dragState.isDragging
  };
};