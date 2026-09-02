import React, { useState, useCallback, useMemo } from 'react';
import { usePlan } from '../hooks/usePlan';
import { useDragDrop } from '../hooks/useDragDrop';
import { useToast } from './common/Toast';
import Button from './common/Button';
import Card from './common/Card';
import Modal from './common/Modal';
import ScheduleItem from './planner/ScheduleItem';
import Input from './common/Input';
import type { DaySchedule, ScheduleItem as ScheduleItemType, CreateScheduleItemData } from '../types';

interface DayViewProps {
  day: DaySchedule;
  planId: string;
  isActive?: boolean;
  showTimeProgress?: boolean;
  onItemClick?: (item: ScheduleItemType) => void;
  onItemEdit?: (item: ScheduleItemType) => void;
  onItemDelete?: (itemId: string) => void;
  className?: string;
}

const DayView: React.FC<DayViewProps> = ({
  day,
  planId,
  isActive = false,
  showTimeProgress = true,
  onItemClick,
  onItemEdit,
  onItemDelete,
  className = ''
}) => {
  const { addNewScheduleItem, deleteScheduleItem } = usePlan();
  const { dragState, handleDragStart, handleDrop, handleDragEnd, isItemDragged } = useDragDrop();
  const { addToast } = useToast();
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newItemData, setNewItemData] = useState<Partial<CreateScheduleItemData>>({
    title: '',
    description: '',
    category: 'sightseeing',
    start_time: '',
    end_time: '',
    location_name: '',
    address: '',
    cost: 0,
    priority: 3
  });

  // 優先度(数値)と表示ラベルの相互変換
  const priorityToLabel = (p?: number): 'low' | 'medium' | 'high' => {
    if (p === undefined) return 'medium';
    if (p <= 2) return 'low';
    if (p >= 4) return 'high';
    return 'medium';
  };

  // 日付から曜日を算出(DaySchedule型にday_of_weekフィールドが存在しないため)
  const getDayOfWeek = (dateStr?: string): string => {
    if (!dateStr) return '';
    const labels = ['日', '月', '火', '水', '木', '金', '土'];
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return labels[d.getDay()] || '';
  };

  // 時間の計算
  const timeStats = useMemo(() => {
    const totalDuration = day.events.reduce((sum, item) => sum + (item.duration || 0), 0);
    const totalCost = day.events.reduce((sum, item) => sum + (item.cost || 0), 0);
    const totalTravelTime = day.events.reduce((sum, item) => sum + (item.travel_time || 0), 0);
    
    return {
      totalDuration,
      totalCost,
      totalTravelTime,
      eventCount: day.events.length
    };
  }, [day.events]);

  // 現在時刻に基づく次のイベントの特定
  const nextEventIndex = useMemo(() => {
    if (!showTimeProgress) return -1;
    
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    return day.events.findIndex(event => (event.start_time || '') > currentTime);
  }, [day.events, showTimeProgress]);

  // スケジュールアイテム追加
  const handleAddItem = useCallback(async () => {
    try {
      if (!newItemData.title?.trim()) {
        addToast({
          type: 'warning',
          message: 'タイトルを入力してください'
        });
        return;
      }

      const itemData: CreateScheduleItemData = {
        title: newItemData.title!,
        description: newItemData.description || '',
        category: newItemData.category || 'sightseeing',
        start_time: newItemData.start_time || '',
        end_time: newItemData.end_time || '',
        duration: newItemData.duration || 60,
        location_name: newItemData.location_name || '',
        latitude: newItemData.latitude || 0,
        longitude: newItemData.longitude || 0,
        address: newItemData.address || '',
        cost: newItemData.cost || 0,
        currency: 'JPY',
        priority: newItemData.priority || 3,
        travel_method: newItemData.travel_method || 'walking',
        travel_time: newItemData.travel_time || 0,
        travel_cost: newItemData.travel_cost || 0,
        notes: newItemData.notes || ''
      };

      await addNewScheduleItem(planId, day.id, itemData);
      
      setIsAddModalOpen(false);
      setNewItemData({
        title: '',
        description: '',
        category: 'sightseeing',
        start_time: '',
        end_time: '',
        location_name: '',
        address: '',
        cost: 0,
        priority: 3
      });

      addToast({
        type: 'success',
        message: 'スケジュールを追加しました'
      });

    } catch (error) {
      console.error('スケジュール追加エラー:', error);
      addToast({
        type: 'error',
        message: 'スケジュールの追加に失敗しました'
      });
    }
  }, [newItemData, addNewScheduleItem, planId, day.id, addToast]);

  // スケジュールアイテム削除
  const handleDeleteItem = useCallback(async (itemId: string) => {
    if (!confirm('このスケジュールを削除しますか？')) return;

    try {
      await deleteScheduleItem(itemId);
      onItemDelete?.(itemId);
      
      addToast({
        type: 'success',
        message: 'スケジュールを削除しました'
      });

    } catch (error) {
      console.error('スケジュール削除エラー:', error);
      addToast({
        type: 'error',
        message: 'スケジュールの削除に失敗しました'
      });
    }
  }, [deleteScheduleItem, onItemDelete, addToast]);

  // ドロップゾーンの処理
  const handleItemDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    const sourceContainerId = `${planId}-${day.id}`;
    handleDrop(e, sourceContainerId, targetIndex, (result) => {
      if (result.success) {
        addToast({
          type: 'success',
          message: 'スケジュールを並び替えました'
        });
      } else {
        addToast({
          type: 'error',
          message: result.error || '並び替えに失敗しました'
        });
      }
    });
  }, [planId, day.id, handleDrop, addToast]);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* デイヘッダー */}
      <Card variant={isActive ? "elevated" : "default"} padding="md">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {day.date} ({getDayOfWeek(day.date)})
            </h3>
            <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
              <span>📍 {timeStats.eventCount}件</span>
              <span>⏱️ {Math.floor(timeStats.totalDuration / 60)}時間{timeStats.totalDuration % 60}分</span>
              <span>💰 ¥{timeStats.totalCost.toLocaleString()}</span>
              {timeStats.totalTravelTime > 0 && (
                <span>🚶 移動{timeStats.totalTravelTime}分</span>
              )}
            </div>
          </div>
          
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAddModalOpen(true)}
            leftIcon={
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            }
          >
            追加
          </Button>
        </div>
      </Card>

      {/* スケジュールリスト */}
      <div className="space-y-3">
        {day.events.length === 0 ? (
          /* 空の状態 */
          <Card variant="outlined" padding="lg">
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-3">📅</div>
              <p className="text-lg font-medium mb-2">まだスケジュールがありません</p>
              <p className="text-sm mb-4">スポットを追加してプランを作成しましょう</p>
              <Button
                variant="primary"
                onClick={() => setIsAddModalOpen(true)}
                leftIcon={
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                }
              >
                最初のスケジュールを追加
              </Button>
            </div>
          </Card>
        ) : (
          day.events.map((event, index) => (
            <div key={event.id}>
              {/* ドロップゾーン */}
              {dragState.isDragging && (
                <div
                  className="h-2 rounded bg-blue-100 border-2 border-dashed border-blue-300 opacity-0 transition-opacity"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('opacity-100');
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('opacity-100');
                  }}
                  onDrop={(e) => handleItemDrop(e, index)}
                />
              )}
              
              {/* スケジュールアイテム */}
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, event, `${planId}-${day.id}`)}
                onDragEnd={handleDragEnd}
                onClick={() => onItemClick?.(event)}
                className={isItemDragged(event.id) ? 'opacity-50' : ''}
              >
                <ScheduleItem
                  id={event.id}
                  title={event.title}
                  description={event.description}
                  startTime={event.start_time || ''}
                  endTime={event.end_time || ''}
                  duration={event.duration || 0}
                  locationName={event.location_name || ''}
                  address={event.address || ''}
                  cost={event.cost}
                  currency={event.currency}
                  category={event.category}
                  priority={priorityToLabel(event.priority)}
                  travelMethod={event.travel_method}
                  travelTime={event.travel_time}
                  travelCost={event.travel_cost}
                  notes={event.notes}
                  isNext={showTimeProgress && index === nextEventIndex}
                  bookingInfo={event.booking_info as { url?: string; phone?: string } | undefined}
                  contactInfo={event.contact_info as { website?: string; phone?: string } | undefined}
                  onEdit={() => onItemEdit?.(event)}
                  onDelete={() => handleDeleteItem(event.id)}
                />
              </div>
            </div>
          ))
        )}
        
        {/* 最後のドロップゾーン */}
        {dragState.isDragging && day.events.length > 0 && (
          <div
            className="h-2 rounded bg-blue-100 border-2 border-dashed border-blue-300 opacity-0 transition-opacity"
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('opacity-100');
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove('opacity-100');
            }}
            onDrop={(e) => handleItemDrop(e, day.events.length)}
          />
        )}
      </div>

      {/* スケジュール追加モーダル */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="新しいスケジュールを追加"
        size="lg"
      >
        <Modal.Body>
          <div className="space-y-4">
            <Input
              label="タイトル *"
              value={newItemData.title || ''}
              onChange={(e) => setNewItemData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="東京タワー見学"
              fullWidth
            />
            
            <Input
              label="説明"
              value={newItemData.description || ''}
              onChange={(e) => setNewItemData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="展望台からの景色を楽しむ"
              fullWidth
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  カテゴリ
                </label>
                <select
                  value={newItemData.category || 'sightseeing'}
                  onChange={(e) => setNewItemData(prev => ({ ...prev, category: e.target.value as CreateScheduleItemData['category'] }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="sightseeing">観光・名所</option>
                  <option value="dining">グルメ・レストラン</option>
                  <option value="shopping">ショッピング</option>
                  <option value="activity">エンターテイメント</option>
                  <option value="accommodation">宿泊施設</option>
                  <option value="transportation">交通・移動</option>
                  <option value="other">その他</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  優先度
                </label>
                <select
                  value={newItemData.priority ?? 3}
                  onChange={(e) => setNewItemData(prev => ({ ...prev, priority: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value={1}>低</option>
                  <option value={3}>中</option>
                  <option value={5}>高</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="開始時間"
                type="time"
                value={newItemData.start_time || ''}
                onChange={(e) => setNewItemData(prev => ({ ...prev, start_time: e.target.value }))}
                fullWidth
              />
              
              <Input
                label="終了時間"
                type="time"
                value={newItemData.end_time || ''}
                onChange={(e) => setNewItemData(prev => ({ ...prev, end_time: e.target.value }))}
                fullWidth
              />
            </div>

            <Input
              label="場所"
              value={newItemData.location_name || ''}
              onChange={(e) => setNewItemData(prev => ({ ...prev, location_name: e.target.value }))}
              placeholder="東京タワー"
              fullWidth
            />

            <Input
              label="住所"
              value={newItemData.address || ''}
              onChange={(e) => setNewItemData(prev => ({ ...prev, address: e.target.value }))}
              placeholder="東京都港区芝公園4-2-8"
              fullWidth
            />

            <Input
              label="費用 (円)"
              type="number"
              value={newItemData.cost || 0}
              onChange={(e) => setNewItemData(prev => ({ ...prev, cost: Number(e.target.value) }))}
              fullWidth
            />
          </div>
        </Modal.Body>
        
        <Modal.Footer>
          <Button
            variant="outline"
            onClick={() => setIsAddModalOpen(false)}
          >
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={handleAddItem}
          >
            追加
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default DayView;