import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Zap, Settings, Clock, DollarSign, MapPin, 
  Sparkles, CheckCircle, RefreshCw, 
  Target, Route
} from 'lucide-react';
import LoadingSpinner from '../common/LoadingSpinner';
import { optimizationAPI, type OptimizationRequest } from '../../services/api';
import type { TravelPlan } from '../../types';

interface OptimizationPanelProps {
  plan: TravelPlan;
  onOptimizationStart?: (jobId: string) => void;
  onOptimizationComplete?: (result: any) => void;
  className?: string;
}

interface OptimizationSettings {
  type: 'time_efficient' | 'cost_effective' | 'balanced' | 'eco_friendly';
  constraints: {
    max_travel_time_minutes?: number;
    budget_limit?: number;
    avoid_crowds: boolean;
    accessibility_required: boolean;
  };
  preferences: {
    prefer_public_transport: boolean;
    include_meal_breaks: boolean;
    walking_tolerance: 'low' | 'medium' | 'high';
    activity_pace: 'rushed' | 'normal' | 'relaxed';
    weather_consideration: boolean;
  };
}

const OptimizationPanel: React.FC<OptimizationPanelProps> = ({
  plan,
  onOptimizationStart,
  onOptimizationComplete,
  className = ''
}) => {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [settings, setSettings] = useState<OptimizationSettings>({
    type: 'balanced',
    constraints: {
      avoid_crowds: false,
      accessibility_required: false
    },
    preferences: {
      prefer_public_transport: true,
      include_meal_breaks: true,
      walking_tolerance: 'medium',
      activity_pace: 'normal',
      weather_consideration: true
    }
  });
  
  const [quickOptimizationResult, setQuickOptimizationResult] = useState<any>(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // プランの現在の統計を計算
  const currentStats = React.useMemo(() => {
    const totalEvents = plan.days.reduce((sum, day) => sum + day.events.length, 0);
    const totalDuration = plan.days.reduce(
      (sum, day) => sum + day.events.reduce((s, e) => s + (e.duration ?? 0), 0),
      0
    );
    const totalCost = plan.days.reduce(
      (sum, day) => sum + day.events.reduce((s, e) => s + (e.cost ?? 0), 0),
      0
    );
    const totalDistance = plan.days.reduce(
      (sum, day) => sum + day.events.reduce((s, e) => s + (e.travel_time ?? 0), 0),
      0
    );
    
    return {
      totalEvents,
      totalDuration,
      totalCost,
      totalDistance,
      efficiency: calculateEfficiency(totalEvents, totalDuration, totalDistance)
    };
  }, [plan]);

  const calculateEfficiency = (events: number, duration: number, distance: number): number => {
    if (events === 0 || duration === 0) return 0;
    // 簡単な効率性計算（実際にはより複雑なアルゴリズム）
    const timePerEvent = duration / events;
    const distancePerEvent = distance / events;
    return Math.min(100, Math.max(0, 100 - (timePerEvent / 60) - (distancePerEvent / 5)));
  };

  const formatTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}時間${mins}分` : `${mins}分`;
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getOptimizationTypeIcon = (type: string) => {
    switch (type) {
      case 'time_efficient': return <Clock size={16} className="text-blue-500" />;
      case 'cost_effective': return <DollarSign size={16} className="text-green-500" />;
      case 'balanced': return <Target size={16} className="text-purple-500" />;
      case 'eco_friendly': return <MapPin size={16} className="text-emerald-500" />;
      default: return <Zap size={16} className="text-orange-500" />;
    }
  };

  const getEfficiencyColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    if (score >= 40) return 'text-orange-500';
    return 'text-red-500';
  };

  const getEfficiencyBadge = (score: number) => {
    if (score >= 80) return '優秀';
    if (score >= 60) return '良好';
    if (score >= 40) return '普通';
    return '要改善';
  };

  const handleQuickOptimization = async () => {
    setIsOptimizing(true);
    try {
      const optimizationRequest: OptimizationRequest = {
        preferences: {
          transportation: settings.preferences.prefer_public_transport ? 'public_transport' : 'any',
          budget_level: settings.constraints.budget_limit ? 'limited' : 'flexible',
          pace: settings.preferences.activity_pace,
        },
        constraints: settings.constraints,
      };

      const response = await optimizationAPI.optimizePlan(plan.id, optimizationRequest);
      const jobId = response.data.job_id;

      setQuickOptimizationResult(response.data);
      onOptimizationStart?.(jobId);
      onOptimizationComplete?.(response.data);
      
      // 結果ページに遷移
      setTimeout(() => {
        navigate(`/optimization/${jobId}`);
      }, 2000);
      
    } catch (error) {
      console.error('最適化エラー:', error);
    } finally {
      setIsOptimizing(false);
    }
  };

  const getPotentialImprovements = () => {
    // 簡単な改善ポテンシャル計算
    const improvements = [];
    
    if (currentStats.efficiency < 70) {
      improvements.push({
        type: 'route',
        icon: <Route size={16} className="text-blue-500" />,
        title: 'ルート最適化',
        description: '移動経路を最適化して時間短縮',
        potential: '15-30分短縮'
      });
    }
    
    if (currentStats.totalCost > 0) {
      improvements.push({
        type: 'cost',
        icon: <DollarSign size={16} className="text-green-500" />,
        title: 'コスト削減',
        description: '代替ルートでコスト削減',
        potential: '10-20%削減'
      });
    }
    
    improvements.push({
      type: 'timing',
      icon: <Clock size={16} className="text-purple-500" />,
      title: '時間配分調整',
      description: '各スポットの滞在時間を最適化',
      potential: '効率性向上'
    });
    
    return improvements;
  };

  return (
    <div className={`bg-white border border-gray-200 rounded-xl shadow-sm ${className}`}>
      {/* ヘッダー */}
      <div 
        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">AI最適化</h3>
              <p className="text-sm text-gray-600">プランを自動最適化</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* 効率性スコア */}
            <div className="text-right">
              <div className={`text-lg font-bold ${getEfficiencyColor(currentStats.efficiency)}`}>
                {Math.round(currentStats.efficiency)}%
              </div>
              <div className="text-xs text-gray-500">
                {getEfficiencyBadge(currentStats.efficiency)}
              </div>
            </div>
            
            <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
              <Settings size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 展開コンテンツ */}
      {isExpanded && (
        <div className="border-t border-gray-200">
          {/* 現在の統計 */}
          <div className="p-4 bg-gray-50">
            <h4 className="font-medium text-gray-900 mb-3">現在のプラン統計</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">
                  {currentStats.totalEvents}
                </div>
                <div className="text-xs text-gray-600">スポット数</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">
                  {formatTime(currentStats.totalDuration)}
                </div>
                <div className="text-xs text-gray-600">総所要時間</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-purple-600">
                  {formatCurrency(currentStats.totalCost)}
                </div>
                <div className="text-xs text-gray-600">総費用</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-orange-600">
                  {currentStats.totalDistance.toFixed(1)}km
                </div>
                <div className="text-xs text-gray-600">総距離</div>
              </div>
            </div>
          </div>

          {/* 最適化タイプ選択 */}
          <div className="p-4">
            <h4 className="font-medium text-gray-900 mb-3">最適化タイプ</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { type: 'time_efficient', name: '時間重視', desc: '移動時間を最小化' },
                { type: 'cost_effective', name: 'コスト重視', desc: '費用を最小化' },
                { type: 'balanced', name: 'バランス', desc: '総合的に最適化' },
                { type: 'eco_friendly', name: '環境配慮', desc: 'CO2排出量を削減' }
              ].map((option) => (
                <button
                  key={option.type}
                  onClick={() => setSettings({ ...settings, type: option.type as any })}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    settings.type === option.type
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {getOptimizationTypeIcon(option.type)}
                    <span className="font-medium text-sm">{option.name}</span>
                  </div>
                  <p className="text-xs text-gray-600">{option.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 改善ポテンシャル */}
          <div className="p-4 border-t border-gray-200">
            <h4 className="font-medium text-gray-900 mb-3">期待される改善</h4>
            <div className="space-y-2">
              {getPotentialImprovements().map((improvement, index) => (
                <div key={index} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                  {improvement.icon}
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-900">
                      {improvement.title}
                    </div>
                    <div className="text-xs text-gray-600">
                      {improvement.description}
                    </div>
                  </div>
                  <div className="text-xs font-medium text-green-600">
                    {improvement.potential}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 高度な設定 */}
          {showAdvancedSettings && (
            <div className="p-4 border-t border-gray-200 bg-gray-50">
              <h4 className="font-medium text-gray-900 mb-3">詳細設定</h4>
              
              <div className="space-y-4">
                {/* 制約条件 */}
                <div>
                  <h5 className="text-sm font-medium text-gray-700 mb-2">制約条件</h5>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-600">最大移動時間（分）</label>
                      <input
                        type="number"
                        value={settings.constraints.max_travel_time_minutes || ''}
                        onChange={(e) => setSettings({
                          ...settings,
                          constraints: {
                            ...settings.constraints,
                            max_travel_time_minutes: parseInt(e.target.value) || undefined
                          }
                        })}
                        className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                        placeholder="60"
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-600">予算上限</label>
                      <input
                        type="number"
                        value={settings.constraints.budget_limit || ''}
                        onChange={(e) => setSettings({
                          ...settings,
                          constraints: {
                            ...settings.constraints,
                            budget_limit: parseInt(e.target.value) || undefined
                          }
                        })}
                        className="w-24 px-2 py-1 text-sm border border-gray-300 rounded"
                        placeholder="10000"
                      />
                    </div>
                    
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={settings.constraints.avoid_crowds}
                        onChange={(e) => setSettings({
                          ...settings,
                          constraints: {
                            ...settings.constraints,
                            avoid_crowds: e.target.checked
                          }
                        })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="text-sm text-gray-600">混雑を避ける</span>
                    </label>
                    
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={settings.constraints.accessibility_required}
                        onChange={(e) => setSettings({
                          ...settings,
                          constraints: {
                            ...settings.constraints,
                            accessibility_required: e.target.checked
                          }
                        })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="text-sm text-gray-600">バリアフリー必須</span>
                    </label>
                  </div>
                </div>

                {/* 設定項目 */}
                <div>
                  <h5 className="text-sm font-medium text-gray-700 mb-2">基本設定</h5>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={settings.preferences.prefer_public_transport}
                        onChange={(e) => setSettings({
                          ...settings,
                          preferences: {
                            ...settings.preferences,
                            prefer_public_transport: e.target.checked
                          }
                        })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="text-sm text-gray-600">公共交通機関を優先</span>
                    </label>
                    
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={settings.preferences.include_meal_breaks}
                        onChange={(e) => setSettings({
                          ...settings,
                          preferences: {
                            ...settings.preferences,
                            include_meal_breaks: e.target.checked
                          }
                        })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="text-sm text-gray-600">食事時間を含める</span>
                    </label>
                    
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-600">徒歩許容度</label>
                      <select
                        value={settings.preferences.walking_tolerance}
                        onChange={(e) => setSettings({
                          ...settings,
                          preferences: {
                            ...settings.preferences,
                            walking_tolerance: e.target.value as any
                          }
                        })}
                        className="text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 高度設定切り替え */}
          <div className="p-4 border-t border-gray-200">
            <button
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
            >
              <Settings size={14} />
              {showAdvancedSettings ? '詳細設定を閉じる' : '詳細設定を表示'}
            </button>
          </div>

          {/* アクションボタン */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex gap-3">
              <button
                onClick={handleQuickOptimization}
                disabled={isOptimizing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-lg hover:from-purple-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isOptimizing ? (
                  <>
                    <LoadingSpinner size="small" />
                    最適化中...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    AI最適化を実行
                  </>
                )}
              </button>
              
              <button className="px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                <RefreshCw size={18} />
              </button>
            </div>
            
            {quickOptimizationResult && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={16} className="text-green-500" />
                  <span className="text-sm font-medium text-green-800">
                    最適化を開始しました
                  </span>
                </div>
                <div className="text-sm text-green-700">
                  予想改善: {quickOptimizationResult.time_saved_minutes}分短縮、
                  {formatCurrency(quickOptimizationResult.cost_saved)}節約
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OptimizationPanel;