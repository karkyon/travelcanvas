/**
 * PlannerPage - 旅行プランナー
 *
 * [Gate #11] これまでスタブ("The travel planner interface will be
 * implemented here.")のままだったページを実装。DayView/PlanHeader/planStoreは
 * 既にGate #7g以降で修正・接続済みだったが、実際にレンダリングするページが
 * 存在しなかったため一度も画面に表示されていなかった。
 *
 * /planner        -> プラン一覧 + 新規作成
 * /planner/:planId -> 選択したプランの日程編集画面(PlanHeader + 日タブ + DayView)
 */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { usePlanStore } from '@/store/planStore';
import PlanHeader from '@/components/PlanHeader';
import DayView from '@/components/DayView';
import DateNavigation from '@/components/planner/DateNavigation';
import OptimizationPanel from '@/components/planner/OptimizationPanel';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useToast } from '@/components/common/Toast';
import { spotApiService } from '@/services/spotApi';
import type { ScheduleItem as ScheduleItemType } from '@/types';

// SearchPage.tsxから渡ってくる検索結果スポットの形状(最小限のフィールドのみ利用)
interface IncomingSpot {
  name: string;
  description?: string;
  category?: string;
  address?: string;
  location?: { latitude?: number; longitude?: number; address?: string };
  estimated_duration?: number;
  estimated_cost?: number;
}

// 日付から曜日を算出(DaySchedule型にday_of_weekフィールドが存在しないため、DayView.tsxと同じ方式)
const getDayOfWeek = (dateStr?: string): string => {
  if (!dateStr) return '';
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return labels[d.getDay()] || '';
};

const PlannerPage: React.FC = () => {
  const { planId } = useParams<{ planId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToast } = useToast();

  const {
    plans,
    currentPlan,
    currentDayIndex,
    isLoading,
    loadPlans,
    loadPlan,
    createPlan,
    deletePlan,
    setCurrentDay,
    addDay,
    removeDay,
    clearCurrentPlan,
    updateScheduleItem,
    deleteScheduleItem,
  } = usePlanStore();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [newPlanDestination, setNewPlanDestination] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // [Gate #18] DayView.tsxのonItemClick/onItemEdit/onItemDeleteがどこからも
  // 渡されておらず、日程に追加したスケジュールアイテムをクリックしても編集も
  // 削除も一切できなかった。編集モーダルとstoreへの実際の保存処理を実装する。
  const [editingItem, setEditingItem] = useState<ScheduleItemType | null>(null);
  const [editForm, setEditForm] = useState<{
    title: string;
    start_time: string;
    end_time: string;
    location_name: string;
    cost: string;
    notes: string;
  }>({ title: '', start_time: '', end_time: '', location_name: '', cost: '', notes: '' });
  const [isSavingItem, setIsSavingItem] = useState(false);

  const openEditItem = (item: ScheduleItemType) => {
    setEditingItem(item);
    setEditForm({
      title: item.title,
      start_time: item.start_time || '',
      end_time: item.end_time || '',
      location_name: item.location_name || '',
      cost: item.cost !== undefined ? String(item.cost) : '',
      notes: item.notes || '',
    });
  };

  const handleSaveEditItem = async () => {
    if (!editingItem) return;
    setIsSavingItem(true);
    try {
      await updateScheduleItem(editingItem.id, {
        title: editForm.title,
        start_time: editForm.start_time || undefined,
        end_time: editForm.end_time || undefined,
        location_name: editForm.location_name || undefined,
        cost: editForm.cost ? Number(editForm.cost) : undefined,
        notes: editForm.notes || undefined,
      });
      setEditingItem(null);
    } finally {
      setIsSavingItem(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('このスポットを日程から削除しますか？')) return;
    await deleteScheduleItem(itemId);
  };

  // [Gate #16] SearchPage.tsxの「プランに追加」ボタンはlocation.state.newSpotで
  // スポットを渡していたが、これまでPlannerPage側で一切受け取っておらず、
  // 検索結果が実際にはどこにも保存されないまま「プランに追加しました」という
  // 偽の成功トーストだけが表示されていた実害バグ。ここで実際に受け取り処理する。
  // [Gate #17] SpotListPage.tsxの「詳細」ボタンも同様にlocation.state.spotId
  // (登録済みスポットのID)を渡していたが、こちらも一切受け取られていなかった。
  // spotIdのみの場合はAPIから詳細を取得してから同じ追加フローに合流させる。
  const routeState = location.state as { newSpot?: IncomingSpot; spotId?: string } | null;
  const [incomingSpot, setIncomingSpot] = useState<IncomingSpot | undefined>(routeState?.newSpot);
  const [isAddSpotModalOpen, setIsAddSpotModalOpen] = useState(false);
  const [isAddingSpot, setIsAddingSpot] = useState(false);

  useEffect(() => {
    if (routeState?.newSpot) {
      setIncomingSpot(routeState.newSpot);
      setIsAddSpotModalOpen(true);
    } else if (routeState?.spotId) {
      (async () => {
        try {
          const spot = await spotApiService.getSpot(routeState.spotId as string);
          setIncomingSpot({
            name: spot.name,
            description: spot.description,
            category: spot.category,
            address: spot.address,
            location: { latitude: spot.latitude, longitude: spot.longitude },
          });
          setIsAddSpotModalOpen(true);
        } catch (error) {
          console.error('スポット詳細取得エラー:', error);
          addToast({ message: 'スポット情報の取得に失敗しました', type: 'error' });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState?.newSpot, routeState?.spotId]);

  const addSpotToExistingOrNewPlan = async (targetPlanId?: string) => {
    if (!incomingSpot) return;
    setIsAddingSpot(true);
    try {
      let plan = targetPlanId ? plans.find((p) => p.id === targetPlanId) : undefined;

      if (!plan) {
        // 新規プランとして作成(検索結果の名前をプラン名の初期値に)
        const created = await createPlan({
          title: `${incomingSpot.name}の旅`,
          days: [],
        });
        if (!created) throw new Error('プランの作成に失敗しました');
        plan = created;
      }

      await loadPlan(plan.id);
      // ロード直後のstoreの最新状態を直接参照(useEffectの再レンダリング待ちを避ける)
      const loadedPlan = usePlanStore.getState().currentPlan;
      if (!loadedPlan) throw new Error('プランの読み込みに失敗しました');

      if (loadedPlan.days.length === 0) {
        addDay();
      }

      await usePlanStore.getState().addScheduleItem(0, {
        title: incomingSpot.name,
        description: incomingSpot.description,
        category: (incomingSpot.category as any) || 'sightseeing',
        location_name: incomingSpot.name,
        address: incomingSpot.address || incomingSpot.location?.address,
        latitude: incomingSpot.location?.latitude,
        longitude: incomingSpot.location?.longitude,
        duration: incomingSpot.estimated_duration,
        cost: incomingSpot.estimated_cost,
      });

      addToast({ message: `${incomingSpot.name}をプランに追加しました`, type: 'success' });
      setIsAddSpotModalOpen(false);
      navigate(`/planner/${plan.id}`, { replace: true, state: null });
    } catch (error) {
      console.error('スポット追加エラー:', error);
      addToast({
        message: error instanceof Error ? error.message : 'プランへの追加に失敗しました',
        type: 'error',
      });
    } finally {
      setIsAddingSpot(false);
    }
  };

  // 一覧画面: プラン一覧を読み込む
  useEffect(() => {
    if (!planId) {
      loadPlans();
    }
  }, [planId]);

  // 詳細画面: 指定プランを読み込む
  useEffect(() => {
    if (planId) {
      loadPlan(planId);
    } else {
      clearCurrentPlan();
    }
  }, [planId]);

  const handleCreatePlan = async () => {
    if (!newPlanTitle.trim()) return;
    setIsCreating(true);
    try {
      const created = await createPlan({
        title: newPlanTitle.trim(),
        destination: newPlanDestination.trim() || undefined,
        days: [],
      });
      if (created) {
        setIsCreateModalOpen(false);
        setNewPlanTitle('');
        setNewPlanDestination('');
        navigate(`/planner/${created.id}`);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeletePlan = async (id: string) => {
    if (!confirm('このプランを削除しますか？')) return;
    await deletePlan(id);
  };

  // ===== 詳細画面(日程編集) =====
  if (planId) {
    if (isLoading && !currentPlan) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      );
    }

    if (!currentPlan) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600 mb-4">プランが見つかりませんでした</p>
            <Button variant="primary" onClick={() => navigate('/planner')}>
              プラン一覧へ戻る
            </Button>
          </div>
        </div>
      );
    }

    const activeDay = currentPlan.days[currentDayIndex];

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/planner')}
            className="mb-4"
          >
            ← プラン一覧へ戻る
          </Button>

          {/* [Gate #25] 共有ページ・最適化パネルはどちらも実装済みだったが、
              どこからもリンクされておらずUIから一度も到達できなかった。 */}
          <div className="flex items-center justify-end mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/share/${currentPlan.id}`)}
            >
              🤝 共有
            </Button>
          </div>

          <PlanHeader plan={currentPlan} className="mb-6" />

          <OptimizationPanel plan={currentPlan} className="mb-6" />

          {/* 日タブナビゲーション + 日ごとの概要(スポット数・所要時間・予算) */}
          {currentPlan.days.length > 0 && (
            <DateNavigation
              className="mb-4 rounded-lg overflow-hidden"
              currentDay={currentDayIndex}
              onDayChange={setCurrentDay}
              travelDates={{
                startDate: currentPlan.days[0]?.date || currentPlan.start_date || '',
                endDate: currentPlan.days[currentPlan.days.length - 1]?.date || currentPlan.end_date || '',
              }}
              days={currentPlan.days.map((day, index) => ({
                index,
                date: day.date || '',
                dayOfWeek: getDayOfWeek(day.date),
                isActive: index === currentDayIndex,
                isCompleted: false,
                eventCount: day.events.length,
                status: index === currentDayIndex ? 'current' : 'upcoming',
                highlights: day.events.slice(0, 3).map((e) => e.title),
                totalCost: day.events.reduce((sum, e) => sum + (e.cost || 0), 0),
                totalDuration: day.events.reduce((sum, e) => sum + (e.duration || 0), 0),
              }))}
            />
          )}

          <div className="flex items-center gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={addDay}>
              ＋ 日を追加
            </Button>
            {currentPlan.days.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeDay(currentDayIndex)}
              >
                この日を削除
              </Button>
            )}
          </div>

          {currentPlan.days.length === 0 ? (
            <Card>
              <div className="p-8 text-center text-gray-500">
                <p className="mb-4">まだ日程がありません</p>
                <Button variant="primary" onClick={addDay}>
                  最初の日を追加
                </Button>
              </div>
            </Card>
          ) : activeDay ? (
            <DayView
              day={activeDay}
              planId={currentPlan.id}
              isActive
              onItemClick={openEditItem}
              onItemEdit={openEditItem}
              onItemDelete={handleDeleteItem}
            />
          ) : null}
        </div>

        {/* スケジュールアイテム編集モーダル(Gate #18) */}
        <Modal isOpen={!!editingItem} onClose={() => setEditingItem(null)} title="スポットを編集">
          <Modal.Body>
            <div className="space-y-4">
              <Input
                label="タイトル"
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                fullWidth
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="開始時刻"
                  type="time"
                  value={editForm.start_time}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, start_time: e.target.value }))}
                  fullWidth
                />
                <Input
                  label="終了時刻"
                  type="time"
                  value={editForm.end_time}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, end_time: e.target.value }))}
                  fullWidth
                />
              </div>
              <Input
                label="場所"
                value={editForm.location_name}
                onChange={(e) => setEditForm((prev) => ({ ...prev, location_name: e.target.value }))}
                fullWidth
              />
              <Input
                label="費用(円)"
                type="number"
                value={editForm.cost}
                onChange={(e) => setEditForm((prev) => ({ ...prev, cost: e.target.value }))}
                fullWidth
              />
              <Input
                label="メモ"
                value={editForm.notes}
                onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                fullWidth
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline" onClick={() => setEditingItem(null)}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveEditItem}
              loading={isSavingItem}
              disabled={!editForm.title.trim()}
            >
              保存
            </Button>
          </Modal.Footer>
        </Modal>
      </div>
    );
  }

  // ===== 一覧画面 =====
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">プランナー</h1>
            <p className="text-gray-600">旅行プランを作成・編集します</p>
          </div>
          <Button variant="primary" onClick={() => setIsCreateModalOpen(true)}>
            ＋ 新しいプラン
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : plans.length === 0 ? (
          <Card>
            <div className="p-12 text-center text-gray-500">
              <p className="mb-4">まだプランがありません</p>
              <Button variant="primary" onClick={() => setIsCreateModalOpen(true)}>
                最初のプランを作成
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <Card key={plan.id} className="hover:shadow-lg transition-shadow cursor-pointer">
                <div className="p-5" onClick={() => navigate(`/planner/${plan.id}`)}>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">{plan.title}</h3>
                  {plan.destination && (
                    <p className="text-sm text-gray-600 mb-2">📍 {plan.destination}</p>
                  )}
                  <p className="text-xs text-gray-400">
                    {plan.days?.length ?? 0}日間の日程
                  </p>
                </div>
                <div className="px-5 pb-4 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePlan(plan.id);
                    }}
                  >
                    削除
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="新しいプラン">
        <Modal.Body>
          <div className="space-y-4">
            <Input
              label="プラン名"
              value={newPlanTitle}
              onChange={(e) => setNewPlanTitle(e.target.value)}
              placeholder="例: 東京旅行"
              fullWidth
              autoFocus
            />
            <Input
              label="目的地(任意)"
              value={newPlanDestination}
              onChange={(e) => setNewPlanDestination(e.target.value)}
              placeholder="例: 東京"
              fullWidth
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={handleCreatePlan}
            loading={isCreating}
            disabled={!newPlanTitle.trim()}
          >
            作成
          </Button>
        </Modal.Footer>
      </Modal>

      {/* 検索結果からのスポット追加モーダル(Gate #16) */}
      <Modal
        isOpen={isAddSpotModalOpen}
        onClose={() => {
          setIsAddSpotModalOpen(false);
          navigate('/planner', { replace: true, state: null });
        }}
        title="プランに追加"
      >
        <Modal.Body>
          <p className="text-sm text-gray-600 mb-4">
            「{incomingSpot?.name}」をどのプランに追加しますか？
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => addSpotToExistingOrNewPlan(plan.id)}
                disabled={isAddingSpot}
                className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                <div className="font-medium text-gray-900">{plan.title}</div>
                {plan.destination && (
                  <div className="text-xs text-gray-500">📍 {plan.destination}</div>
                )}
              </button>
            ))}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="primary"
            onClick={() => addSpotToExistingOrNewPlan(undefined)}
            loading={isAddingSpot}
          >
            ＋ 新しいプランを作成して追加
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default PlannerPage;
