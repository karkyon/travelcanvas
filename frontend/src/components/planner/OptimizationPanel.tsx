/**
 * OptimizationPanel - 経路最適化パネル(Gate #33)
 *
 * [Gate #33 監査是正] 以前は「AI最適化」と称し、時間効率/コスト重視/
 * バランス/エコの4モードと、天候考慮・混雑回避・徒歩許容度・食事休憩等
 * 多数の設定項目を持っていた。しかしbackend実体は緯度経度のみを見る
 * 近傍法(nearest neighbor)であり、これらの設定はUI上に存在するだけで
 * 一切の処理に反映されていなかった(見せかけの高機能感)。
 *
 * 本コンポーネントは実際に行われている処理だけを提示する:
 * - 現在表示中の日のイベントを、近傍法(直線距離ベース)で並べ替える
 *   提案を計算する(何も確定させない)。
 * - ロック済みイベント・位置情報が無いイベントは対象外であることを明示する。
 * - 適用前に移動距離の削減量(概算)を表示し、ユーザーが承認して初めて
 *   反映する。適用は1回のUndoで全体を取り消せる。
 */
import React, { useState } from 'react';
import { Route, Sparkles, Undo2, AlertTriangle } from 'lucide-react';
import LoadingSpinner from '../common/LoadingSpinner';
import { api as apiService } from '../../services/api';
import { usePlanStore } from '../../store/planStore';
import type { TravelPlan } from '../../types';
import type { OptimizationProposal } from '../../services/api';

interface OptimizationPanelProps {
  plan: TravelPlan;
  dayIndex: number;
  className?: string;
}

const OptimizationPanel: React.FC<OptimizationPanelProps> = ({ plan, dayIndex, className = '' }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoadingProposal, setIsLoadingProposal] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [proposal, setProposal] = useState<OptimizationProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const day = plan.days[dayIndex];

  const handleFetchProposal = async () => {
    if (!day) return;
    setIsLoadingProposal(true);
    setError(null);
    setProposal(null);
    try {
      const result = await apiService.getOptimizationProposal(plan.id, day.id);
      setProposal(result);
    } catch (e) {
      console.error('Optimization proposal error:', e);
      setError('提案の取得に失敗しました');
    } finally {
      setIsLoadingProposal(false);
    }
  };

  const handleApply = async () => {
    if (!day || !proposal) return;
    setIsApplying(true);
    setError(null);
    try {
      await apiService.applyOptimizationProposal(plan.id, day.id, proposal.proposed_order, proposal.base_revision);
      await usePlanStore.getState().loadPlan(plan.id);
      setProposal(null);
    } catch (e: any) {
      if (e?.response?.status === 409) {
        setError('他の変更と競合しました。もう一度提案を取得し直してください。');
      } else {
        setError('適用に失敗しました');
      }
      console.error('Apply optimization error:', e);
    } finally {
      setIsApplying(false);
    }
  };

  const handleUndo = async () => {
    await usePlanStore.getState().undoLastChange();
  };

  if (!day) return null;

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 ${className}`}>
      <button
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <span className="flex items-center gap-2 font-medium text-gray-900">
          <Route size={18} className="text-blue-500" />
          この日の経路を並べ替える
        </span>
        <span className="text-gray-400 text-sm">{isExpanded ? '閉じる' : '開く'}</span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-600">
            各地点の緯度経度から、移動距離が短くなる順序を近傍法で計算します
            (道路網は考慮しない直線距離ベースの概算です)。
          </p>

          {!proposal && (
            <button
              onClick={handleFetchProposal}
              disabled={isLoadingProposal}
              className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoadingProposal ? <LoadingSpinner size="sm" /> : <Sparkles size={16} />}
              並べ替え案を計算する
            </button>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {proposal && (
            <div className="space-y-3">
              {proposal.warnings.length > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3 space-y-1">
                  {proposal.warnings.map((w, i) => (
                    <p key={i}>⚠ {w}</p>
                  ))}
                </div>
              )}

              {proposal.has_improvement ? (
                <div className="text-sm bg-green-50 text-green-800 rounded-lg p-3">
                  <p className="font-medium">
                    移動距離を約{proposal.saved_distance_km}km
                    {proposal.saved_duration_minutes != null && `(約${Math.round(proposal.saved_duration_minutes)}分)`}
                    削減できる見込みです
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    {proposal.before_total_distance_km}km → {proposal.after_total_distance_km}km(概算)
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-500">現在の順序が既に効率的か、改善余地がありません。</p>
              )}

              {proposal.locked_event_ids.length > 0 && (
                <p className="text-xs text-gray-500">
                  ロック済みのイベント{proposal.locked_event_ids.length}件は位置を固定しています。
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleApply}
                  disabled={isApplying || !proposal.has_improvement}
                  className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isApplying ? <LoadingSpinner size="sm" /> : null}
                  この並び順を適用
                </button>
                <button
                  onClick={() => setProposal(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  却下
                </button>
              </div>

              <button
                onClick={handleUndo}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                <Undo2 size={14} />
                直前の変更を取り消す
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OptimizationPanel;
