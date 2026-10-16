/**
 * 旅の振り返り(FR-054 Plan-to-Memory・FR-053 旅の達成指標)
 *
 * [Gate P14] backend/app/api/v1/journey.py。/plans/{planId}/journey配下。
 * 画面内でエラーを案内するため、共通エラー処理のtoastは出さない(SILENT)。
 * 既にある実績を変える時は実績のrevisionを If-Match に送る(初めての記録では送らない)。
 */
import type { AxiosRequestConfig } from 'axios';
import { LocationApi } from './location';
import type { ActualInput, ActualPutResult, CarryOverResult, JourneyReview } from '../types';
import { decodeResponse } from '../decode';
import { actualPutResult, carryOverResult, journeyReview } from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class JourneyApi extends LocationApi {
  async getJourney(planId: string): Promise<JourneyReview> {
    const response = await this.client.get(`/plans/${planId}/journey`, SILENT);
    return decodeResponse(response.data, journeyReview, 'GET /plans/{plan_id}/journey');
  }

  async putEventActual(planId: string, eventId: string, input: ActualInput, revision?: number): Promise<ActualPutResult> {
    const config: AxiosRequestConfig = revision === undefined
      ? SILENT
      : { ...SILENT, headers: { 'If-Match': String(revision) } };
    const response = await this.client.put(`/plans/${planId}/journey/events/${eventId}`, input, config);
    return decodeResponse(response.data, actualPutResult, 'PUT /plans/{plan_id}/journey/events/{event_id}');
  }

  async deleteEventActual(planId: string, eventId: string): Promise<void> {
    await this.client.delete(`/plans/${planId}/journey/events/${eventId}`, SILENT);
  }

  async carryOverEvent(planId: string, eventId: string, targetPlanId: string, targetDayId: string): Promise<CarryOverResult> {
    const response = await this.client.post(`/plans/${planId}/journey/events/${eventId}/carry-over`, {
      target_plan_id: targetPlanId, target_day_id: targetDayId,
    }, SILENT);
    return decodeResponse(response.data, carryOverResult, 'POST /plans/{plan_id}/journey/events/{event_id}/carry-over');
  }
}
