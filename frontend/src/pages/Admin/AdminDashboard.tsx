/**
 * AdminDashboard - 管理者ダッシュボードページ
 * システム統計、ユーザー分析、セキュリティ監視を表示
 */

import React from 'react';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { useAuthStore } from '../../store/authStore';
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
  rate_limits: {
    requests_per_minute: number;
    rate_limit_hits_24h: number;
    top_limited_endpoints: Array<{
      endpoint: string;
      hits: number;
    }>;
  };
  performance: {
    avg_response_time_ms: number;
    requests_per_minute: number;
    error_rate_percent: number;
    uptime_percent: number;
  };
  security: {
    failed_login_attempts_24h: number;
    suspicious_activities_24h: number;
    blocked_ips_count: number;
  };
  timestamp: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  icon: string;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'gray';
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  trend,
  icon,
  color
}) => {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    green: 'bg-green-50 border-green-200 text-green-800',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    red: 'bg-red-50 border-red-200 text-red-800',
    purple: 'bg-purple-50 border-purple-200 text-purple-800',
    gray: 'bg-gray-50 border-gray-200 text-gray-800'
  };

  return (
    <Card className={`p-6 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="text-2xl">{icon}</div>
          <div>
            <p className="text-sm font-medium opacity-75">{title}</p>
            <p className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
            {subtitle && (
              <p className="text-sm opacity-60">{subtitle}</p>
            )}
          </div>
        </div>
        {trend && (
          <div className={`flex items-center text-sm font-medium ${
            trend.isPositive ? 'text-green-600' : 'text-red-600'
          }`}>
            <span className="mr-1">
              {trend.isPositive ? '↗️' : '↘️'}
            </span>
            {Math.abs(trend.value)}%
          </div>
        )}
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

  // 権限チェック
  React.useEffect(() => {
    if (user?.user_type !== 'admin') {
      toast.error('管理者権限が必要です');
      window.location.href = '/';
    }
  }, [user]);

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

  // 初期データ取得
  React.useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // 自動更新（5分間隔）
  React.useEffect(() => {
    const interval = setInterval(() => {
      fetchStats(true);
    }, 5 * 60 * 1000); // 5分

    return () => clearInterval(interval);
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
          <p className="text-gray-600 mt-1">
            最終更新: {lastRefresh.toLocaleString('ja-JP')}
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Button
            onClick={() => fetchStats(true)}
            disabled={refreshing}
            variant="outline"
          >
            {refreshing ? (
              <>
                <LoadingSpinner size="sm" className="mr-2" />
                更新中...
              </>
            ) : (
              <>
                🔄 更新
              </>
            )}
          </Button>
          <Button
            onClick={() => window.open('/admin/settings', '_blank')}
            variant="primary"
          >
            ⚙️ システム設定
          </Button>
        </div>
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
            subtitle="過去30日間"
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
            title="ゲストユーザー"
            value={stats.users.user_types.guest}
            subtitle="現在アクティブ"
            icon="🎯"
            color="yellow"
          />
        </div>
      </div>

      {/* プラン統計 */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">📋 プラン統計</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="総プラン数"
            value={stats.travel_plans.total_plans}
            icon="📊"
            color="blue"
          />
          <MetricCard
            title="アクティブプラン"
            value={stats.travel_plans.active_plans}
            icon="🔥"
            color="green"
          />
          <MetricCard
            title="完了プラン"
            value={stats.travel_plans.completed_plans}
            icon="✅"
            color="purple"
          />
          <MetricCard
            title="平均日数"
            value={`${stats.travel_plans.average_duration_days.toFixed(1)}日`}
            icon="📅"
            color="gray"
          />
        </div>
      </div>

      {/* パフォーマンス統計 */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">⚡ パフォーマンス</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="平均レスポンス時間"
            value={`${stats.performance.avg_response_time_ms}ms`}
            icon="🕐"
            color={stats.performance.avg_response_time_ms > 1000 ? 'red' : 'green'}
          />
          <MetricCard
            title="リクエスト/分"
            value={stats.performance.requests_per_minute}
            icon="📈"
            color="blue"
          />
          <MetricCard
            title="エラー率"
            value={`${stats.performance.error_rate_percent.toFixed(2)}%`}
            icon="⚠️"
            color={stats.performance.error_rate_percent > 1 ? 'red' : 'green'}
          />
          <MetricCard
            title="稼働率"
            value={`${stats.performance.uptime_percent.toFixed(2)}%`}
            icon="🟢"
            color={stats.performance.uptime_percent < 99.5 ? 'yellow' : 'green'}
          />
        </div>
      </div>

      {/* セキュリティ統計 */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">🔒 セキュリティ</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            title="ログイン失敗"
            value={stats.security.failed_login_attempts_24h}
            subtitle="過去24時間"
            icon="🚫"
            color={stats.security.failed_login_attempts_24h > 50 ? 'red' : 'green'}
          />
          <MetricCard
            title="不審なアクティビティ"
            value={stats.security.suspicious_activities_24h}
            subtitle="過去24時間"
            icon="🚨"
            color={stats.security.suspicious_activities_24h > 10 ? 'red' : 'green'}
          />
          <MetricCard
            title="ブロック済みIP"
            value={stats.security.blocked_ips_count}
            icon="🛡️"
            color="gray"
          />
        </div>
      </div>

      {/* 人気デスティネーション */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            🌍 人気デスティネーション
          </h3>
          <div className="space-y-3">
            {stats.travel_plans.popular_destinations.slice(0, 5).map((dest, index) => (
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
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            🚦 レート制限状況
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span>現在のリクエスト/分</span>
              <span className="font-mono text-lg">
                {stats.rate_limits.requests_per_minute}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>制限ヒット数（24時間）</span>
              <span className={`font-mono text-lg ${
                stats.rate_limits.rate_limit_hits_24h > 100 ? 'text-red-600' : 'text-green-600'
              }`}>
                {stats.rate_limits.rate_limit_hits_24h}
              </span>
            </div>
            {stats.rate_limits.top_limited_endpoints.length > 0 && (
              <div>
                <p className="font-medium text-gray-700 mb-2">制限対象エンドポイント:</p>
                <div className="space-y-1">
                  {stats.rate_limits.top_limited_endpoints.slice(0, 3).map((endpoint) => (
                    <div key={endpoint.endpoint} className="flex justify-between text-sm">
                      <code className="text-gray-600">{endpoint.endpoint}</code>
                      <span className="text-red-600">{endpoint.hits}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* クイックアクション */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          ⚡ クイックアクション
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Button
            onClick={() => window.open('/admin/users', '_blank')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2">👥</span>
            <span className="text-sm">ユーザー管理</span>
          </Button>
          <Button
            onClick={() => window.open('/admin/analytics', '_blank')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2">📊</span>
            <span className="text-sm">分析レポート</span>
          </Button>
          <Button
            onClick={() => window.open('/admin/security/logs', '_blank')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2">🔍</span>
            <span className="text-sm">セキュリティログ</span>
          </Button>
          <Button
            onClick={() => window.open('/admin/maintenance', '_blank')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2">🔧</span>
            <span className="text-sm">メンテナンス</span>
          </Button>
          <Button
            onClick={() => window.open('/admin/export', '_blank')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2">💾</span>
            <span className="text-sm">データ出力</span>
          </Button>
          <Button
            onClick={() => window.open('/admin/settings', '_blank')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2">⚙️</span>
            <span className="text-sm">システム設定</span>
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default AdminDashboard;