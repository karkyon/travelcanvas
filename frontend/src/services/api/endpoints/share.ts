/**
 * 共有リンク・コラボレーター・招待・公開共有
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { NotificationsApi } from './notifications';
import type { ApiResponse, Collaborator, PublicSharedPlan, ShareLink } from '../types';

export class ShareApi extends NotificationsApi {
  // [Gate #27 / A-009] getNotificationSettings/updateNotificationSettingsは
  // 対応するbackend routeが存在せず(呼べば404)、どのUIコンポーネントからも
  // 呼ばれていない死コードだったため削除した。実装はGate #28で行う。

  // [Gate #25] URLが実プレフィックス(/travel-plans)と一致しておらず、共有・
  // コラボレーター機能のバックエンド自体もこれまで存在しなかった(share.pyを
  // 本Gateで新規実装)。getPlan/updatePlan等と同様、バックエンドは生JSONを
  // 返すためクライアント側でApiResponse形状へ手動で包む。
  async revokeShareLink(planId: string, shareId: string): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.post<ShareLink>(`/travel-plans/${planId}/share/${shareId}/revoke`);
    return { success: true, data: response.data } as ApiResponse<ShareLink>;
  }

  async listMyInvitations(): Promise<ApiResponse<Collaborator[]>> {
    const response = await this.client.get<Collaborator[]>('/travel-plans/invitations');
    return { success: true, data: response.data } as ApiResponse<Collaborator[]>;
  }

  async acceptInvitation(collaboratorId: string): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post<Collaborator>(`/travel-plans/invitations/${collaboratorId}/accept`);
    return { success: true, data: response.data } as ApiResponse<Collaborator>;
  }

  async declineInvitation(collaboratorId: string): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post<Collaborator>(`/travel-plans/invitations/${collaboratorId}/decline`);
    return { success: true, data: response.data } as ApiResponse<Collaborator>;
  }

  // [Gate #30] 認証不要の公開共有リンク解決。未ログインでも呼び出せる
  // (this.clientはトークン未保持でもAuthorizationヘッダーを付けないだけで
  // 正常にリクエストできる)。
  async resolvePublicShare(token: string, passcode?: string): Promise<ApiResponse<PublicSharedPlan>> {
    const response = await this.client.post<PublicSharedPlan>(`/public/share/${token}/resolve`, {
      passcode: passcode || undefined,
    });
    return { success: true, data: response.data } as ApiResponse<PublicSharedPlan>;
  }

  async createShareLink(planId: string, shareData: {
    permission: 'view' | 'edit';
    expires_at?: string;
    passcode?: string;
    max_uses?: number;
  }): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.post<ShareLink>(`/travel-plans/${planId}/share`, shareData);
    return { success: true, data: response.data } as ApiResponse<ShareLink>;
  }

  async getShareSettings(planId: string): Promise<ApiResponse<ShareLink[]>> {
    const response = await this.client.get<ShareLink[]>(`/travel-plans/${planId}/share`);
    return { success: true, data: response.data } as ApiResponse<ShareLink[]>;
  }

  async updateShareSettings(planId: string, shareId: string, data: {
    permission?: 'view' | 'edit';
    expires_at?: string;
    passcode?: string | null;
    max_uses?: number | null;
  }): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.put<ShareLink>(`/travel-plans/${planId}/share/${shareId}`, data);
    return { success: true, data: response.data } as ApiResponse<ShareLink>;
  }

  async deleteShareLink(planId: string, shareId: string): Promise<ApiResponse<void>> {
    await this.client.delete<unknown>(`/travel-plans/${planId}/share/${shareId}`);
    return { success: true } as ApiResponse<void>;
  }

  async inviteCollaborator(planId: string, inviteData: {
    email: string;
    role: 'viewer' | 'editor';
    message?: string;
  }): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post<Collaborator>(`/travel-plans/${planId}/collaborators`, inviteData);
    return { success: true, data: response.data } as ApiResponse<Collaborator>;
  }

  async getCollaborators(planId: string): Promise<ApiResponse<Collaborator[]>> {
    const response = await this.client.get<Collaborator[]>(`/travel-plans/${planId}/collaborators`);
    return { success: true, data: response.data } as ApiResponse<Collaborator[]>;
  }

  async removeCollaborator(planId: string, collaboratorId: string): Promise<ApiResponse<void>> {
    await this.client.delete<unknown>(`/travel-plans/${planId}/collaborators/${collaboratorId}`);
    return { success: true } as ApiResponse<void>;
  }
}
