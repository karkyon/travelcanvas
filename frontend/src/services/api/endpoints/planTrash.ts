/**
 * 削除済みプラン(ゴミ箱): 一覧・復元・完全削除
 *
 * [Gate B-012] backend/app/api/v1/travel.py。
 * - GET    /travel-plans/deleted            自分が所有する論理削除済みプラン
 * - POST   /travel-plans/{id}/restore       猶予期間内なら復元(期限切れは410)
 * - DELETE /travel-plans/{id}/permanent     今すぐ完全削除(元に戻せない)
 */
import type { TravelPlan } from '@/types';
import { ValidationApi } from './validation';
import type { ApiResponse, DeletedPlanSummary, PlanPurgeResult } from '../types';
import { apiOk } from '../response';
import { arrayOf, decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

export class PlanTrashApi extends ValidationApi {
  async getDeletedPlans(): Promise<DeletedPlanSummary[]> {
    const response = await this.client.get('/travel-plans/deleted');
    return decodeResponse(response.data, arrayOf((await DL()).deletedPlanSummary), 'GET /travel-plans/deleted');
  }

  async restorePlan(planId: string): Promise<ApiResponse<TravelPlan>> {
    const response = await this.client.post<unknown>(`/travel-plans/${planId}/restore`);
    return apiOk<TravelPlan>(
      this.planFromApi(decodeResponse(response.data, (await DL()).legacyTravelPlan, 'POST /travel-plans/{plan_id}/restore'))
    );
  }

  async purgePlan(planId: string): Promise<PlanPurgeResult> {
    const response = await this.client.delete(`/travel-plans/${planId}/permanent`);
    return decodeResponse(response.data, (await DL()).planPurgeResult, 'DELETE /travel-plans/{plan_id}/permanent');
  }
}
