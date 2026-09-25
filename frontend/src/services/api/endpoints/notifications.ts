/**
 * 通知
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { PlanInsightsApi } from './insights';
import type { ApiResponse, Notification } from '../types';

export class NotificationsApi extends PlanInsightsApi {
  // [Gate #26] URLは実装済みだったが、バックエンド(/notifications)自体が
  // 一切存在しなかった(本Gateでnotifications.pyを新規実装)。他のAPIと同様、
  // 生JSONを返すためクライアント側でApiResponse形状へ手動で包む。
  async getNotifications(unreadOnly = false): Promise<ApiResponse<Notification[]>> {
    const response = await this.client.get<Notification[]>('/notifications/', {
      params: unreadOnly ? { unread_only: true } : undefined,
    });
    return { success: true, data: response.data } as ApiResponse<Notification[]>;
  }

  async getUnreadNotificationCount(): Promise<ApiResponse<{ unread_count: number }>> {
    const response = await this.client.get<{ unread_count: number }>('/notifications/unread-count');
    return { success: true, data: response.data } as ApiResponse<{ unread_count: number }>;
  }

  async markNotificationAsRead(notificationId: string): Promise<ApiResponse<void>> {
    await this.client.post<unknown>(`/notifications/${notificationId}/read`);
    return { success: true } as ApiResponse<void>;
  }

  async markAllNotificationsAsRead(): Promise<ApiResponse<void>> {
    await this.client.post<unknown>('/notifications/read-all');
    return { success: true } as ApiResponse<void>;
  }
}
