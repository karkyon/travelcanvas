/**
 * 共同編集(FR-020)と秘匿プロフィール(FR-023)
 *
 * [Gate C1] backend/app/api/v1/presence.py・private_profile.py。
 * - presence: 旅行を開いている間、数秒ごとに知らせ、同じ旅行を開いている人・編集中の予定・他の人の変更を受け取る。
 *   失敗しても画面の操作を止めないよう、共通エラー処理(トースト・/login 移動)を通さない。
 * - 秘匿プロフィール: 本人だけが読み書きする。保存は If-Match にプロフィールの版(まだ無ければ 0)を送る。
 * - [Gate G2] FR-020 即時の通知(GET /plans/{id}/events/stream、Server-Sent Events)を fetch で読む。
 * - [Gate G2] FR-045 同行者向けの項目の規則(GET/PUT /plans/{id}/member-policy)。
 */

export type { PlanStreamEnd } from '../types';
import type { AxiosRequestConfig } from 'axios';
import { OfflinePackApi } from './offlinePack';
import type {
  MemberFieldKey, MemberPolicy, PlanPrivateProfile, PlanStreamEnd, PlanStreamEvent, PresenceState, PrivateProfile,
  PrivateProfileItemInput,
} from '../types';
import { decodeResponse } from '../decode';
import { planPrivateProfile, presenceState, privateProfile } from '../decoders';
import { API_BASE_URL } from '../core';

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

  /**
   * [Gate G2] FR-020 旅行の即時の通知を読む。知らせごとに onEvent を呼び、接続が終わると終わり方を返す。
   * knownRevision は画面が持っている版(つなぎ直しの時は最後に受け取った版)。
   */
  async streamPlanEvents(planId: string, knownRevision: number | undefined,
    onEvent: (event: PlanStreamEvent) => void, signal?: AbortSignal): Promise<PlanStreamEnd> {
    // 読み取りの本体は最初に読む JS を小さく保つため utils/sse.ts(使う時に読み込む)
    const { readPlanStream } = await import('@/utils/sse');
    return readPlanStream(`${API_BASE_URL}/plans/${planId}/events/stream`, this.bearerHeader(), knownRevision, onEvent,
      signal);
  }

  getMemberPolicy(planId: string): Promise<MemberPolicy> {
    return this.g2(this.client.get(`/plans/${planId}/member-policy`, SILENT), 'memberPolicy');
  }

  putMemberPolicy(planId: string, roles: { editor: MemberFieldKey[]; viewer: MemberFieldKey[] }): Promise<MemberPolicy> {
    return this.g2(this.client.put(`/plans/${planId}/member-policy`, { roles }, SILENT), 'memberPolicy');
  }

  /** hidden=null で役割の既定に戻す */
  putMemberOverride(planId: string, collaboratorId: string, hidden: MemberFieldKey[] | null): Promise<MemberPolicy> {
    return this.g2(this.client.put(`/plans/${planId}/member-policy/members/${collaboratorId}`, { hidden }, SILENT),
      'memberPolicy');
  }
}
