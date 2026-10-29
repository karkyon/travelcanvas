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
import { useNavigate } from 'react-router-dom';
import { getAdminStats } from '../../services/api';
import { apiErrorMessage } from '../../utils/apiError';
import type { AdminSystemStats } from '../../services/api';
import { toast } from 'react-hot-toast';
import AdminUsagePanel from './AdminUsagePanel';
import AdminEntitlementsPanel from './AdminEntitlementsPanel';
import AdminJobsPanel from './AdminJobsPanel';

// [Gate A2] 応答の形は services/api の adminSystemStats で検査する
type SystemStats = AdminSystemStats;

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
    gray: 'bg-gray-50 border-gray-200 text-ink-900',
  };

  return (
    <Card className={`p-6 ${colorClasses[color]}`}>
      <div className="flex items-center space-x-3">
        <div className="text-2xl">{icon}</div>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
          {subtitle && <p className="text-sm">{subtitle}</p>}
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

  const navigate = useNavigate();
  // [Gate A2] 管理者の判定は AdminRoute(router/guards.tsx: admin・super_admin・is_superuser)と backend が行う。
  // 以前はここでも user_type === 'admin' だけを見ていたため、is_superuser の管理者を追い返していた

  // システム統計の取得
  const fetchStats = React.useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setStats(await getAdminStats());
      setLastRefresh(new Date());

      if (isRefresh) {
        toast.success('統計データを更新しました');
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, '統計データの取得に失敗しました'));
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
        <p className="text-ink-700">統計データを取得できませんでした</p>
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
          <h1 className="text-3xl font-bold text-ink-900">管理者ダッシュボード</h1>
          <p className="text-ink-700 mt-1">最終更新: {lastRefresh.toLocaleString('ja-JP')}</p>
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
        <h2 className="text-xl font-semibold text-ink-900 mb-4">👥 ユーザー統計</h2>
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
            subtitle="停止していないユーザー"
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
        <h2 className="text-xl font-semibold text-ink-900 mb-4">📋 プラン統計</h2>
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
        <h3 className="text-lg font-semibold text-ink-900 mb-4">🌍 人気デスティネーション</h3>
        {stats.travel_plans.popular_destinations.length === 0 ? (
          <p className="text-sm text-ink-700">デスティネーションが設定されたプランがまだありません</p>
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
                <span className="text-ink-700">{dest.count} プラン</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* クイックアクション */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-ink-900 mb-4">⚡ クイックアクション</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Button
            onClick={() => navigate('/admin/users')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2" aria-hidden="true">👥</span>
            <span className="text-sm">ユーザー管理</span>
          </Button>
          <Button
            onClick={() => navigate('/admin/audit-logs')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2" aria-hidden="true">📜</span>
            <span className="text-sm">監査ログ</span>
          </Button>
          <Button
            onClick={() => navigate('/admin/support')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2" aria-hidden="true">🛟</span>
            <span className="text-sm">運用とサポート</span>
          </Button>
          <Button
            onClick={() => navigate('/admin/abuse')}
            variant="outline"
            className="flex flex-col items-center p-4 h-auto"
          >
            <span className="text-2xl mb-2" aria-hidden="true">🚩</span>
            <span className="text-sm">濫用への対応</span>
          </Button>
        </div>
      </Card>

      {/* [Gate G5] BILL-02 使用量と上限の上書き */}
      <AdminUsagePanel />
      <AdminEntitlementsPanel />

      {/* [Gate G8] FR-004 定期の処理が続いて動いているか */}
      <AdminJobsPanel />
    </div>
  );
};

export default AdminDashboard;
