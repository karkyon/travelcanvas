/**
 * 経路比較(FR-015)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { SegmentsApi } from './segments';
import type { AdoptRouteOptionResponse, RouteLeg, RouteLegCreateData, RouteLegUpdateData, RouteOption, RouteOptionCreateData, RouteOptionUpdateData } from '../types';

export class RouteOptionsApi extends SegmentsApi {
  // backend/app/api/v1/route_options.py (Gate M3)。/plans/{planId}/route-options配下。

  async getRouteOptions(planId: string): Promise<RouteOption[]> {
    const response = await this.client.get<RouteOption[]>(`/plans/${planId}/route-options`);
    return response.data;
  }

  async getRouteOption(planId: string, optionId: string): Promise<RouteOption> {
    const response = await this.client.get<RouteOption>(`/plans/${planId}/route-options/${optionId}`);
    return response.data;
  }

  async createRouteOption(
    planId: string, data: RouteOptionCreateData, idempotencyKey: string
  ): Promise<RouteOption> {
    const response = await this.client.post<RouteOption>(
      `/plans/${planId}/route-options`, data, { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  }

  async updateRouteOption(
    planId: string, optionId: string, data: RouteOptionUpdateData, ifMatch: number
  ): Promise<RouteOption> {
    const response = await this.client.patch<RouteOption>(
      `/plans/${planId}/route-options/${optionId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  async deleteRouteOption(planId: string, optionId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete<{ revision: number }>(
      `/plans/${planId}/route-options/${optionId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  async addRouteLeg(
    planId: string, optionId: string, data: RouteLegCreateData, ifMatch: number
  ): Promise<RouteLeg> {
    const response = await this.client.post<RouteLeg>(
      `/plans/${planId}/route-options/${optionId}/legs`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  async updateRouteLeg(
    planId: string, optionId: string, legId: string, data: RouteLegUpdateData, ifMatch: number
  ): Promise<RouteLeg> {
    const response = await this.client.patch<RouteLeg>(
      `/plans/${planId}/route-options/${optionId}/legs/${legId}`, data,
      { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  async deleteRouteLeg(
    planId: string, optionId: string, legId: string, ifMatch: number
  ): Promise<{ revision: number }> {
    const response = await this.client.delete<{ revision: number }>(
      `/plans/${planId}/route-options/${optionId}/legs/${legId}`,
      { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  async adoptRouteOption(
    planId: string, optionId: string, ifMatch: number
  ): Promise<AdoptRouteOptionResponse> {
    const response = await this.client.post<AdoptRouteOptionResponse>(
      `/plans/${planId}/route-options/${optionId}/adopt`, {}, { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }
}
