import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { getHoursCheck } from '../services/api/g11planner';
import type { EventHoursCheck } from '../services/api/types/g11planner';
import type { TravelSegment } from '../services/api/types/segments';
import { hoursBadge, moveBlockedReason, reorderImpact, segmentRow } from './planner/plannerModel';
import ReorderImpact from './planner/ReorderImpact';
import ReorderPreview from './planner/ReorderPreview';
import TransportIcon from './common/TransportIcon';
import EventPhotoDialog from './planner/EventPhotoDialog';
import { getEventImageMedia, getEventImages, getMediaProviderStatus } from '../services/api/g11discover';
import type { EventImage } from '../services/api/types/g11discover';
import { creditOf } from '../hooks/useCoverPhoto';
import { getPlanCover } from '../services/api/g11';
import { usePlan } from '../hooks/usePlan';
import { useDragDrop, containerId, finalIndexForGap, reorderArray } from '../hooks/useDragDrop';
import { useToast } from './common/toastContext';
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
  /** [Gate G4] COL-03 予定へのコメントを開く */
  onItemComment?: (item: ScheduleItemType) => void;
  className?: string;
  /** [Gate G11] 旅行の移動区間(予定へ着く移動の名前・時差) */
  segments?: TravelSegment[];
  /** [Gate G11] 予定 → その日の時刻帯(時差をまたぐ区間の出発地) */
  zones?: Record<string, string | undefined>;
  /** [Gate G11] 予定 → 題名(区間の行の出発の予定。別の日の予定を含む) */
  titles?: Record<string, string>;
}

const DayView: React.FC<DayViewProps> = ({
  day,
  planId,
  isActive = false,
  showTimeProgress = true,
  onItemClick,
  onItemEdit,
  onItemDelete,
  onItemComment,
  className = '',
  segments = [],
  zones = {},
  titles,
}) => {
  const { addNewScheduleItem, deleteScheduleItem, reorderSchedule } = usePlan();
  const { dragState, handleDragStart, handleDragEnd, isItemDragged } = useDragDrop();

  // [Gate G11] 営業時間の照合。予定の順・時刻・場所が変わったら読み直し、読み直すまでは古い判定を「確認中」にする
  const hoursKey = useMemo(() => day.events.map((e) => `${e.id}|${e.start_time ?? ''}|${e.end_time ?? ''}|${e.place_id ?? ''}`)
    .join(','), [day.events]);
  const [hours, setHours] = useState<{ key: string; byId: Record<string, EventHoursCheck> } | null>(null);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (!day.events.some((e) => e.place_id)) {
      setHours({ key: hoursKey, byId: {} });
      return undefined;
    }
    let active = true;
    getHoursCheck(planId, day.id).then((r) => {
      if (!active) return;
      setHours({ key: hoursKey, byId: Object.fromEntries(r.events.map((h) => [h.event_id, h])) });
    }).catch(() => {
      if (active) setHours({ key: hoursKey, byId: {} });
    });
    return () => { active = false; };
  }, [planId, day.id, hoursKey, day.events]);
  const hoursPending = !hours || hours.key !== hoursKey;
  useEffect(() => {
    if (!hoursPending && announce.endsWith('確かめています')) setAnnounce(announce.replace('確かめています', '確かめました'));
  }, [hoursPending, announce]);

  // [Gate G11] 予定のカードの写真(見える写真だけ。一時の URL)
  const [images, setImages] = useState<Record<string, EventImage>>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [imagesVersion, setImagesVersion] = useState(0);
  const [photoFor, setPhotoFor] = useState<ScheduleItemType | null>(null);
  const [externalEnabled, setExternalEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    getEventImages(planId).then((m) => { if (active) setImages(m); }).catch(() => { if (active) setImages({}); });
    return () => { active = false; };
  }, [planId, imagesVersion]);
  const imageKey = day.events.filter((e) => images[e.id]).map((e) => `${e.id}:${images[e.id]!.memory_id}`).join(',');
  useEffect(() => {
    let active = true;
    const made: string[] = [];
    const ids = day.events.filter((e) => images[e.id]).map((e) => e.id);
    Promise.all(ids.map((id) => getEventImageMedia(planId, id).then((b) => [id, URL.createObjectURL(b)] as const)
      .catch(() => null))).then((rows) => {
      const ok = rows.filter((r): r is readonly [string, string] => r !== null);
      ok.forEach(([, u]) => made.push(u));
      if (active) setImageUrls(Object.fromEntries(ok));
      else ok.forEach(([, u]) => URL.revokeObjectURL(u));
    });
    return () => { active = false; made.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 写真の組み合わせ(imageKey)が変わった時だけ読み直す
  }, [planId, imageKey]);
  // 予定の写真を変えられるのは編集できる人だけ(表紙の API の can_edit と同じ判定)
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    let active = true;
    getPlanCover(planId).then((r) => { if (active) setCanEdit(r.can_edit); }).catch(() => { if (active) setCanEdit(false); });
    return () => { active = false; };
  }, [planId]);
  useEffect(() => {
    if (!canEdit) return undefined;
    let active = true;
    getMediaProviderStatus().then((s) => { if (active) setExternalEnabled(s.image_providers.length > 0); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [canEdit]);

  // [Gate G11] 並べ替えの影響(UIX-M03): 動かす前の並びと営業時間の判定を覚え、差・合わなくなった区間・元に戻すを出す。
  // 続けて動かした時は最初の並びを覚えたまま(元に戻すと、まとめて最初の並びへ戻る)
  const [impact, setImpact] = useState<{ order: string[]; hours: Record<string, EventHoursCheck> | null } | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const titleMap = useMemo(() => titles ?? Object.fromEntries(day.events.map((e) => [e.id, e.title])), [titles, day.events]);
  const impactModel = useMemo(() => (impact
    ? reorderImpact(impact.order, impact.hours, day.events, hours?.byId ?? null, hoursPending, segments) : null),
  [impact, day.events, hours, hoursPending, segments]);
  const impactShown = Boolean(impactModel && impactModel.moves.length > 0);
  useEffect(() => { setImpact(null); }, [day.id]);
  const undoReorder = useCallback(async () => {
    if (!impact) return;
    const now = day.events.map((e) => e.id);
    const back = [...impact.order.filter((id) => now.includes(id)), ...now.filter((id) => !impact.order.includes(id))];
    setImpactBusy(true);
    try {
      await reorderSchedule(planId, day.id, back);
      setImpact(null);
      setAnnounce('元の並びに戻しました。営業時間と移動を確かめています');
    } finally {
      setImpactBusy(false);
    }
  }, [impact, day.events, day.id, planId, reorderSchedule]);
  const keepReorder = useCallback(() => {
    setImpact(null);
    setAnnounce('この並びのままにしました');
  }, []);

  const { addToast } = useToast();

  // [Gate G11 段階7] 並べ替えは保存する前に「案」として見せる(UIX-M03 の preview)。触る・矢印キー・ドラッグは案を作るだけで、
  // 「この並びにする」で1回に保存する。保存の後は ReorderImpact(実際の判定の差と元に戻す)が続く
  const savedOrder = useMemo(() => day.events.map((e) => e.id), [day.events]);
  const byId = useMemo(() => Object.fromEntries(day.events.map((e) => [e.id, e])), [day.events]);
  const [pending, setPending] = useState<string[] | null>(null);
  const [applying, setApplying] = useState(false);
  const view = useMemo(() => {
    if (!pending) return day.events;
    const list = pending.map((id) => byId[id]).filter((e): e is ScheduleItemType => Boolean(e));
    return list.length === day.events.length ? list : day.events;
  }, [pending, byId, day.events]);
  useEffect(() => {
    if (!pending) return;
    const same = pending.length === savedOrder.length && pending.every((id) => savedOrder.includes(id));
    if (!same) {
      setPending(null);
      setAnnounce('予定が変わったため、並べ替えの案を取り消しました(保存していません)');
    }
  }, [pending, savedOrder]);
  useEffect(() => { setPending(null); }, [day.id]);
  const previewModel = useMemo(() => (pending ? reorderImpact(savedOrder, null, view, null, false, segments) : null),
    [pending, savedOrder, view, segments]);
  const propose = useCallback((next: string[], message: string) => {
    setImpact(null);
    setPending(next.join(',') === savedOrder.join(',') ? null : next);
    setAnnounce(message);
  }, [savedOrder]);
  const applyPending = useCallback(async () => {
    if (!pending) return;
    setApplying(true);
    try {
      setImpact({ order: savedOrder, hours: hoursPending ? null : (hours?.byId ?? {}) });
      await reorderSchedule(planId, day.id, pending);
      setPending(null);
      addToast({ type: 'success', message: 'スケジュールを並び替えました' });
      setAnnounce('この並びを保存しました。営業時間と移動を確かめています');
    } finally {
      setApplying(false);
    }
  }, [pending, savedOrder, hoursPending, hours, reorderSchedule, planId, day.id, addToast]);
  const cancelPending = useCallback(() => {
    setPending(null);
    setAnnounce('並べ替えの案をやめました(保存していません)');
  }, []);
  const moveBy = useCallback((event: ScheduleItemType, delta: -1 | 1) => {
    const index = view.findIndex((e) => e.id === event.id);
    const blocked = moveBlockedReason(view, index, delta);
    if (blocked) {
      setAnnounce(blocked);
      return;
    }
    const to = index + delta;
    if (index < 0 || to < 0 || to >= view.length) return;
    const next = view.map((e) => e.id);
    [next[index], next[to]] = [next[to]!, next[index]!];
    propose(next, `「${event.title}」を${to + 1}番目へ動かす案にしました。まだ保存していません`);
  }, [view, propose]);
  
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
      // [Gate B-013] 失敗(確定ロック・競合等)はストア側でロールバックと理由の表示を済ませる。
      // 成功した時だけ成功表示を出し、予約等との紐付けを外した場合はその内容を案内する。
      const { ok, note } = await deleteScheduleItem(itemId);
      if (!ok) return;
      onItemDelete?.(itemId);

      addToast({
        type: 'success',
        message: note ?? 'スケジュールを削除しました'
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
  // [Gate G11 段階7] ドラッグも案を作るだけ(保存は「この並びにする」)。確定(🔒)の予定の位置が変わる並べ替えは作らない
  const handleItemDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    let itemId: string | null = null;
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json')) as { itemId?: string; sourceContainer?: string };
      itemId = data.sourceContainer === containerId(planId, day.id) && data.itemId ? data.itemId : null;
    } catch {
      itemId = null;
    }
    handleDragEnd();
    if (!itemId || !byId[itemId]) return;
    const order = view.map((x) => x.id);
    const next = reorderArray(order, itemId, finalIndexForGap(order, itemId, targetIndex));
    if (view.some((x, i) => x.locked && next[i] !== x.id)) {
      setAnnounce('確定(🔒)の予定の位置が変わるため、この並べ替えはできません');
      addToast({ type: 'error', message: '確定(🔒)の予定の位置は変えられません' });
      return;
    }
    propose(next, `「${byId[itemId]!.title}」を${next.indexOf(itemId) + 1}番目へ動かす案にしました。まだ保存していません`);
  }, [planId, day.id, view, byId, handleDragEnd, propose, addToast]);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* デイヘッダー */}
      <Card variant={isActive ? "elevated" : "default"} padding="md">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink-900">
              {day.date} ({getDayOfWeek(day.date)})
            </h3>
            {/* [Gate G11] 予定の時刻はこの日の現地時間(端末と同じ時刻帯でも省かない) */}
            <p className="text-xs text-ink-700" data-testid="day-timezone">{`現地時間 · ${day.timezone_id || '時刻帯未確認'}`}</p>
            <div className="flex items-center space-x-4 text-sm text-ink-700 mt-1">
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

      {photoFor && (
        <EventPhotoDialog isOpen onClose={() => setPhotoFor(null)} planId={planId} eventId={photoFor.id}
          eventTitle={photoFor.title}
          near={typeof photoFor.latitude === 'number' && typeof photoFor.longitude === 'number'
            ? { latitude: photoFor.latitude, longitude: photoFor.longitude } : null}
          current={images[photoFor.id] ?? null} externalEnabled={externalEnabled}
          onChanged={() => setImagesVersion((v) => v + 1)} />
      )}

      {/* [Gate G11] 並べ替えの結果と再確認の知らせ(読み上げ) */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="reorder-status">{announce}</p>

      {pending && previewModel && (
        <ReorderPreview dayId={day.id} model={previewModel} busy={applying}
          onApply={() => { void applyPending(); }} onCancel={cancelPending} />
      )}

      {!pending && impactShown && impactModel && (
        <ReorderImpact dayId={day.id} model={impactModel} busy={impactBusy}
          onUndo={() => { void undoReorder(); }} onKeep={keepReorder} />
      )}

      {/* スケジュールリスト
          [Gate B-013] 予定(role="listitem")は一覧(role="list")の中に置く必要がある(axe
          aria-required-parent)。予定がある時だけ一覧の役割を与え、間の包みは役割無しにする。 */}
      <div
        className="space-y-3"
        role={day.events.length > 0 ? 'list' : undefined}
        aria-label={day.events.length > 0 ? `${day.date}の予定` : undefined}
      >
        {day.events.length === 0 ? (
          /* 空の状態 */
          <Card variant="outlined" padding="lg">
            <div className="text-center py-8 text-ink-500">
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
          view.map((event, index) => {
            const row = segmentRow(view, index, segments, zones, day.timezone_id, titleMap);
            const upBlocked = index === 0 || moveBlockedReason(view, index, -1) !== null;
            const downBlocked = index === view.length - 1 || moveBlockedReason(view, index, 1) !== null;
            return (
            <div key={event.id} role="none">
              {/* [Gate G11] この予定へ着く移動の区間(タイムラインの独立した行。並べ替えで前後が合わなくなったら知らせる) */}
              {row && (
                <div role="listitem" data-testid="segment-row" data-to-event={event.id}
                  data-mismatch={row.mismatch ? 'true' : 'false'}
                  className={`mb-2 ml-12 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border-l-4 px-2 py-1 text-xs ${
                    row.mismatch ? 'border-warning bg-warning-soft text-warning' : 'border-cloud-200 bg-cloud-100 text-ink-700'}`}>
                  <span className="sr-only">移動:</span>
                  <TransportIcon mode={row.leg.mode} />
                  <span>{row.leg.text}</span>
                  {row.leg.isEstimate && <span>(推定)</span>}
                  {row.leg.status === 'confirmed' && <span>・確定</span>}
                  {row.fromTitle && <span>{`「${row.fromTitle}」から`}</span>}
                  {row.leg.crossZone && <span data-testid="schedule-cross-zone">{row.leg.crossZone.text}</span>}
                  {row.leg.zoneUnknown && <span>・時刻帯未確認</span>}
                  {row.mismatch && (
                    <span data-testid="segment-mismatch">⚠ 前の予定と合っていません(区間は自動では直しません)</span>
                  )}
                </div>
              )}
              {/* ドロップゾーン */}
              {dragState.isDragging && (
                <div
                  className="h-2 rounded-sm bg-blue-100 border-2 border-dashed border-blue-300 opacity-0 transition-opacity"
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
                tabIndex={0}
                role="listitem"
                aria-label={`${event.title}(上下矢印キーで並べ替え)`}
                onDragStart={(e) => handleDragStart(e, event, containerId(planId, day.id))}
                onDragEnd={handleDragEnd}
                onClick={() => onItemClick?.(event)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    moveBy(event, e.key === 'ArrowUp' ? -1 : 1);
                  }
                }}
                className={`flex items-stretch gap-2 ${isItemDragged(event.id) ? 'opacity-50' : ''}`.trim()}
              >
                {/* [Gate G11] 触って使える並べ替え(ドラッグ・上下矢印キーと同じ入れ替え) */}
                <div className="flex shrink-0 flex-col justify-center gap-1">
                  <button type="button" aria-label={`「${event.title}」を上へ移す`} disabled={upBlocked}
                    data-testid={`move-up-${event.id}`}
                    className="min-h-11 min-w-11 rounded-md border border-cloud-200 bg-surface text-ink-700 disabled:opacity-40"
                    onClick={(e) => { e.stopPropagation(); moveBy(event, -1); }}>↑</button>
                  <button type="button" aria-label={`「${event.title}」を下へ移す`} disabled={downBlocked}
                    data-testid={`move-down-${event.id}`}
                    className="min-h-11 min-w-11 rounded-md border border-cloud-200 bg-surface text-ink-700 disabled:opacity-40"
                    onClick={(e) => { e.stopPropagation(); moveBy(event, 1); }}>↓</button>
                </div>
                <div className="min-w-0 flex-1">
                <ScheduleItem
                  id={event.id}
                  title={event.title}
                  description={event.description}
                  startTime={event.start_time || ''}
                  endTime={event.end_time || ''}
                  endDayOffset={event.end_day_offset}
                  duration={event.duration || 0}
                  locationName={event.location_name || ''}
                  address={event.address || ''}
                  cost={event.cost}
                  currency={event.currency}
                  category={event.category}
                  priority={priorityToLabel(event.priority)}
                  travelMethod={row ? undefined : event.travel_method}
                  travelTime={event.travel_time}
                  travelCost={event.travel_cost}
                  notes={event.notes}
                  isNext={showTimeProgress && index === nextEventIndex}
                  bookingInfo={event.booking_info as { url?: string; phone?: string } | undefined}
                  contactInfo={event.contact_info as { website?: string; phone?: string } | undefined}
                  onEdit={() => onItemEdit?.(event)}
                  onDelete={() => handleDeleteItem(event.id)}
                  onComment={onItemComment ? () => onItemComment(event) : undefined}
                  hours={hoursBadge(hours?.byId[event.id], hoursPending && Boolean(event.place_id))}
                  image={imageUrls[event.id] ? { src: imageUrls[event.id]!, credit: creditOf(images[event.id]?.source) } : null}
                  onPhoto={canEdit ? () => setPhotoFor(event) : undefined}
                />
                </div>
              </div>
            </div>
            );
          })
        )}
        
        {/* 最後のドロップゾーン */}
        {dragState.isDragging && day.events.length > 0 && (
          <div
            className="h-2 rounded-sm bg-blue-100 border-2 border-dashed border-blue-300 opacity-0 transition-opacity"
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
                <label className="block text-sm font-medium text-ink-700 mb-1">
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
                <label className="block text-sm font-medium text-ink-700 mb-1">
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