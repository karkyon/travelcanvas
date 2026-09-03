/**
 * NotificationsPage - 通知一覧ページ
 *
 * [Gate #26] Header.tsxの通知ベルアイコンは常に導線があったが、遷移先は
 * 「開発中です」の固定表示だった。実際のnotifications APIに接続する。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { notificationsAPI } from '@/services/api';
import type { Notification } from '@/services/api';
import { toast } from 'react-hot-toast';

const NotificationsPage: React.FC = () => {
  const [notifications, setNotifications] = React.useState<Notification[]>([]);
  const [loading, setLoading] = React.useState(true);
  const navigate = useNavigate();

  const fetchNotifications = React.useCallback(async () => {
    try {
      setLoading(true);
      const response = await notificationsAPI.getNotifications();
      setNotifications(response.data ?? []);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      toast.error('通知の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationsAPI.markAsRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch (error) {
      toast.error('既読にできませんでした');
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsAPI.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success('すべて既読にしました');
    } catch (error) {
      toast.error('既読にできませんでした');
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      handleMarkAsRead(notification.id);
    }
    if (notification.related_plan_id) {
      navigate(`/planner/${notification.related_plan_id}`);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell size={24} />
          通知
          {unreadCount > 0 && (
            <span className="text-sm font-medium bg-red-500 text-white px-2 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </h1>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={handleMarkAllAsRead}>
            <CheckCheck size={16} className="mr-1" />
            すべて既読にする
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : notifications.length === 0 ? (
        <Card className="p-12 text-center text-gray-500">
          <Bell size={48} className="mx-auto mb-4 opacity-40" />
          <p>通知はまだありません</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <Card
              key={notification.id}
              className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${
                !notification.is_read ? 'border-l-4 border-blue-500 bg-blue-50' : ''
              }`}
              onClick={() => handleNotificationClick(notification)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{notification.title}</p>
                  {notification.message && (
                    <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(notification.created_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                {!notification.is_read && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMarkAsRead(notification.id);
                    }}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors shrink-0"
                    title="既読にする"
                  >
                    <Check size={16} />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationsPage;
