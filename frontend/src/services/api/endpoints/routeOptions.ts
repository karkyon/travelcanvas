/**
 * 経路比較(FR-015)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { SegmentsApi } from './segments';
import type { AdoptRouteOptionResponse, RouteLeg, RouteLegCreateData, RouteLegUpdateData, RouteOption, RouteOptionCreateData, RouteOptionUpdateData } from '../types';
import { arrayOf, decodeResponse } from '../decode';
import { adoptRouteOptionResponse, revisionResult, routeLeg, routeOption } from '../decoders';

export class RouteOptionsApi extends SegmentsApi {
  // backend/app/api/v1/route_options.py (Gate M3)。/plans/{planId}/route-options配下。

  async getRouteOptions(planId: string): Promise<RouteOption[]> {
    const response = await this.client.get(`/plans/${planId}/route-options`);
    return decodeResponse(response.data, arrayOf(routeOption), 'GET /plans/{plan_id}/route-options');
  }

  async getRouteOption(planId: string, optionId: string): Promise<RouteOption> {
    const response = await this.client.get(`/plans/${planId}/route-options/${optionId}`);
    return decodeResponse(response.data, routeOption, 'GET /plans/{plan_id}/route-options/{option_id}');
  }

  async createRouteOption(
    planId: string, data: RouteOptionCreateData, idempotencyKey: string
  ): Promise<RouteOption> {
    const response = await this.client.post(
      `/plans/${planId}/route-options`, data, { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return decodeResponse(response.data, routeOption, 'POST /plans/{plan_id}/route-options');
  }

  async updateRouteOption(
    planId: string, optionId: string, data: RouteOptionUpdateData, ifMatch: number
  ): Promise<RouteOption> {
    const response = await this.client.patch(
      `/plans/${planId}/route-options/${optionId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, routeOption, 'PATCH /plans/{plan_id}/route-options/{option_id}');
  }

  async deleteRouteOption(planId: string, optionId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/route-options/${optionId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, revisionResult, 'DELETE /plans/{plan_id}/route-options/{option_id}');
  }

  async addRouteLeg(
    planId: string, optionId: string, data: RouteLegCreateData, ifMatch: number
  ): Promise<RouteLeg> {
    const response = await this.client.post(
      `/plans/${planId}/route-options/${optionId}/legs`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, routeLeg, 'POST /plans/{plan_id}/route-options/{option_id}/legs');
  }

  async updateRouteLeg(
    planId: string, optionId: string, legId: string, data: RouteLegUpdateData, ifMatch: number
  ): Promise<RouteLeg> {
    const response = await this.client.patch(
      `/plans/${planId}/route-options/${optionId}/legs/${legId}`, data,
      { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, routeLeg, 'PATCH /plans/{plan_id}/route-options/{option_id}/legs/{leg_id}');
  }

  async deleteRouteLeg(
    planId: string, optionId: string, legId: string, ifMatch: number
  ): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/route-options/${optionId}/legs/${legId}`,
      { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, revisionResult, 'DELETE /plans/{plan_id}/route-options/{option_id}/legs/{leg_id}');
  }

  async adoptRouteOption(
    planId: string, optionId: string, ifMatch: number
  ): Promise<AdoptRouteOptionResponse> {
    const response = await this.client.post(
      `/plans/${planId}/route-options/${optionId}/adopt`, {}, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, adoptRouteOptionResponse, 'POST /plans/{plan_id}/route-options/{option_id}/adopt');
  }
}
