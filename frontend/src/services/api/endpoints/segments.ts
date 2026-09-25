/**
 * 移動区間(FR-014)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { ReservationsApi } from './reservations';
import type { SegmentCreateData, SegmentUpdateData, TravelSegment } from '../types';
import { arrayOf, decodeResponse } from '../decode';
import { revisionResult, travelSegment } from '../decoders';

export class SegmentsApi extends ReservationsApi {
  // backend/app/api/v1/segments.py (Gate M1)。/plans/{planId}/segments配下。
  // days/eventsと同じIf-Match/Idempotency-Keyパターンに揃える
  // (Idempotency-KeyはPOST必須。reservations POSTとは異なる契約なので注意)。

  async getSegments(planId: string): Promise<TravelSegment[]> {
    const response = await this.client.get(`/plans/${planId}/segments`);
    return decodeResponse(response.data, arrayOf(travelSegment), 'GET /plans/{plan_id}/segments');
  }

  async getSegment(planId: string, segmentId: string): Promise<TravelSegment> {
    const response = await this.client.get(`/plans/${planId}/segments/${segmentId}`);
    return decodeResponse(response.data, travelSegment, 'GET /plans/{plan_id}/segments/{segment_id}');
  }

  async createSegment(
    planId: string, data: SegmentCreateData, idempotencyKey: string
  ): Promise<TravelSegment> {
    const response = await this.client.post(
      `/plans/${planId}/segments`, data, { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return decodeResponse(response.data, travelSegment, 'POST /plans/{plan_id}/segments');
  }

  async updateSegment(
    planId: string, segmentId: string, data: SegmentUpdateData, ifMatch: number
  ): Promise<TravelSegment> {
    const response = await this.client.patch(
      `/plans/${planId}/segments/${segmentId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, travelSegment, 'PATCH /plans/{plan_id}/segments/{segment_id}');
  }

  async deleteSegment(planId: string, segmentId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/segments/${segmentId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, revisionResult, 'DELETE /plans/{plan_id}/segments/{segment_id}');
  }
}
