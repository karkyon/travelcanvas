/**
 * NotificationsPage - 通知一覧ページ
 *
 * [Gate #26] Header.tsxの通知ベルアイコンは常に導線があったが、遷移先は
 * 「開発中です」の固定表示だった。実際のnotifications APIに接続する。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck, Users, X } from 'lucide-react';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { notificationsAPI, listMyInvitations, acceptInvitation, declineInvitation } from '@/services/api';
import type { Notification, Collaborator } from '@/services/api';
import { toast } from 'react-hot-toast';

const NotificationsPage: React.FC = () => {
  const [notifications, setNotifications] = React.useState<Notification[]>([]);
  const [invitations, setInvitations] = React.useState<Collaborator[]>([]);
  const [invitationsLoading, setInvitationsLoading] = React.useState(true);
  const [decidingId, setDecidingId] = React.useState<string | null>(null);
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

  // [Gate #30] 招待(PlanCollaborator)を承諾/辞退できる手段がこれまで
  // 一切存在しなかった(承諾しても永久にプランへアクセスできなかった)。
  // 通知ページに「保留中の招待」セクションを追加し、その場でaccept/decline
  // できるようにする。
  const fetchInvitations = React.useCallback(async () => {
    try {
      setInvitationsLoading(true);
      const response = await listMyInvitations();
      setInvitations((response.data ?? []).filter((i) => i.status === 'pending'));
    } catch (error) {
      console.error('Failed to fetch invitations:', error);
    } finally {
      setInvitationsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchNotifications();
    fetchInvitations();
  }, [fetchNotifications, fetchInvitations]);

  const handleAcceptInvitation = async (id: string) => {
    setDecidingId(id);
    try {
      await acceptInvitation(id);
      setInvitations((prev) => prev.filter((i) => i.id !== id));
      toast.success('招待を承諾しました');
    } catch (error) {
      toast.error('招待の承諾に失敗しました');
    } finally {
      setDecidingId(null);
    }
  };

  const handleDeclineInvitation = async (id: string) => {
    setDecidingId(id);
    try {
      await declineInvitation(id);
      setInvitations((prev) => prev.filter((i) => i.id !== id));
      toast.success('招待を辞退しました');
    } catch (error) {
      toast.error('招待の辞退に失敗しました');
    } finally {
      setDecidingId(null);
    }
  };

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

      {!invitationsLoading && invitations.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-1">
            <Users size={16} />
            保留中の招待 ({invitations.length})
          </h2>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <Card key={inv.id} className="p-4">
                <p className="font-medium text-gray-900">
                  「{inv.plan_title || '旅行プラン'}」への招待
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  権限: {inv.role === 'editor' ? '編集可能' : '閲覧のみ'}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    onClick={() => handleAcceptInvitation(inv.id)}
                    disabled={decidingId === inv.id}
                  >
                    <Check size={14} className="mr-1" />
                    承諾する
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeclineInvitation(inv.id)}
                    disabled={decidingId === inv.id}
                  >
                    <X size={14} className="mr-1" />
                    辞退する
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

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
