import { useState, useCallback } from 'react';
import { api } from '../services/api';
import type { 
  OptimizationRequest,
  OptimizationResult,
  OptimizationJob,
  OptimizationHistory
} from '../types';

export const useOptimization = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimizationJob, setOptimizationJob] = useState<OptimizationJob | null>(null);
  const [optimizationHistory, setOptimizationHistory] = useState<OptimizationHistory[]>([]);

  // プラン最適化開始
  const startOptimization = useCallback(async (
    planId: string,
    request: OptimizationRequest
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post(`/travel/plans/${planId}/optimize`, request);
      const job = response.data.data;
      setOptimizationJob(job);
      
      // ポーリングで最適化結果を監視
      pollOptimizationResult(job.job_id);
      
      return job;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '最適化開始に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // 最適化結果のポーリング
  const pollOptimizationResult = useCallback(async (jobId: string) => {
    const pollInterval = 2000; // 2秒間隔
    const maxAttempts = 60; // 最大2分間
    let attempts = 0;

    const poll = async (): Promise<OptimizationResult | null> => {
      if (attempts >= maxAttempts) {
        setError('最適化がタイムアウトしました');
        return null;
      }

      try {
        const response = await api.get(`/travel/optimization/${jobId}`);
        const result = response.data.data;
        
        setOptimizationJob(prev => prev ? { ...prev, ...result } : null);

        if (result.status === 'completed') {
          setLoading(false);
          return result;
        } else if (result.status === 'failed') {
          setError('最適化に失敗しました');
          setLoading(false);
          return null;
        } else {
          // まだ処理中の場合、再帰的にポーリング
          attempts++;
          setTimeout(() => poll(), pollInterval);
        }
      } catch (err: any) {
        setError(err.response?.data?.error?.message || '最適化結果取得に失敗しました');
        setLoading(false);
        return null;
      }
      
      return null;
    };

    return poll();
  }, []);

  // 最適化結果取得
  const getOptimizationResult = useCallback(async (jobId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.get(`/travel/optimization/${jobId}`);
      const result = response.data.data;
      setOptimizationJob(result);
      return result;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '最適化結果取得に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // 基本最適化（時間効率重視）
  const optimizeForTime = useCallback(async (planId: string) => {
    const request: OptimizationRequest = {
      optimization_type: 'time_efficient',
      constraints: {
        max_travel_time_minutes: 60,
        accessibility_required: false
      },
      preferences: {
        prefer_public_transport: true,
        include_meal_breaks: true,
        walking_tolerance: 'medium',
        activity_pace: 'normal'
      }
    };

    return startOptimization(planId, request);
  }, [startOptimization]);

  // コスト重視最適化
  const optimizeForCost = useCallback(async (planId: string, budgetLimit?: number) => {
    const request: OptimizationRequest = {
      optimization_type: 'cost_effective',
      constraints: {
        budget_limit: budgetLimit,
        avoid_crowds: false,
        accessibility_required: false
      },
      preferences: {
        prefer_public_transport: true,
        include_meal_breaks: true,
        walking_tolerance: 'high',
        activity_pace: 'relaxed'
      }
    };

    return startOptimization(planId, request);
  }, [startOptimization]);

  // バランス重視最適化
  const optimizeBalanced = useCallback(async (planId: string) => {
    const request: OptimizationRequest = {
      optimization_type: 'balanced',
      constraints: {
        max_travel_time_minutes: 45,
        avoid_crowds: true,
        accessibility_required: false
      },
      preferences: {
        prefer_public_transport: true,
        include_meal_breaks: true,
        walking_tolerance: 'medium',
        activity_pace: 'normal'
      }
    };

    return startOptimization(planId, request);
  }, [startOptimization]);

  // カスタム最適化
  const optimizeCustom = useCallback(async (
    planId: string,
    customRequest: OptimizationRequest
  ) => {
    return startOptimization(planId, customRequest);
  }, [startOptimization]);

  // 最適化履歴取得
  const getOptimizationHistory = useCallback(async (planId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      // TODO: 最適化履歴取得APIがあれば実装
      // 現在は仮の実装
      const history: OptimizationHistory[] = JSON.parse(
        localStorage.getItem(`optimization_history_${planId}`) || '[]'
      );
      setOptimizationHistory(history);
      return history;
    } catch (err: any) {
      setError('最適化履歴取得に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // 最適化履歴に追加
  const addToOptimizationHistory = useCallback((
    planId: string,
    optimization: OptimizationResult
  ) => {
    const historyItem: OptimizationHistory = {
      id: optimization.job_id,
      planId,
      optimizationType: optimization.original_plan ? 'automatic' : 'manual',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      status: optimization.status,
      improvements: optimization.result?.improvements,
      userAccepted: false
    };

    const history = JSON.parse(
      localStorage.getItem(`optimization_history_${planId}`) || '[]'
    );
    
    const updatedHistory = [historyItem, ...history].slice(0, 10); // 最新10件のみ保持
    localStorage.setItem(`optimization_history_${planId}`, JSON.stringify(updatedHistory));
    setOptimizationHistory(updatedHistory);
  }, []);

  // 最適化結果の比較
  const compareOptimizations = useCallback((
    original: OptimizationResult,
    optimized: OptimizationResult
  ) => {
    if (!original.result || !optimized.result) {
      return null;
    }

    const originalPlan = original.result.original_plan;
    const optimizedPlan = optimized.result.optimized_plan;

    return {
      timeSaved: originalPlan.total_travel_time_minutes - optimizedPlan.total_travel_time_minutes,
      costSaved: originalPlan.total_cost - optimizedPlan.total_cost,
      distanceSaved: originalPlan.total_distance_km - optimizedPlan.total_distance_km,
      efficiencyImprovement: optimized.result.improvements.efficiency_score - 
                            (original.result.improvements?.efficiency_score || 0)
    };
  }, []);

  // 最適化提案の自動生成
  const generateOptimizationSuggestions = useCallback(async (planId: string) => {
    setLoading(true);
    setError(null);
    
    try {
      // プランの分析結果に基づいて最適化提案を生成
      const suggestions = [
        {
          type: 'time_optimization',
          title: '移動時間最適化',
          description: '移動ルートを最適化して約30分の時間短縮が可能です',
          estimatedImprovement: '30分の時間短縮',
          confidence: 0.85
        },
        {
          type: 'cost_optimization', 
          title: 'コスト削減',
          description: '交通手段を見直して約1,200円のコスト削減が可能です',
          estimatedImprovement: '1,200円の節約',
          confidence: 0.78
        },
        {
          type: 'crowd_avoidance',
          title: '混雑回避',
          description: '訪問時間を調整して混雑を避けることができます',
          estimatedImprovement: '混雑レベル50%減少',
          confidence: 0.72
        }
      ];

      return suggestions;
    } catch (err: any) {
      setError('最適化提案生成に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // 最適化のキャンセル
  const cancelOptimization = useCallback((jobId: string) => {
    setOptimizationJob(null);
    setLoading(false);
    // TODO: バックエンドにキャンセル要求を送信
  }, []);

  // 最適化状態のリセット
  const resetOptimization = useCallback(() => {
    setOptimizationJob(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    loading,
    error,
    optimizationJob,
    optimizationHistory,
    startOptimization,
    getOptimizationResult,
    optimizeForTime,
    optimizeForCost,
    optimizeBalanced,
    optimizeCustom,
    getOptimizationHistory,
    addToOptimizationHistory,
    compareOptimizations,
    generateOptimizationSuggestions,
    cancelOptimization,
    resetOptimization,
    clearError: () => setError(null),
    
    // 便利なgetters
    isOptimizing: loading && !!optimizationJob,
    optimizationProgress: optimizationJob?.progress || 0,
    optimizationStatus: optimizationJob?.status || 'idle'
  };
};