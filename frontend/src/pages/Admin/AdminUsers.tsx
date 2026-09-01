/**
 * AdminUsers - ユーザー管理ページ
 * ユーザー一覧、検索、フィルタリング、管理アクション
 */

import React from 'react';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import Modal from '../../components/common/Modal';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { USER_TYPES } from '../../config/constants';

interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  user_type: string;
  is_active: boolean;
  is_verified: boolean;
  last_activity: string;
  created_at: string;
  travel_plans_count: number;
  total_logins: number;
}

interface UserFilters {
  search: string;
  user_type: string;
  status: string;
  sort_by: string;
  sort_order: 'asc' | 'desc';
}

interface UserDetailModalProps {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onUserUpdated: () => void;
}

const UserDetailModal: React.FC<UserDetailModalProps> = ({
  user,
  isOpen,
  onClose,
  onUserUpdated
}) => {
  const [loading, setLoading] = React.useState(false);
  const [userDetails, setUserDetails] = React.useState<any>(null);

  React.useEffect(() => {
    if (isOpen && user) {
      fetchUserDetails(user.id);
    }
  }, [isOpen, user]);

  const fetchUserDetails = async (userId: string) => {
    try {
      setLoading(true);
      const response = await api.get(`/admin/users/${userId}`);
      setUserDetails(response.data);
    } catch (error) {
      console.error('Failed to fetch user details:', error);
      toast.error('ユーザー詳細の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleUserAction = async (action: string, reason?: string) => {
    if (!user) return;

    try {
      setLoading(true);
      await api.post('/admin/users/manage', {
        action,
        user_ids: [user.id],
        reason: reason || '',
        notify_users: true
      });

      toast.success('操作が完了しました');
      onUserUpdated();
      onClose();
    } catch (error) {
      console.error('User action failed:', error);
      toast.error('操作に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleSuspend = () => {
    const reason = prompt('停止理由を入力してください:');
    if (reason) {
      handleUserAction('suspend', reason);
    }
  };

  const handleUnsuspend = () => {
    handleUserAction('unsuspend');
  };

  const handleVerify = () => {
    handleUserAction('verify');
  };

  const handleUnverify = () => {
    handleUserAction('unverify');
  };

  if (!user) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`ユーザー詳細: ${user.username}`}
      size="lg"
    >
      <div className="space-y-6">
        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <>
            {/* 基本情報 */}
            <div>
              <h3 className="text-lg font-semibold mb-3">📋 基本情報</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-gray-700">ユーザーID:</span>
                  <p className="text-gray-900 font-mono">{user.id}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">ユーザー名:</span>
                  <p className="text-gray-900">{user.username}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">メールアドレス:</span>
                  <p className="text-gray-900">{user.email}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">氏名:</span>
                  <p className="text-gray-900">{user.full_name}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">ユーザータイプ:</span>
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                    user.user_type === 'admin' ? 'bg-red-100 text-red-800' :
                    user.user_type === 'premium' ? 'bg-purple-100 text-purple-800' :
                    user.user_type === 'registered' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {user.user_type}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">状態:</span>
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                      user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {user.is_active ? 'アクティブ' : '停止中'}
                    </span>
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                      user.is_verified ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {user.is_verified ? '認証済み' : '未認証'}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="font-medium text-gray-700">登録日:</span>
                  <p className="text-gray-900">{new Date(user.created_at).toLocaleString('ja-JP')}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-700">最終アクティビティ:</span>
                  <p className="text-gray-900">{new Date(user.last_activity).toLocaleString('ja-JP')}</p>
                </div>
              </div>
            </div>

            {/* 統計情報 */}
            {userDetails?.statistics && (
              <div>
                <h3 className="text-lg font-semibold mb-3">📊 統計情報</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <div className="text-sm text-blue-600 font-medium">アカウント経過日数</div>
                    <div className="text-lg font-bold text-blue-900">
                      {userDetails.statistics.account_age_days}日
                    </div>
                  </div>
                  <div className="bg-green-50 p-3 rounded-lg">
                    <div className="text-sm text-green-600 font-medium">総プラン数</div>
                    <div className="text-lg font-bold text-green-900">
                      {userDetails.statistics.total_plans}
                    </div>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-lg">
                    <div className="text-sm text-purple-600 font-medium">完了プラン</div>
                    <div className="text-lg font-bold text-purple-900">
                      {userDetails.statistics.completed_plans}
                    </div>
                  </div>
                  <div className="bg-yellow-50 p-3 rounded-lg">
                    <div className="text-sm text-yellow-600 font-medium">最適化使用回数</div>
                    <div className="text-lg font-bold text-yellow-900">
                      {userDetails.statistics.optimization_usage}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 最近のアクティビティ */}
            {userDetails?.recent_activities && (
              <div>
                <h3 className="text-lg font-semibold mb-3">📝 最近のアクティビティ</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {userDetails.recent_activities.map((activity: any, index: number) => (
                    <div key={index} className="flex items-center justify-between text-sm bg-gray-50 p-2 rounded">
                      <span>{activity.description}</span>
                      <span className="text-gray-500">
                        {new Date(activity.timestamp).toLocaleString('ja-JP')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* セキュリティログ */}
            {userDetails?.security_logs && (
              <div>
                <h3 className="text-lg font-semibold mb-3">🔒 セキュリティログ</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {userDetails.security_logs.slice(0, 5).map((log: any, index: number) => (
                    <div key={index} className="flex items-center justify-between text-sm bg-gray-50 p-2 rounded">
                      <div className="flex items-center space-x-2">
                        <span className={`w-2 h-2 rounded-full ${
                          log.severity === 'error' ? 'bg-red-500' :
                          log.severity === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                        }`}></span>
                        <span>{log.event_type}</span>
                      </div>
                      <span className="text-gray-500">
                        {new Date(log.timestamp).toLocaleString('ja-JP')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* アクションボタン */}
            <div className="flex flex-wrap gap-3 pt-4 border-t">
              {user.is_active ? (
                <Button
                  onClick={handleSuspend}
                  variant="outline"
                  className="text-red-600 border-red-300 hover:bg-red-50"
                  disabled={loading}
                >
                  ⏸️ アカウント停止
                </Button>
              ) : (
                <Button
                  onClick={handleUnsuspend}
                  variant="outline"
                  className="text-green-600 border-green-300 hover:bg-green-50"
                  disabled={loading}
                >
                  ▶️ アカウント復活
                </Button>
              )}
              
              {user.is_verified ? (
                <Button
                  onClick={handleUnverify}
                  variant="outline"
                  disabled={loading}
                >
                  📧 認証解除
                </Button>
              ) : (
                <Button
                  onClick={handleVerify}
                  variant="outline"
                  className="text-blue-600 border-blue-300 hover:bg-blue-50"
                  disabled={loading}
                >
                  ✅ メール認証
                </Button>
              )}
              
              <Button
                onClick={() => navigator.clipboard.writeText(user.id)}
                variant="outline"
                disabled={loading}
              >
                📋 IDコピー
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

const AdminUsers: React.FC = () => {
  const [users, setUsers] = React.useState<User[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null);
  const [showUserDetail, setShowUserDetail] = React.useState(false);
  const [pagination, setPagination] = React.useState({
    page: 1,
    page_size: 20,
    total_count: 0,
    total_pages: 0,
    has_next: false,
    has_prev: false
  });
  
  const [filters, setFilters] = React.useState<UserFilters>({
    search: '',
    user_type: '',
    status: '',
    sort_by: 'created_at',
    sort_order: 'desc'
  });

  const { user: currentUser } = useAuthStore();

  // 権限チェック
  React.useEffect(() => {
    if (currentUser?.user_type !== 'admin') {
      toast.error('管理者権限が必要です');
      window.location.href = '/';
    }
  }, [currentUser]);

  // ユーザー一覧の取得
  const fetchUsers = React.useCallback(async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        page_size: pagination.page_size.toString(),
        sort_by: filters.sort_by,
        sort_order: filters.sort_order
      });

      if (filters.search) params.append('search', filters.search);
      if (filters.user_type) params.append('user_type', filters.user_type);
      if (filters.status) params.append('status', filters.status);

      const response = await api.get(`/admin/users?${params.toString()}`);
      setUsers(response.data);
      setPagination(response.pagination);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      toast.error('ユーザー一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.page_size, filters]);

  // 初期データ取得
  React.useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // 検索デバウンス
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (pagination.page !== 1) {
        setPagination(prev => ({ ...prev, page: 1 }));
      } else {
        fetchUsers();
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [filters.search]);

  // フィルター変更時
  React.useEffect(() => {
    if (pagination.page !== 1) {
      setPagination(prev => ({ ...prev, page: 1 }));
    } else {
      fetchUsers();
    }
  }, [filters.user_type, filters.status, filters.sort_by, filters.sort_order]);

  const handleUserClick = (user: User) => {
    setSelectedUser(user);
    setShowUserDetail(true);
  };

  const handleUserUpdated = () => {
    fetchUsers();
  };

  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const getUserTypeLabel = (type: string) => {
    switch (type) {
      case USER_TYPES.GUEST: return 'ゲスト';
      case USER_TYPES.REGISTERED: return '登録ユーザー';
      case USER_TYPES.PREMIUM: return 'プレミアム';
      case USER_TYPES.ADMIN: return '管理者';
      default: return type;
    }
  };

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">ユーザー管理</h1>
          <p className="text-gray-600 mt-1">
            総ユーザー数: {pagination.total_count.toLocaleString()}名
          </p>
        </div>
        <Button
          onClick={() => window.open('/admin/users/export', '_blank')}
          variant="primary"
        >
          📊 データエクスポート
        </Button>
      </div>

      {/* フィルター */}
      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-2">
            <Input
              type="text"
              placeholder="🔍 ユーザー名、メールアドレスで検索..."
              value={filters.search}
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            />
          </div>
          
          <select
            value={filters.user_type}
            onChange={(e) => setFilters(prev => ({ ...prev, user_type: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">全ユーザータイプ</option>
            <option value={USER_TYPES.GUEST}>ゲスト</option>
            <option value={USER_TYPES.REGISTERED}>登録ユーザー</option>
            <option value={USER_TYPES.PREMIUM}>プレミアム</option>
            <option value={USER_TYPES.ADMIN}>管理者</option>
          </select>

          <select
            value={filters.status}
            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">全ステータス</option>
            <option value="active">アクティブ</option>
            <option value="inactive">停止中</option>
            <option value="verified">認証済み</option>
            <option value="unverified">未認証</option>
          </select>

          <select
            value={`${filters.sort_by}-${filters.sort_order}`}
            onChange={(e) => {
              const [sort_by, sort_order] = e.target.value.split('-');
              setFilters(prev => ({ ...prev, sort_by, sort_order: sort_order as 'asc' | 'desc' }));
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="created_at-desc">登録日（新しい順）</option>
            <option value="created_at-asc">登録日（古い順）</option>
            <option value="last_activity-desc">最終活動（新しい順）</option>
            <option value="username-asc">ユーザー名（昇順）</option>
            <option value="email-asc">メール（昇順）</option>
          </select>
        </div>
      </Card>

      {/* ユーザー一覧 */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ユーザー
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      タイプ
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ステータス
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      プラン数
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      最終活動
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      登録日
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      アクション
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {user.username}
                          </div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                          {user.full_name && (
                            <div className="text-sm text-gray-500">{user.full_name}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          user.user_type === 'admin' ? 'bg-red-100 text-red-800' :
                          user.user_type === 'premium' ? 'bg-purple-100 text-purple-800' :
                          user.user_type === 'registered' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {getUserTypeLabel(user.user_type)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                            user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {user.is_active ? 'アクティブ' : '停止中'}
                          </span>
                          {user.is_verified && (
                            <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                              認証済み
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {user.travel_plans_count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(user.last_activity).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(user.created_at).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <Button
                          onClick={() => handleUserClick(user)}
                          variant="outline"
                          size="sm"
                        >
                          詳細
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ページネーション */}
            {pagination.total_pages > 1 && (
              <div className="px-6 py-3 bg-gray-50 border-t flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  {((pagination.page - 1) * pagination.page_size) + 1} - {
                    Math.min(pagination.page * pagination.page_size, pagination.total_count)
                  } / {pagination.total_count} 件
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={!pagination.has_prev}
                    variant="outline"
                    size="sm"
                  >
                    前へ
                  </Button>
                  <span className="text-sm text-gray-700">
                    {pagination.page} / {pagination.total_pages}
                  </span>
                  <Button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={!pagination.has_next}
                    variant="outline"
                    size="sm"
                  >
                    次へ
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ユーザー詳細モーダル */}
      <UserDetailModal
        user={selectedUser}
        isOpen={showUserDetail}
        onClose={() => setShowUserDetail(false)}
        onUserUpdated={handleUserUpdated}
      />
    </div>
  );
};

export default AdminUsers;