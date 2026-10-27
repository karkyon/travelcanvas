/**
 * 外部状況(アラート、FR-030)・安全な再計画(FR-031)
 *
 * [Gate P10] backend/app/api/v1/replans.py。/plans/{planId}/alerts・/plans/{planId}/replans配下。
 * アラートの変更・再計画案の却下はそれぞれのrevision、再計画案の適用は本案のrevision(If-Match)。
 * 適用の409は構造化detail(code: replan_stale / replan_conflict / replan_closed / candidate_unavailable / no_changes)。
 */
import { PrivacyApi } from './privacy';
import type { AlertCreateData, AlertList, AlertUpdateData, PlanAlert, Replan, ReplanApplyResult } from '../types';
import { decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

const ifMatch = (revision: number) => ({ headers: { 'If-Match': String(revision) } });

export class ReplansApi extends PrivacyApi {
  async getAlerts(planId: string): Promise<AlertList> {
    const response = await this.client.get(`/plans/${planId}/alerts`);
    return decodeResponse(response.data, (await DL()).alertList, 'GET /plans/{plan_id}/alerts');
  }

  async createAlert(planId: string, data: AlertCreateData): Promise<PlanAlert> {
    const response = await this.client.post(`/plans/${planId}/alerts`, data);
    return decodeResponse(response.data, (await DL()).planAlert, 'POST /plans/{plan_id}/alerts');
  }

  async updateAlert(planId: string, alertId: string, data: AlertUpdateData, revision: number): Promise<PlanAlert> {
    const response = await this.client.patch(`/plans/${planId}/alerts/${alertId}`, data, ifMatch(revision));
    return decodeResponse(response.data, (await DL()).planAlert, 'PATCH /plans/{plan_id}/alerts/{alert_id}');
  }

  async createReplan(planId: string, alertId: string): Promise<Replan> {
    const response = await this.client.post(`/plans/${planId}/alerts/${alertId}/replans`);
    return decodeResponse(response.data, (await DL()).replan, 'POST /plans/{plan_id}/alerts/{alert_id}/replans');
  }

  async getReplan(planId: string, replanId: string): Promise<Replan> {
    const response = await this.client.get(`/plans/${planId}/replans/${replanId}`);
    return decodeResponse(response.data, (await DL()).replan, 'GET /plans/{plan_id}/replans/{replan_id}');
  }

  async applyReplan(planId: string, replanId: string, candidate: 'A' | 'B', planRevision: number): Promise<ReplanApplyResult> {
    const response = await this.client.post(`/plans/${planId}/replans/${replanId}/apply`, { candidate }, ifMatch(planRevision));
    return decodeResponse(response.data, (await DL()).replanApplyResult, 'POST /plans/{plan_id}/replans/{replan_id}/apply');
  }

  async rejectReplan(planId: string, replanId: string, revision: number): Promise<Replan> {
    const response = await this.client.post(`/plans/${planId}/replans/${replanId}/reject`, undefined, ifMatch(revision));
    return decodeResponse(response.data, (await DL()).replan, 'POST /plans/{plan_id}/replans/{replan_id}/reject');
  }
}
