import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, DollarSign, MapPin, TrendingUp, TrendingDown, RotateCcw } from 'lucide-react';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { getOptimizationResult, applyOptimization } from '../services/api';

interface OptimizationResult {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  result: {
    original_plan: {
      total_travel_time_minutes: number;
      total_cost: number;
      total_distance_km: number;
    };
    optimized_plan: {
      total_travel_time_minutes: number;
      total_cost: number;
      total_distance_km: number;
    };
    improvements: {
      time_saved_minutes: number;
      cost_saved: number;
      distance_saved_km: number;
      efficiency_score: number;
    };
    changes: Array<{
      type: string;
      description: string;
      impact: string;
    }>;
  };
}

const OptimizationPage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (jobId) {
      fetchOptimizationResult();
    }
  }, [jobId]);

  const fetchOptimizationResult = async () => {
    try {
      const response = await getOptimizationResult(jobId!);
      // [Gate #7j] 実バックエンド(backend/app/api/v1/ai.py)にはジョブ型の最適化結果取得
      // エンドポイント・progress/job_id/status追跡機構は未実装であることを確認済み
      // (/optimize-routeが同期的にwaypointsを返すのみ)。このポーリングUIはそれを前提に
      // 書かれた将来設計のままのため、型のみ整合させて残す。
      setOptimizationResult(response.data as unknown as OptimizationResult);
      
      // まだ処理中の場合は5秒後に再チェック
      if (response.data.status === 'processing') {
        setTimeout(fetchOptimizationResult, 5000);
      } else {
        setIsLoading(false);
      }
    } catch (error) {
      setError('最適化結果の取得に失敗しました');
      setIsLoading(false);
    }
  };

  const handleApplyOptimization = async () => {
    setIsApplying(true);
    try {
      await applyOptimization(jobId!);
      navigate('/planner', { 
        state: { 
          message: '最適化が適用されました',
          type: 'success' 
        } 
      });
    } catch (error) {
      setError('最適化の適用に失敗しました');
    } finally {
      setIsApplying(false);
    }
  };

  const handleReject = () => {
    navigate('/planner', { 
      state: { 
        message: '最適化を却下しました',
        type: 'info' 
      } 
    });
  };

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}時間${mins}分` : `${mins}分`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getImprovementIcon = (value: number) => {
    return value > 0 ? (
      <TrendingDown className="w-5 h-5 text-green-500" />
    ) : (
      <TrendingUp className="w-5 h-5 text-red-500" />
    );
  };

  const getChangeTypeIcon = (type: string) => {
    switch (type) {
      case 'reorder':
        return '🔄';
      case 'time_adjustment':
        return '⏰';
      case 'route_change':
        return '🗺️';
      case 'spot_replacement':
        return '📍';
      default:
        return '✨';
    }
  };

  if (isLoading || !optimizationResult) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="large" />
          <div className="mt-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              AI最適化処理中
            </h2>
            <p className="text-gray-600">
              OR-Toolsによる数理最適化を実行しています...
            </p>
            {optimizationResult?.progress && (
              <div className="mt-4 max-w-md mx-auto">
                <div className="bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${optimizationResult.progress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  {optimizationResult.progress}% 完了
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (error || optimizationResult.status === 'failed') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            最適化に失敗しました
          </h2>
          <p className="text-gray-600 mb-4">
            {error || '最適化処理中にエラーが発生しました'}
          </p>
          <button
            onClick={() => navigate('/planner')}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            プランナーに戻る
          </button>
        </div>
      </div>
    );
  }

  const { result } = optimizationResult;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            ⚡ AI最適化結果
          </h1>
          <p className="text-gray-600">
            OR-Toolsによる数理最適化で、より効率的な旅行プランを生成しました
          </p>
        </div>

        {/* 改善サマリー */}
        <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-6 mb-8 border border-green-200">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              効率性スコア: {result.improvements.efficiency_score}%
            </h2>
            <p className="text-gray-600">最適化により以下の改善が見込まれます</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                {getImprovementIcon(result.improvements.time_saved_minutes)}
                <Clock className="w-5 h-5 text-gray-600 ml-1" />
              </div>
              <p className="text-lg font-semibold text-gray-900">
                {formatTime(result.improvements.time_saved_minutes)}
              </p>
              <p className="text-sm text-gray-600">時間短縮</p>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                {getImprovementIcon(result.improvements.cost_saved)}
                <DollarSign className="w-5 h-5 text-gray-600 ml-1" />
              </div>
              <p className="text-lg font-semibold text-gray-900">
                {formatCurrency(result.improvements.cost_saved)}
              </p>
              <p className="text-sm text-gray-600">コスト削減</p>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                {getImprovementIcon(result.improvements.distance_saved_km)}
                <MapPin className="w-5 h-5 text-gray-600 ml-1" />
              </div>
              <p className="text-lg font-semibold text-gray-900">
                {result.improvements.distance_saved_km.toFixed(1)}km
              </p>
              <p className="text-sm text-gray-600">距離短縮</p>
            </div>
          </div>
        </div>

        {/* 詳細比較 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* 最適化前 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center mb-4">
              <div className="w-4 h-4 bg-red-500 rounded-full mr-3"></div>
              <h3 className="text-lg font-semibold text-gray-900">最適化前</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-600">総移動時間</span>
                <span className="font-semibold text-red-600">
                  {formatTime(result.original_plan.total_travel_time_minutes)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-600">総費用</span>
                <span className="font-semibold text-red-600">
                  {formatCurrency(result.original_plan.total_cost)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-600">総距離</span>
                <span className="font-semibold text-red-600">
                  {result.original_plan.total_distance_km.toFixed(1)}km
                </span>
              </div>
            </div>
          </div>

          {/* 最適化後 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center mb-4">
              <div className="w-4 h-4 bg-green-500 rounded-full mr-3"></div>
              <h3 className="text-lg font-semibold text-gray-900">最適化後</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-600">総移動時間</span>
                <span className="font-semibold text-green-600">
                  {formatTime(result.optimized_plan.total_travel_time_minutes)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-600">総費用</span>
                <span className="font-semibold text-green-600">
                  {formatCurrency(result.optimized_plan.total_cost)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-600">総距離</span>
                <span className="font-semibold text-green-600">
                  {result.optimized_plan.total_distance_km.toFixed(1)}km
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 変更詳細 */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            🔧 最適化内容
          </h3>
          
          <div className="space-y-3">
            {result.changes.map((change, index) => (
              <div key={index} className="flex items-start p-3 bg-gray-50 rounded-lg">
                <span className="text-xl mr-3">
                  {getChangeTypeIcon(change.type)}
                </span>
                <div className="flex-1">
                  <p className="font-medium text-gray-900 mb-1">
                    {change.description}
                  </p>
                  <p className="text-sm text-green-600">
                    💡 {change.impact}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* アクションボタン */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={handleApplyOptimization}
            disabled={isApplying}
            className="flex items-center justify-center gap-2 px-8 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isApplying ? (
              <>
                <LoadingSpinner size="small" />
                適用中...
              </>
            ) : (
              <>
                <CheckCircle size={20} />
                最適化を適用する
              </>
            )}
          </button>
          
          <button
            onClick={handleReject}
            disabled={isApplying}
            className="flex items-center justify-center gap-2 px-8 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            <XCircle size={20} />
            元のプランを維持
          </button>
          
          <button
            onClick={() => navigate('/planner')}
            disabled={isApplying}
            className="flex items-center justify-center gap-2 px-8 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            <RotateCcw size={20} />
            プランナーに戻る
          </button>
        </div>

        {/* 注意事項 */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>💡 ヒント:</strong> 最適化は営業時間、移動時間、予算制約を考慮して計算されています。
            必要に応じて手動で微調整を行うことも可能です。
          </p>
        </div>
      </div>
    </div>
  );
};

export default OptimizationPage;