/**
 * AdminDashboard - 管理者ダッシュボードページ
 * システム統計を表示(実データのみ)
 *
 * [Gate #24] 以前はレート制限統計・パフォーマンス統計・セキュリティ統計
 * (失敗ログイン数、不審なアクティビティ数等)を表示する作りだったが、
 * これらは現在のインフラで一切追跡しておらず、常にAPI未到達(admin.pyが
 * main.pyにinclude_routerされていなかった)の状態だった。バックエンドが
 * 実際に返せる情報(ユーザー統計・プラン統計)のみに縮小する。
 * クイックアクションも、実際に存在するルート(/admin/users)のみ残す。
 */

import React from 'react';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { useAuthStore } from '../../store/authStore';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';

interface SystemStats {
  users: {
    total_users: number;
    active_users: number;
    verified_users: number;
    new_users_30d: number;
    user_types: {
      guest: number;
      registered: number;
      premium: number;
      admin: number;
    };
  };
  travel_plans: {
    total_plans: number;
    active_plans: number;
    completed_plans: number;
    draft_plans: number;
    average_duration_days: number;
    popular_destinations: Array<{
      destination: string;
      count: number;
    }>;
  };
  timestamp: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: string;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'gray';
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, subtitle, icon, color }) => {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    green: 'bg-green-50 border-green-200 text-green-800',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    red: 'bg-red-50 border-red-200 text-red-800',
    purple: 'bg-purple-50 border-purple-200 text-purple-800',
    gray: 'bg-gray-50 border-gray-200 text-gray-800',
  };

  return (
    <Card className={`p-6 ${colorClasses[color]}`}>
      <div className="flex items-center space-x-3">
        <div className="text-2xl">{icon}</div>
        <div>
          <p className="text-sm font-medium opacity-75">{title}</p>
          <p className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
          {subtitle && <p className="text-sm opacity-60">{subtitle}</p>}
        </div>
      </div>
    </Card>
  );
};

const AdminDashboard: React.FC = () => {
  const [stats, setStats] = React.useState<SystemStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [lastRefresh, setLastRefresh] = React.useState<Date>(new Date());

  const { user } = useAuthStore();
  const navigate = useNavigate();

  // 権限チェック
  React.useEffect(() => {
    if (user?.user_type !== 'admin') {
      toast.error('管理者権限が必要です');
      navigate('/');
    }
  }, [user, navigate]);

  // システム統計の取得
  const fetchStats = React.useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const response = await api.get('/admin/stats/system');
      setStats(response.data);
      setLastRefresh(new Date());

      if (isRefresh) {
        toast.success('統計データを更新しました');
      }
    } catch (error) {
      console.error('Failed to fetch system stats:', error);
      toast.error('統計データの取得に失敗しました');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">統計データを取得できませんでした</p>
        <Button onClick={() => fetchStats()} className="mt-4">
          再試行
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">管理者ダッシュボード</h1>
          <p className="text-gray-600 mt-1">最終更新: {lastRefresh.toLocaleString('ja-JP')}</p>
        </div>
        <Button onClick={() => fetchStats(true)} disabled={refreshing} variant="outline">
          {refreshing ? (
            <>
              <LoadingSpinner size="sm" className="mr-2" />
              更新中...
            </>
          ) : (
            <>🔄 更新</>
          )}
        </Button>
      </div>

      {/* ユーザー統計 */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">👥 ユーザー統計</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="総ユーザー数"
            value={stats.users.total_users}
            subtitle={`内 認証済み: ${stats.users.verified_users}名`}
            icon="👤"
            color="blue"
          />
          <MetricCard
            title="アクティブユーザー"
            value={stats.users.active_users}
            subtitle="is_active=trueのユーザー数"
            icon="✨"
            color="green"
          />
          <MetricCard
            title="新規登録"
            value={stats.users.new_users_30d}
            subtitle="過去30日間"
            icon="🆕"
            color="purple"
          />
          <MetricCard
            title="管理者ユーザー"
            value={stats.users.user_types.admin}
            subtitle="user_type=adminの人数"
            icon="🛡️"
            color="yellow"
          />
        </div>
      </div>

      {/* プラン統計 */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">📋 プラン統計</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard title="総プラン数" value={stats.travel_plans.total_plans} icon="📊" color="blue" />
          <MetricCard title="アクティブプラン" value={stats.travel_plans.active_plans} icon="🔥" color="green" />
          <MetricCard title="完了プラン" value={stats.travel_plans.completed_plans} icon="✅" color="purple" />
          <MetricCard
            title="平均日数"
            value={`${stats.travel_plans.average_duration_days.toFixed(1)}日`}
            subtitle="開始日・終了日が両方設定されているプランのみ集計"
            icon="📅"
            color="gray"
          />
        </div>
      </div>

      {/* 人気デスティネーション */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">🌍 人気デスティネーション</h3>
        {stats.travel_plans.popular_destinations.length === 0 ? (
          <p className="text-sm text-gray-500">デスティネーションが設定されたプランがまだありません</p>
        ) : (
          <div className="space-y-3">
            {stats.travel_plans.popular_destinations.map((dest, index) => (
              <div key={dest.destination} className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-600 rounded-full text-sm font-medium">
                    {index + 1}
                  </span>
                  <span className="font-medium">{dest.destination}</span>
                </div>
                <span className="text-gray-600">{dest.count} プラン</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* クイックアクション */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">⚡ クイックアクション</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Button
            onClick={() => navigate('/admin/users')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2">👥</span>
            <span className="text-sm">ユーザー管理</span>
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default AdminDashboard;
