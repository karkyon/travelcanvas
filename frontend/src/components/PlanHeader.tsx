import React, { useState, useCallback, useMemo } from 'react';
import { usePlan } from '../hooks/usePlan';
import { useToast } from './common/Toast';
import Button from './common/Button';
import Input from './common/Input';
import Card from './common/Card';
import Modal from './common/Modal';
import type { TravelPlan } from '../types';

interface PlanHeaderProps {
  plan: TravelPlan;
  onShare?: () => void;
  onOptimize?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  className?: string;
}

const PlanHeader: React.FC<PlanHeaderProps> = ({
  plan,
  onShare,
  onOptimize,
  onDuplicate,
  onDelete,
  className = ''
}) => {
  const { updatePlanDetails, duplicatePlan, deletePlan } = usePlan();
  const { addToast } = useToast();
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedPlan, setEditedPlan] = useState({
    title: plan.title,
    description: plan.description || '',
    destination: plan.destination,
    budget: plan.budget,
    group_size: plan.group_size,
    tags: plan.tags || []
  });
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // プラン統計の計算
  const planStats = useMemo(() => {
    const totalDays = plan.days?.length || 0;
    const totalEvents = plan.days?.reduce((sum, day) => sum + day.events.length, 0) || 0;
    const totalCost = plan.days?.reduce((daySum, day) => 
      daySum + day.events.reduce((eventSum, event) => eventSum + (event.cost || 0), 0), 0) || 0;
    const totalDuration = plan.days?.reduce((daySum, day) => 
      daySum + day.events.reduce((eventSum, event) => eventSum + (event.duration || 0), 0), 0) || 0;

    const startDate = new Date(plan.start_date || 0);
    const endDate = new Date(plan.end_date || 0);
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return {
      totalDays,
      totalEvents,
      totalCost,
      totalDuration,
      daysDiff,
      averageCostPerDay: totalDays > 0 ? Math.round(totalCost / totalDays) : 0,
      averageEventsPerDay: totalDays > 0 ? Math.round(totalEvents / totalDays) : 0
    };
  }, [plan]);

  // プラン更新
  const handleUpdatePlan = useCallback(async () => {
    try {
      await updatePlanDetails(plan.id, editedPlan);
      setIsEditing(false);
      
      addToast({
        type: 'success',
        message: 'プラン情報を更新しました'
      });
    } catch (error) {
      console.error('プラン更新エラー:', error);
      addToast({
        type: 'error',
        message: 'プラン更新に失敗しました'
      });
    }
  }, [plan.id, editedPlan, updatePlanDetails, addToast]);

  // プラン複製
  const handleDuplicatePlan = useCallback(async () => {
    try {
      await duplicatePlan(plan.id);
      onDuplicate?.();
      
      addToast({
        type: 'success',
        message: 'プランを複製しました'
      });
    } catch (error) {
      console.error('プラン複製エラー:', error);
      addToast({
        type: 'error',
        message: 'プラン複製に失敗しました'
      });
    }
  }, [plan.id, duplicatePlan, onDuplicate, addToast]);

  // プラン削除
  const handleDeletePlan = useCallback(async () => {
    try {
      await deletePlan(plan.id);
      onDelete?.();
      setShowDeleteModal(false);
      
      addToast({
        type: 'success',
        message: 'プランを削除しました'
      });
    } catch (error) {
      console.error('プラン削除エラー:', error);
      addToast({
        type: 'error',
        message: 'プラン削除に失敗しました'
      });
    }
  }, [plan.id, deletePlan, onDelete, addToast]);

  // 編集キャンセル
  const handleCancelEdit = useCallback(() => {
    setEditedPlan({
      title: plan.title,
      description: plan.description || '',
      destination: plan.destination,
      budget: plan.budget,
      group_size: plan.group_size,
      tags: plan.tags || []
    });
    setIsEditing(false);
  }, [plan]);

  // 日付フォーマット
  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    });
  }, []);

  // タグの編集
  const handleTagInput = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
      const newTag = e.currentTarget.value.trim();
      if (!editedPlan.tags.includes(newTag)) {
        setEditedPlan(prev => ({
          ...prev,
          tags: [...prev.tags, newTag]
        }));
      }
      e.currentTarget.value = '';
    }
  }, [editedPlan.tags]);

  // タグの削除
  const removeTag = useCallback((tagToRemove: string) => {
    setEditedPlan(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  }, []);

  return (
    <div className={className}>
      <Card variant="elevated" padding="lg">
        {!isEditing ? (
          /* 表示モード */
          <div className="space-y-6">
            {/* ヘッダー情報 */}
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold text-gray-900">{plan.title}</h1>
                  <span className={`
                    px-2 py-1 text-xs font-medium rounded-full
                    ${plan.status === 'active' ? 'bg-green-100 text-green-800' :
                      plan.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                      plan.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'}
                  `}>
                    {plan.status === 'active' ? 'アクティブ' :
                     plan.status === 'draft' ? 'ドラフト' :
                     plan.status === 'completed' ? '完了' : plan.status}
                  </span>
                </div>
                
                {plan.description && (
                  <p className="text-gray-600 mb-3 leading-relaxed">{plan.description}</p>
                )}

                {/* 基本情報 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">📍 目的地</span>
                    <div className="font-medium">{plan.destination}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">📅 期間</span>
                    <div className="font-medium">{planStats.daysDiff}日間</div>
                  </div>
                  <div>
                    <span className="text-gray-500">👥 人数</span>
                    <div className="font-medium">{plan.group_size}人</div>
                  </div>
                  <div>
                    <span className="text-gray-500">💰 予算</span>
                    <div className="font-medium">¥{plan.budget?.toLocaleString()}</div>
                  </div>
                </div>

                {/* 日程 */}
                <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                  <div className="text-sm text-blue-800">
                    <span className="font-medium">📅 {formatDate(plan.start_date || '')}</span>
                    <span className="mx-2">〜</span>
                    <span className="font-medium">{formatDate(plan.end_date || '')}</span>
                  </div>
                </div>

                {/* タグ */}
                {plan.tags && plan.tags.length > 0 && (
                  <div className="mt-4">
                    <div className="flex flex-wrap gap-2">
                      {plan.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* アクションボタン */}
              <div className="flex gap-2 ml-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                  leftIcon={
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  }
                >
                  編集
                </Button>
                
                <div className="flex gap-1">
                  {onShare && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onShare}
                      leftIcon={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
                        </svg>
                      }
                    >
                      共有
                    </Button>
                  )}
                  
                  {onOptimize && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={onOptimize}
                      leftIcon={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      }
                    >
                      最適化
                    </Button>
                  )}
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDuplicatePlan}
                    leftIcon={
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
                        <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
                      </svg>
                    }
                  >
                    複製
                  </Button>
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowDeleteModal(true)}
                    leftIcon={
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    }
                    className="text-red-600 hover:text-red-700"
                  >
                    削除
                  </Button>
                </div>
              </div>
            </div>

            {/* 統計情報 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{planStats.totalEvents}</div>
                <div className="text-sm text-gray-600">総スポット数</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">¥{planStats.totalCost.toLocaleString()}</div>
                <div className="text-sm text-gray-600">総費用</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{Math.floor(planStats.totalDuration / 60)}h</div>
                <div className="text-sm text-gray-600">総所要時間</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">¥{planStats.averageCostPerDay.toLocaleString()}</div>
                <div className="text-sm text-gray-600">1日平均費用</div>
              </div>
            </div>
          </div>
        ) : (
          /* 編集モード */
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">プラン情報を編集</h2>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCancelEdit}>
                  キャンセル
                </Button>
                <Button variant="primary" onClick={handleUpdatePlan}>
                  保存
                </Button>
              </div>
            </div>

            <Input
              label="プランタイトル *"
              value={editedPlan.title}
              onChange={(e) => setEditedPlan(prev => ({ ...prev, title: e.target.value }))}
              placeholder="東京観光2泊3日"
              fullWidth
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                説明
              </label>
              <textarea
                value={editedPlan.description}
                onChange={(e) => setEditedPlan(prev => ({ ...prev, description: e.target.value }))}
                placeholder="プランの詳細説明を入力してください"
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="目的地 *"
                value={editedPlan.destination}
                onChange={(e) => setEditedPlan(prev => ({ ...prev, destination: e.target.value }))}
                placeholder="東京"
                fullWidth
              />

              <Input
                label="予算 (円)"
                type="number"
                value={editedPlan.budget}
                onChange={(e) => setEditedPlan(prev => ({ ...prev, budget: Number(e.target.value) }))}
                placeholder="50000"
                fullWidth
              />

              <Input
                label="人数"
                type="number"
                min="1"
                value={editedPlan.group_size}
                onChange={(e) => setEditedPlan(prev => ({ ...prev, group_size: Number(e.target.value) }))}
                placeholder="2"
                fullWidth
              />
            </div>

            {/* タグ編集 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                タグ
              </label>
              <div className="space-y-2">
                {editedPlan.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {editedPlan.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                      >
                        #{tag}
                        <button
                          onClick={() => removeTag(tag)}
                          className="ml-1 text-blue-600 hover:text-blue-800"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  type="text"
                  placeholder="タグを入力してEnterキーを押してください"
                  onKeyDown={handleTagInput}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* 削除確認モーダル */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="プランを削除"
        size="sm"
      >
        <Modal.Body>
          <div className="text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <p className="text-gray-700 mb-2">
              「{plan.title}」を削除しますか？
            </p>
            <p className="text-sm text-gray-500">
              この操作は取り消すことができません。
            </p>
          </div>
        </Modal.Body>
        
        <Modal.Footer>
          <Button
            variant="outline"
            onClick={() => setShowDeleteModal(false)}
          >
            キャンセル
          </Button>
          <Button
            variant="danger"
            onClick={handleDeletePlan}
          >
            削除
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default PlanHeader;