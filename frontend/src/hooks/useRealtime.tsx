/**
 * useRealtime Hook - リアルタイム機能管理
 * プランの共同編集、リアルタイム更新を管理
 */

import React from 'react';
import { webSocketService, WebSocketEventHandlers } from '../services/websocket';
import { usePlanStore } from '../store/planStore';
import { useAuthStore } from '../store/authStore';
import { toast } from 'react-hot-toast';

interface RealtimeConfig {
  enableAutoSync?: boolean;
  enableCollaboratorNotifications?: boolean;
  enableOptimizationNotifications?: boolean;
}

interface CollaboratorInfo {
  id: string;
  name: string;
  avatar?: string;
  lastSeen: Date;
  isActive: boolean;
}

export const useRealtime = (planId: string | null, config: RealtimeConfig = {}) => {
  const [isConnected, setIsConnected] = React.useState(false);
  const [collaborators, setCollaborators] = React.useState<CollaboratorInfo[]>([]);
  const [error, setError] = React.useState<Error | null>(null);
  
  const { 
    updatePlan, 
    addScheduleItem, 
    updateScheduleItem, 
    deleteScheduleItem,
    refreshPlan 
  } = usePlanStore();
  
  const { user, token } = useAuthStore();

  const {
    enableAutoSync = true,
    enableCollaboratorNotifications = true,
    enableOptimizationNotifications = true
  } = config;

  // WebSocket接続管理
  React.useEffect(() => {
    if (!planId || !token) {
      setIsConnected(false);
      return;
    }

    const handlers: WebSocketEventHandlers = {
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        if (connected) {
          setError(null);
          if (enableCollaboratorNotifications) {
            toast.success('リアルタイム同期が開始されました');
          }
        } else {
          if (enableCollaboratorNotifications) {
            toast.error('リアルタイム同期が切断されました');
          }
        }
      },

      onError: (err) => {
        setError(err);
        toast.error(`接続エラー: ${err.message}`);
      },

      onPlanUpdated: (data) => {
        if (enableAutoSync && data.user_id !== user?.id) {
          console.log('Plan updated by another user:', data);
          
          // プランの基本情報が更新された場合
          if (data.changes) {
            updatePlan(planId, data.changes);
            
            if (enableCollaboratorNotifications) {
              toast(`プランが更新されました: ${data.changes.field}`, {
                icon: '🔄'
              });
            }
          }
        }
      },

      onEventAdded: (data) => {
        if (enableAutoSync && data.user_id !== user?.id) {
          console.log('Event added by another user:', data);
          addScheduleItem(planId, data.day_id, data.event);
          
          if (enableCollaboratorNotifications) {
            toast(`新しいイベントが追加されました: ${data.event.title}`, {
              icon: '➕'
            });
          }
        }
      },

      onEventUpdated: (data) => {
        if (enableAutoSync && data.user_id !== user?.id) {
          console.log('Event updated by another user:', data);
          updateScheduleItem(data.event.id, data.changes);
          
          if (enableCollaboratorNotifications) {
            toast(`イベントが更新されました: ${data.event.title}`, {
              icon: '✏️'
            });
          }
        }
      },

      onEventDeleted: (data) => {
        if (enableAutoSync && data.user_id !== user?.id) {
          console.log('Event deleted by another user:', data);
          deleteScheduleItem(data.event_id);
          
          if (enableCollaboratorNotifications) {
            toast(`イベントが削除されました`, {
              icon: '🗑️'
            });
          }
        }
      },

      onCollaboratorJoined: (data) => {
        console.log('Collaborator joined:', data);
        
        setCollaborators(prev => {
          const existing = prev.find(c => c.id === data.user.id);
          if (existing) {
            return prev.map(c => 
              c.id === data.user.id 
                ? { ...c, isActive: true, lastSeen: new Date() }
                : c
            );
          }
          
          return [...prev, {
            id: data.user.id,
            name: data.user.name || data.user.username,
            avatar: data.user.avatar_url,
            lastSeen: new Date(),
            isActive: true
          }];
        });

        if (enableCollaboratorNotifications && data.user.id !== user?.id) {
          toast(`${data.user.name || data.user.username} がプランに参加しました`, {
            icon: '👥'
          });
        }
      },

      onOptimizationComplete: (data) => {
        console.log('Optimization completed:', data);
        
        if (enableOptimizationNotifications) {
          toast('最適化が完了しました！結果を確認してください', {
            icon: '⚡',
            duration: 5000
          });
        }

        // プランを再読み込みして最新の最適化結果を取得
        if (enableAutoSync) {
          refreshPlan(planId);
        }
      },

      onNotification: (data) => {
        console.log('Notification received:', data);
        
        if (data.type === 'system') {
          toast(data.message, { icon: '📢' });
        } else if (data.type === 'warning') {
          toast(data.message, { icon: '⚠️' });
        } else if (data.type === 'info') {
          toast(data.message, { icon: 'ℹ️' });
        }
      }
    };

    webSocketService.setEventHandlers(handlers);
    
    webSocketService.connect(planId, token)
      .catch(err => {
        setError(err);
        console.error('Failed to connect WebSocket:', err);
      });

    return () => {
      webSocketService.disconnect();
    };
  }, [planId, token, user?.id, enableAutoSync, enableCollaboratorNotifications, enableOptimizationNotifications]);

  // ユーザーアクティビティ監視
  React.useEffect(() => {
    if (!isConnected) return;

    const handleUserActivity = () => {
      webSocketService.send({
        type: 'user_activity',
        timestamp: new Date().toISOString(),
        user_id: user?.id
      });
    };

    const handleMouseMove = () => {
      clearTimeout(activityTimeout);
      activityTimeout = setTimeout(handleUserActivity, 5000);
    };

    let activityTimeout: NodeJS.Timeout;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('keypress', handleUserActivity);
    document.addEventListener('click', handleUserActivity);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keypress', handleUserActivity);
      document.removeEventListener('click', handleUserActivity);
      clearTimeout(activityTimeout);
    };
  }, [isConnected, user?.id]);

  // 手動同期
  const syncPlan = React.useCallback(async () => {
    if (!planId) return;
    
    try {
      await refreshPlan(planId);
      toast.success('プランを同期しました');
    } catch (error) {
      toast.error('同期に失敗しました');
      console.error('Sync failed:', error);
    }
  }, [planId, refreshPlan]);

  // 変更をブロードキャスト
  const broadcastChange = React.useCallback((type: string, data: any) => {
    if (!isConnected) return;

    webSocketService.send({
      type: 'plan_change',
      change_type: type,
      data,
      timestamp: new Date().toISOString(),
      user_id: user?.id
    });
  }, [isConnected, user?.id]);

  // コラボレーター離脱通知
  const notifyCollaboratorLeft = React.useCallback((collaboratorId: string) => {
    setCollaborators(prev => 
      prev.map(c => 
        c.id === collaboratorId 
          ? { ...c, isActive: false, lastSeen: new Date() }
          : c
      )
    );
  }, []);

  // 接続再試行
  const reconnect = React.useCallback(() => {
    if (planId && token) {
      webSocketService.connect(planId, token).catch(console.error);
    }
  }, [planId, token]);

  return {
    isConnected,
    error,
    collaborators,
    syncPlan,
    broadcastChange,
    notifyCollaboratorLeft,
    reconnect,
    
    // 設定
    config: {
      enableAutoSync,
      enableCollaboratorNotifications,
      enableOptimizationNotifications
    }
  };
};