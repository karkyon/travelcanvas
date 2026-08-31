import { useState, useCallback, useRef } from 'react';
import { usePlan } from './usePlan';
import type { ScheduleItem, DragDropState, DropResult } from '../types';

export const useDragDrop = () => {
  const { reorderSchedule, updateScheduleItemDetails } = usePlan();
  
  const [dragState, setDragState] = useState<DragDropState>({
    isDragging: false,
    draggedItems: [],
    draggedOver: null,
    sourceContainer: null,
    targetContainer: null
  });

  const dragImageRef = useRef<HTMLElement | null>(null);
  const ghostElementRef = useRef<HTMLElement | null>(null);

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
        const [sourcePlanId, sourceDayId] = sourceContainer.split('-');
        const [targetPlanId, targetDayId] = targetContainer.split('-');
        
        // アイテムの移動（日付間移動）
        await moveItemBetweenDays(itemId, sourceDayId, targetDayId, targetIndex);
        
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

  // 現在のアイテム順序取得（仮実装 - 実際はstoreから取得）
  const getCurrentItemOrder = useCallback((planId: string, dayId: string): string[] => {
    // TODO: storeから実際の順序を取得
    return [];
  }, []);

  // 日付間でのアイテム移動
  const moveItemBetweenDays = useCallback(async (
    itemId: string,
    sourceDayId: string,
    targetDayId: string,
    targetIndex: number
  ) => {
    // TODO: APIを呼び出して日付間移動を実行
    // 現在はupdateScheduleItemDetailsを使用して日付を更新
    await updateScheduleItemDetails(itemId, {
      // day_id: targetDayId, // API仕様に基づいて実装
    });
  }, [updateScheduleItemDetails]);

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
  const calculateSnapPosition = useCallback((
    draggedItem: ScheduleItem,
    targetContainer: string,
    mouseY: number
  ): number => {
    // TODO: 時間ベースの自動スナッピング計算
    // 営業時間、移動時間、バッファ時間を考慮した最適位置を計算
    return 0;
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

  // アクセシビリティサポート
  const handleKeyboardMove = useCallback((
    event: React.KeyboardEvent,
    item: ScheduleItem,
    direction: 'up' | 'down'
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      // TODO: キーボードによる移動の実装
    }
  }, []);

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