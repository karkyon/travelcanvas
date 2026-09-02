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
import { useParams, useNavigate } from 'react-router-dom';
import { usePlanStore } from '@/store/planStore';
import PlanHeader from '@/components/PlanHeader';
import DayView from '@/components/DayView';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

const PlannerPage: React.FC = () => {
  const { planId } = useParams<{ planId?: string }>();
  const navigate = useNavigate();

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
  } = usePlanStore();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [newPlanDestination, setNewPlanDestination] = useState('');
  const [isCreating, setIsCreating] = useState(false);

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

          <PlanHeader plan={currentPlan} className="mb-6" />

          {/* 日タブ */}
          <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
            {currentPlan.days.map((day, index) => (
              <button
                key={day.id}
                onClick={() => setCurrentDay(index)}
                className={`px-4 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-colors ${
                  index === currentDayIndex
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                Day {index + 1}
              </button>
            ))}
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
            <DayView day={activeDay} planId={currentPlan.id} isActive />
          ) : null}
        </div>
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
    </div>
  );
};

export default PlannerPage;
