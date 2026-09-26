/**
 * 制約(FR-016)
 *
 * [Gate L2] backend/app/api/v1/constraints.py。/plans/{planId}/constraints配下。
 * 楽観ロックは制約ごとのrevision(If-Match)。作成にIdempotency-Keyは不要
 * (DOC-06 §22の対象外)。
 */
import { ShareApi } from './share';
import type { ConstraintCreateData, ConstraintUpdateData, PlanConstraint } from '../types';
import { arrayOf, decodeResponse } from '../decode';
import { planConstraint, revisionResult } from '../decoders';

export class ConstraintsApi extends ShareApi {
  async getConstraints(planId: string): Promise<PlanConstraint[]> {
    const response = await this.client.get(`/plans/${planId}/constraints`);
    return decodeResponse(response.data, arrayOf(planConstraint), 'GET /plans/{plan_id}/constraints');
  }

  async createConstraint(planId: string, data: ConstraintCreateData): Promise<PlanConstraint> {
    const response = await this.client.post(`/plans/${planId}/constraints`, data);
    return decodeResponse(response.data, planConstraint, 'POST /plans/{plan_id}/constraints');
  }

  async updateConstraint(
    planId: string, constraintId: string, data: ConstraintUpdateData, ifMatch: number
  ): Promise<PlanConstraint> {
    const response = await this.client.patch(
      `/plans/${planId}/constraints/${constraintId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, planConstraint, 'PATCH /plans/{plan_id}/constraints/{constraint_id}');
  }

  async deleteConstraint(planId: string, constraintId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/constraints/${constraintId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, revisionResult, 'DELETE /plans/{plan_id}/constraints/{constraint_id}');
  }
}
