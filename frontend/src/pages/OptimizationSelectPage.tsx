/**
 * [Gate #27 / A-008系] /optimization (jobIdなし)は、以前は
 * 「AI最適化機能は開発中です」という固定文言のみを表示する画面だった。
 * 実際にはGate #23でAI最適化(近傍法による経路並べ替え)自体は実装済みで
 * あり、OptimizationPanel経由でplanごとに実行できる状態だったため、この
 * 画面のリンクは実際の機能へ到達できない偽の行き止まりになっていた。
 *
 * 本画面は、ログイン中ユーザーの旅行プラン一覧を取得し、プランを選択して
 * プランナー画面へ遷移する(実際の最適化実行はプランナー内の
 * OptimizationPanelから行う)実画面に置き換える。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { api } from '../services/api';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import Button from '../components/common/Button';

interface PlanSummary {
  id: string;
  title: string;
  destination?: string;
  start_date?: string;
  end_date?: string;
}

const OptimizationSelectPage: React.FC = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await api.getPlans();
        if (!cancelled) {
          setPlans((response.data ?? []) as PlanSummary[]);
        }
      } catch (e) {
        if (!cancelled) {
          setError('旅行プランの取得に失敗しました');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Sparkles className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">AI最適化</h1>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {!error && plans.length === 0 && (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-600 mb-4">
              最適化できる旅行プランがまだありません。まずはプランを作成してください。
            </p>
            <Button onClick={() => navigate('/planner')}>プランを作成する</Button>
          </div>
        )}

        {!error && plans.length > 0 && (
          <>
            <p className="text-gray-600 mb-4">
              最適化するプランを選択してください。実行はプラン編集画面内の
              「AI最適化」パネルから行います。
            </p>
            <div className="space-y-3">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => navigate(`/planner/${plan.id}`)}
                  className="w-full flex items-center justify-between bg-white rounded-lg shadow p-4 text-left hover:shadow-md transition-shadow"
                >
                  <div>
                    <p className="font-semibold text-gray-900">{plan.title}</p>
                    {plan.destination && (
                      <p className="text-sm text-gray-500">{plan.destination}</p>
                    )}
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default OptimizationSelectPage;
