/**
 * WebSocket Service - リアルタイム通信管理
 * 共同編集、リアルタイム更新、通知機能を提供
 */

export interface WebSocketMessage {
  type: 'plan_updated' | 'event_added' | 'event_updated' | 'event_deleted' | 
        'collaborator_joined' | 'optimization_complete' | 'notification';
  timestamp: string;
  user_id: string;
  data: any;
}

export interface WebSocketEventHandlers {
  onPlanUpdated?: (data: any) => void;
  onEventAdded?: (data: any) => void;
  onEventUpdated?: (data: any) => void;
  onEventDeleted?: (data: any) => void;
  onCollaboratorJoined?: (data: any) => void;
  onOptimizationComplete?: (data: any) => void;
  onNotification?: (data: any) => void;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: Error) => void;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 1000;
  private handlers: WebSocketEventHandlers = {};
  private planId: string | null = null;
  private token: string | null = null;
  private isConnecting = false;

  constructor() {
    this.setupEventListeners();
  }

  /**
   * WebSocket接続を確立
   */
  connect(planId: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnecting) {
        reject(new Error('Already connecting'));
        return;
      }

      this.planId = planId;
      this.token = token;
      this.isConnecting = true;

      try {
        const wsUrl = `${import.meta.env.VITE_WS_URL}/ws/plan/${planId}?token=${token}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.handlers.onConnectionChange?.(true);
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket disconnected:', event.code, event.reason);
          this.isConnecting = false;
          this.handlers.onConnectionChange?.(false);
          
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.isConnecting = false;
          this.handlers.onError?.(new Error('WebSocket connection error'));
          reject(error);
        };

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * WebSocket接続を切断
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
    this.planId = null;
    this.token = null;
  }

  /**
   * メッセージ送信
   */
  send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected');
    }
  }

  /**
   * イベントハンドラーを設定
   */
  setEventHandlers(handlers: WebSocketEventHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * 接続状態を取得
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * メッセージハンドリング
   */
  private handleMessage(message: WebSocketMessage): void {
    console.log('WebSocket message received:', message);

    switch (message.type) {
      case 'plan_updated':
        this.handlers.onPlanUpdated?.(message.data);
        break;
      case 'event_added':
        this.handlers.onEventAdded?.(message.data);
        break;
      case 'event_updated':
        this.handlers.onEventUpdated?.(message.data);
        break;
      case 'event_deleted':
        this.handlers.onEventDeleted?.(message.data);
        break;
      case 'collaborator_joined':
        this.handlers.onCollaboratorJoined?.(message.data);
        break;
      case 'optimization_complete':
        this.handlers.onOptimizationComplete?.(message.data);
        break;
      case 'notification':
        this.handlers.onNotification?.(message.data);
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  /**
   * 再接続スケジュール
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      if (this.planId && this.token) {
        this.connect(this.planId, this.token).catch(console.error);
      }
    }, delay);
  }

  /**
   * イベントリスナー設定
   */
  private setupEventListeners(): void {
    // ページが非表示になったときの処理
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // ページが非表示の時は接続を維持するが、送信は控える
      } else {
        // ページが表示された時の処理
        if (!this.isConnected && this.planId && this.token) {
          this.connect(this.planId, this.token).catch(console.error);
        }
      }
    });

    // ページがアンロードされる前の処理
    window.addEventListener('beforeunload', () => {
      this.disconnect();
    });
  }
}

// シングルトンインスタンス
export const webSocketService = new WebSocketService();

/**
 * React Hook for WebSocket
 */
export const useWebSocket = (planId: string | null, token: string | null) => {
  const [isConnected, setIsConnected] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!planId || !token) {
      setIsConnected(false);
      return;
    }

    const handlers: WebSocketEventHandlers = {
      onConnectionChange: setIsConnected,
      onError: setError
    };

    webSocketService.setEventHandlers(handlers);
    
    webSocketService.connect(planId, token)
      .catch(setError);

    return () => {
      webSocketService.disconnect();
    };
  }, [planId, token]);

  return {
    isConnected,
    error,
    send: webSocketService.send.bind(webSocketService),
    setEventHandlers: webSocketService.setEventHandlers.bind(webSocketService)
  };
};