/**
 * 訪問の地図の層・訪問判定・訂正(FR-049・FR-050・FR-051)
 *
 * [Gate V2] backend/app/api/v1/visits.py。/plans/{planId}/visits配下(閲覧者本人の判定だけ)。
 * 画面内でエラーを案内するため、共通エラー処理のtoastは出さない(SILENT)。
 * 既にある判定を直す時は判定のrevisionを If-Match に送る(判定の無い予定では送らない)。
 */
import type { AxiosRequestConfig } from 'axios';
import { AdminApi } from './admin';
import type { DeviceVisitMetrics, VisitAction, VisitCorrectionResult, VisitsOverview } from '../types';
import { decodeResponse } from '../decode';
import { visitCorrectionResult, visitsOverview } from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class VisitsApi extends AdminApi {
  async getVisits(planId: string): Promise<VisitsOverview> {
    const response = await this.client.get(`/plans/${planId}/visits`, SILENT);
    return decodeResponse(response.data, visitsOverview, 'GET /plans/{plan_id}/visits');
  }

  async assessVisits(planId: string): Promise<VisitsOverview> {
    const response = await this.client.post(`/plans/${planId}/visits/assess`, {}, SILENT);
    return decodeResponse(response.data, visitsOverview, 'POST /plans/{plan_id}/visits/assess');
  }

  async postDeviceVisitResults(
    planId: string, results: Array<{ event_id: string; metrics: DeviceVisitMetrics }>,
  ): Promise<VisitsOverview> {
    const response = await this.client.post(`/plans/${planId}/visits/device-results`, { results }, SILENT);
    return decodeResponse(response.data, visitsOverview, 'POST /plans/{plan_id}/visits/device-results');
  }

  async correctVisit(planId: string, eventId: string, action: VisitAction, revision?: number): Promise<VisitCorrectionResult> {
    const config: AxiosRequestConfig = revision === undefined
      ? SILENT
      : { ...SILENT, headers: { 'If-Match': String(revision) } };
    const response = await this.client.patch(`/plans/${planId}/visits/${eventId}`, { action }, config);
    return decodeResponse(response.data, visitCorrectionResult, 'PATCH /plans/{plan_id}/visits/{event_id}');
  }
}
