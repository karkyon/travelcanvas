/**
 * 共有リンク・コラボレーター・招待・公開共有
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import type { AxiosRequestConfig } from 'axios';
import { NotificationsApi } from './notifications';
import type {
  ApiResponse, Collaborator, CollaboratorRemoveResult, PublicSharedPlan, ShareLink, SharePolicyInput, SharePreview,
} from '../types';
import { apiOk, apiOkVoid } from '../response';
import { arrayOf, decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

const PUBLIC_SHARE_SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class ShareApi extends NotificationsApi {
  // [Gate #27 / A-009] getNotificationSettings/updateNotificationSettingsは
  // 対応するbackend routeが存在せず(呼べば404)、どのUIコンポーネントからも
  // 呼ばれていない死コードだったため削除した。実装はGate #28で行う。

  // [Gate #25] URLが実プレフィックス(/travel-plans)と一致しておらず、共有・
  // コラボレーター機能のバックエンド自体もこれまで存在しなかった(share.pyを
  // 本Gateで新規実装)。getPlan/updatePlan等と同様、バックエンドは生JSONを
  // 返すためクライアント側でApiResponse形状へ手動で包む。
  async revokeShareLink(planId: string, shareId: string): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.post(`/travel-plans/${planId}/share/${shareId}/revoke`);
    return apiOk<ShareLink>(decodeResponse(response.data, (await DL()).shareLink, 'POST /travel-plans/{plan_id}/share/{share_id}/revoke'));
  }

  async listMyInvitations(): Promise<ApiResponse<Collaborator[]>> {
    const response = await this.client.get('/travel-plans/invitations');
    return apiOk<Collaborator[]>(decodeResponse(response.data, arrayOf((await DL()).collaborator), 'GET /travel-plans/invitations'));
  }

  async acceptInvitation(collaboratorId: string): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post(`/travel-plans/invitations/${collaboratorId}/accept`);
    return apiOk<Collaborator>(decodeResponse(response.data, (await DL()).collaborator, 'POST /travel-plans/invitations/{collaborator_id}/accept'));
  }

  async declineInvitation(collaboratorId: string): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post(`/travel-plans/invitations/${collaboratorId}/decline`);
    return apiOk<Collaborator>(decodeResponse(response.data, (await DL()).collaborator, 'POST /travel-plans/invitations/{collaborator_id}/decline'));
  }

  // [Gate #30] 認証不要の公開共有リンク解決。未ログインでも呼び出せる
  // (this.clientはトークン未保持でもAuthorizationヘッダーを付けないだけで
  // 正常にリクエストできる)。
  // [Gate E1] 合言葉が必要・誤りのとき backend は 401 を返す。共通エラー処理はこれを
  // 「ログイン切れ」と扱い、トークンを捨てて /login へ移動していたため、合言葉の入力欄が
  // 一度も表示されなかった。401・404 は PublicSharePage が自分で画面に示す。
  async resolvePublicShare(token: string, passcode?: string): Promise<ApiResponse<PublicSharedPlan>> {
    const response = await this.client.post(`/public/share/${token}/resolve`, {
      passcode: passcode || undefined,
    }, PUBLIC_SHARE_SILENT);
    return apiOk<PublicSharedPlan>(decodeResponse(response.data, (await DL()).publicSharedPlan, 'POST /public/share/{token}/resolve'));
  }

  // [Gate F45] FR-045 見せる項目(preset / fields / acknowledge_confidential)も送れる
  async createShareLink(planId: string, shareData: {
    permission: 'view' | 'edit';
    expires_at?: string;
    passcode?: string;
    max_uses?: number;
    /** [Gate G4] COL-05 受け取った人が許可された項目だけを複製してよい */
    allow_clone?: boolean;
  } & SharePolicyInput): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.post(`/travel-plans/${planId}/share`, shareData);
    return apiOk<ShareLink>(decodeResponse(response.data, (await DL()).shareLink, 'POST /travel-plans/{plan_id}/share'));
  }

  async getShareSettings(planId: string): Promise<ApiResponse<ShareLink[]>> {
    const response = await this.client.get(`/travel-plans/${planId}/share`);
    return apiOk<ShareLink[]>(decodeResponse(response.data, arrayOf((await DL()).shareLink), 'GET /travel-plans/{plan_id}/share'));
  }

  async updateShareSettings(planId: string, shareId: string, data: {
    permission?: 'view' | 'edit';
    expires_at?: string;
    passcode?: string | null;
    max_uses?: number | null;
  } & SharePolicyInput): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.put(`/travel-plans/${planId}/share/${shareId}`, data);
    return apiOk<ShareLink>(decodeResponse(response.data, (await DL()).shareLink, 'PUT /travel-plans/{plan_id}/share/{share_id}'));
  }

  // [Gate F45] 共有前プレビュー(所有者のみ)。リンクを作らず、閲覧者に見える内容と見せない情報の件数を返す
  async previewSharePolicy(planId: string, policy: SharePolicyInput & { permission?: 'view' | 'edit' }): Promise<SharePreview> {
    const response = await this.client.post(`/travel-plans/${planId}/share-preview`, policy);
    return decodeResponse(response.data, (await DL()).sharePreview, 'POST /travel-plans/{plan_id}/share-preview');
  }

  // [Gate F45] 発行済みリンクで閲覧者に見える内容(所有者のみ。使用回数を消費しない)
  async previewShareLink(planId: string, shareId: string): Promise<SharePreview> {
    const response = await this.client.get(`/travel-plans/${planId}/share/${shareId}/preview`);
    return decodeResponse(response.data, (await DL()).sharePreview, 'GET /travel-plans/{plan_id}/share/{share_id}/preview');
  }

  async deleteShareLink(planId: string, shareId: string): Promise<ApiResponse<void>> {
    await this.client.delete<unknown>(`/travel-plans/${planId}/share/${shareId}`);
    return apiOkVoid();
  }

  async inviteCollaborator(planId: string, inviteData: {
    email: string;
    role: 'viewer' | 'editor';
    message?: string;
  }): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post(`/travel-plans/${planId}/collaborators`, inviteData);
    return apiOk<Collaborator>(decodeResponse(response.data, (await DL()).collaborator, 'POST /travel-plans/{plan_id}/collaborators'));
  }

  async getCollaborators(planId: string): Promise<ApiResponse<Collaborator[]>> {
    const response = await this.client.get(`/travel-plans/${planId}/collaborators`);
    return apiOk<Collaborator[]>(decodeResponse(response.data, arrayOf((await DL()).collaborator), 'GET /travel-plans/{plan_id}/collaborators'));
  }

  // [Gate B-013] アクセス取消しは常に成功し、チケット担当者・参加者の割当だけが外れる。
  async removeCollaborator(planId: string, collaboratorId: string): Promise<ApiResponse<CollaboratorRemoveResult>> {
    const response = await this.client.delete<unknown>(`/travel-plans/${planId}/collaborators/${collaboratorId}`);
    return apiOk<CollaboratorRemoveResult>(
      decodeResponse(response.data, (await DL()).collaboratorRemoveResult, 'DELETE /travel-plans/{plan_id}/collaborators/{collaborator_id}')
    );
  }
}
