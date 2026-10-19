/**
 * 共同編集(FR-020)と秘匿プロフィール(FR-023)
 *
 * [Gate C1] backend/app/api/v1/presence.py・private_profile.py。
 * - presence: 旅行を開いている間、数秒ごとに知らせ、同じ旅行を開いている人・編集中の予定・他の人の変更を受け取る。
 *   失敗しても画面の操作を止めないよう、共通エラー処理(トースト・/login 移動)を通さない。
 * - 秘匿プロフィール: 本人だけが読み書きする。保存は If-Match にプロフィールの版(まだ無ければ 0)を送る。
 */
import type { AxiosRequestConfig } from 'axios';
import { OfflinePackApi } from './offlinePack';
import type { PlanPrivateProfile, PresenceState, PrivateProfile, PrivateProfileItemInput } from '../types';
import { decodeResponse } from '../decode';
import { planPrivateProfile, presenceState, privateProfile } from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface PresenceInput {
  client_id: string;
  known_revision?: number;
  editing?: { kind: 'event'; id: string } | null;
}

export class CollabApi extends OfflinePackApi {
  async postPresence(planId: string, input: PresenceInput): Promise<PresenceState> {
    const response = await this.client.post(`/plans/${planId}/presence`, input, SILENT);
    return decodeResponse(response.data, presenceState, 'POST /plans/{plan_id}/presence');
  }

  async leavePresence(planId: string, clientId: string): Promise<void> {
    await this.client.delete(`/plans/${planId}/presence/${encodeURIComponent(clientId)}`, SILENT);
  }

  async getPrivateProfile(): Promise<PrivateProfile> {
    const response = await this.client.get('/privacy/private-profile', SILENT);
    return decodeResponse(response.data, privateProfile, 'GET /privacy/private-profile');
  }

  async putPrivateProfile(items: PrivateProfileItemInput[], revision: number): Promise<PrivateProfile> {
    const response = await this.client.put('/privacy/private-profile', { items }, {
      ...SILENT, headers: { 'If-Match': String(revision) },
    });
    return decodeResponse(response.data, privateProfile, 'PUT /privacy/private-profile');
  }

  async getPlanPrivateProfile(planId: string): Promise<PlanPrivateProfile> {
    const response = await this.client.get(`/plans/${planId}/private-profile`, SILENT);
    return decodeResponse(response.data, planPrivateProfile, 'GET /plans/{plan_id}/private-profile');
  }

  async putPlanPrivateProfile(planId: string, applied: boolean): Promise<PlanPrivateProfile> {
    const response = await this.client.put(`/plans/${planId}/private-profile`, { applied }, SILENT);
    return decodeResponse(response.data, planPrivateProfile, 'PUT /plans/{plan_id}/private-profile');
  }
}
